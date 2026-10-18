import argparse
import fnmatch
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, unquote, urlencode, urlparse
from urllib.request import Request, urlopen
from zipfile import ZIP_DEFLATED, ZipFile


EXCLUDED_DIRS = {".git", ".venv", "__pycache__", "instance", "backups", "node_modules", ".next", "dist", "build"}
EXCLUDED_FILES = {".env"}
EXCLUDED_FILE_PATTERNS = ("*.pyc", "*.sqlite", "*.sqlite3", "*.db")


def read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")

    return values


def config_value(dotenv: dict[str, str], name: str, default: str = "") -> str:
    return os.environ.get(name) or dotenv.get(name) or default


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def detect_onedrive_dir() -> Path | None:
    candidates = [
        os.environ.get("FICOTOX_ONEDRIVE_SYNC_DIR", ""),
        os.environ.get("OneDriveCommercial", ""),
        os.environ.get("OneDriveConsumer", ""),
        os.environ.get("OneDrive", ""),
    ]

    user_profile = os.environ.get("USERPROFILE")
    if user_profile:
        candidates.append(str(Path(user_profile) / "OneDrive"))

    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)

    return None


def microsoft_graph_token(dotenv: dict[str, str]) -> str:
    tenant_id = config_value(dotenv, "FICOTOX_GRAPH_TENANT_ID") or config_value(dotenv, "MICROSOFT_TENANT_ID")
    client_id = config_value(dotenv, "FICOTOX_GRAPH_CLIENT_ID") or config_value(dotenv, "MICROSOFT_CLIENT_ID")
    client_secret = (
        config_value(dotenv, "FICOTOX_GRAPH_CLIENT_SECRET")
        or config_value(dotenv, "MICROSOFT_CLIENT_SECRET")
        or config_value(dotenv, "MICROSOFT_SECRET_KEY")
        or config_value(dotenv, "MMICROSOFT_SECRET_KEY")
    )

    if not tenant_id or not client_id or not client_secret:
        raise RuntimeError(
            "Para subir online a OneDrive configura FICOTOX_GRAPH_CLIENT_SECRET "
            "y tenant/client id en .env."
        )

    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    data = urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        }
    ).encode("utf-8")
    request = Request(
        token_url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"No se pudo obtener token de Microsoft Graph: {detail}") from exc

    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Microsoft Graph no devolvio access_token.")

    return token


def graph_drive_prefix(dotenv: dict[str, str]) -> str:
    drive_id = config_value(dotenv, "FICOTOX_GRAPH_DRIVE_ID")
    site_id = config_value(dotenv, "FICOTOX_GRAPH_SITE_ID")
    user = config_value(dotenv, "FICOTOX_GRAPH_USER")

    if drive_id:
        return f"https://graph.microsoft.com/v1.0/drives/{quote(drive_id, safe='')}"
    if site_id:
        return f"https://graph.microsoft.com/v1.0/sites/{quote(site_id, safe='')}/drive"
    if user:
        return f"https://graph.microsoft.com/v1.0/users/{quote(user, safe='')}/drive"

    raise RuntimeError(
        "Para subir online configura FICOTOX_GRAPH_DRIVE_ID, "
        "FICOTOX_GRAPH_SITE_ID o FICOTOX_GRAPH_USER."
    )


def graph_path_url(dotenv: dict[str, str], item_path: str, suffix: str = "") -> str:
    encoded_path = quote(item_path.strip("/"), safe="/")
    return f"{graph_drive_prefix(dotenv)}/root:/{encoded_path}:{suffix}"


def graph_request(url: str, token: str, method: str = "GET", payload: dict | None = None) -> dict:
    data = None
    headers = {"Authorization": f"Bearer {token}"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(url, data=data, headers=headers, method=method)
    with urlopen(request, timeout=120) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {}


def graph_item_exists(dotenv: dict[str, str], token: str, item_path: str) -> bool:
    try:
        graph_request(graph_path_url(dotenv, item_path), token)
        return True
    except HTTPError as exc:
        if exc.code == 404:
            return False
        raise


def create_graph_folder(dotenv: dict[str, str], token: str, parent_path: str, folder_name: str) -> None:
    payload = {
        "name": folder_name,
        "folder": {},
        "@microsoft.graph.conflictBehavior": "fail",
    }
    if parent_path:
        url = graph_path_url(dotenv, parent_path, "/children")
    else:
        url = f"{graph_drive_prefix(dotenv)}/root/children"

    try:
        graph_request(url, token, method="POST", payload=payload)
    except HTTPError as exc:
        if exc.code == 409:
            return
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"No se pudo crear la carpeta online '{folder_name}': {detail}") from exc


def ensure_graph_folder(dotenv: dict[str, str], token: str, folder_path: str) -> None:
    current_parts: list[str] = []
    for folder_name in [part for part in folder_path.strip("/").split("/") if part]:
        parent_path = "/".join(current_parts)
        current_parts.append(folder_name)
        current_path = "/".join(current_parts)
        if not graph_item_exists(dotenv, token, current_path):
            create_graph_folder(dotenv, token, parent_path, folder_name)


def upload_to_graph(file_path: Path, remote_folder: str, dotenv: dict[str, str]) -> str:
    token = microsoft_graph_token(dotenv)
    base_path = config_value(dotenv, "FICOTOX_GRAPH_BASE_PATH").strip("/")
    upload_parts = [part for part in [base_path, remote_folder.strip("/"), file_path.name] if part]
    upload_path = "/".join(upload_parts)
    folder_path = "/".join(upload_parts[:-1])
    ensure_graph_folder(dotenv, token, folder_path)
    url = graph_path_url(dotenv, upload_path, "/content")

    request = Request(
        url,
        data=file_path.read_bytes(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/octet-stream",
        },
        method="PUT",
    )

    try:
        with urlopen(request, timeout=300) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"No se pudo subir respaldo a Microsoft Graph: {detail}") from exc

    return payload.get("webUrl") or f"Microsoft Graph: {upload_path}"


def copy_to_onedrive(
    file_path: Path,
    remote_folder: str,
    remote: str,
    sync_dir: str,
    dotenv: dict[str, str],
) -> Path | str | None:
    if config_value(dotenv, "FICOTOX_GRAPH_ENABLED", "false").lower() == "true":
        return upload_to_graph(file_path, remote_folder, dotenv)

    if remote:
        if not shutil.which("rclone"):
            raise RuntimeError("FICOTOX_ONEDRIVE_REMOTE esta configurado, pero rclone no esta instalado o no esta en PATH.")

        subprocess.run(["rclone", "copy", str(file_path), f"{remote}/{remote_folder}"], check=True)
        return None

    onedrive_dir = Path(sync_dir) if sync_dir else detect_onedrive_dir()
    if onedrive_dir:
        destination = onedrive_dir / remote_folder
        ensure_dir(destination)
        copied_path = destination / file_path.name
        shutil.copy2(file_path, copied_path)
        return copied_path

    print("ADVERTENCIA: no se encontro OneDrive. Configura FICOTOX_ONEDRIVE_SYNC_DIR o FICOTOX_ONEDRIVE_REMOTE.")
    return None


def should_include_code_file(root: Path, file_path: Path) -> bool:
    relative_parts = file_path.relative_to(root).parts
    if any(part in EXCLUDED_DIRS for part in relative_parts):
        return False

    if file_path.name in EXCLUDED_FILES:
        return False

    return not any(fnmatch.fnmatch(file_path.name, pattern) for pattern in EXCLUDED_FILE_PATTERNS)


def make_code_backup(project_root: Path, destination_dir: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    zip_path = destination_dir / f"ficotox-code-{timestamp}.zip"

    with tempfile.TemporaryDirectory(prefix="ficotox-code-backup-") as temp_dir:
        staging_dir = Path(temp_dir) / "ficotox"
        ensure_dir(staging_dir)

        for file_path in project_root.rglob("*"):
            if not file_path.is_file() or not should_include_code_file(project_root, file_path):
                continue

            relative_path = file_path.relative_to(project_root)
            target_path = staging_dir / relative_path
            ensure_dir(target_path.parent)
            shutil.copy2(file_path, target_path)

        with ZipFile(zip_path, "w", ZIP_DEFLATED) as archive:
            for file_path in staging_dir.rglob("*"):
                if file_path.is_file():
                    archive.write(file_path, file_path.relative_to(staging_dir))

    return zip_path


def make_sqlite_backup(project_root: Path, destination_dir: Path, include_key: bool) -> Path:
    """
    Fase 10: la base y los archivos los respalda la implementacion unica en Node
    (scripts/respaldar-ficotox.mjs -> src/lib/shared/respaldo.mjs): snapshot en
    linea de SQLite, archivos de la instancia, manifest.json y la llave de la
    bitacora aparte. Aqui solo se empaqueta esa carpeta en un .zip para la copia
    externa (OneDrive, rclone o Graph), SIN la llave salvo con --incluir-llave.
    """
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js no esta instalado o no esta en PATH (el respaldo usa scripts/respaldar-ficotox.mjs).")

    result = subprocess.run(
        [node, str(project_root / "scripts" / "respaldar-ficotox.mjs"), "--json", "--etiqueta", "automatico"],
        cwd=project_root,
        # Misma carpeta local que este script (backups/ o --local-backup-dir / FICOTOX_BACKUP_DIR).
        env={**os.environ, "FICOTOX_BACKUP_DIR": str(destination_dir.parent)},
        check=True,
        capture_output=True,
        text=True,
    )
    info = json.loads(result.stdout.strip().splitlines()[-1])
    folder = Path(info["carpeta"])
    zip_path = destination_dir / f"ficotox-respaldo-{info['id']}{'-con-llave' if include_key else ''}.zip"

    with ZipFile(zip_path, "w", ZIP_DEFLATED) as archive:
        for file_path in sorted(folder.rglob("*")):
            if not file_path.is_file():
                continue
            relative = file_path.relative_to(folder)
            if relative.parts and relative.parts[0] == "llave" and not include_key:
                continue
            archive.write(file_path, Path(info["id"]) / relative)

    print(f"Respaldo local: {folder} (llave de la bitacora {'incluida' if info.get('incluye_llave') else 'no incluida'})")
    print(f"Copia externa: {zip_path.name} ({'CON la llave' if include_key else 'sin la llave'})")
    return zip_path


def make_mysql_backup(database_url: str, destination_dir: Path) -> Path:
    if not shutil.which("mysqldump"):
        raise RuntimeError("DATABASE_URL usa MySQL/MariaDB, pero mysqldump no esta instalado o no esta en PATH.")

    normalized_url = database_url.replace("mysql+pymysql://", "mysql://", 1)
    parsed = urlparse(normalized_url)
    database = parsed.path.lstrip("/")
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    port = parsed.port or 3306
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = destination_dir / f"ficotox-db-mysql-{timestamp}.sql"

    env = os.environ.copy()
    env["MYSQL_PWD"] = password
    command = [
        "mysqldump",
        f"--host={parsed.hostname}",
        f"--port={port}",
        f"--user={user}",
        "--single-transaction",
        "--routines",
        "--triggers",
        database,
    ]

    with backup_path.open("w", encoding="utf-8") as output:
        subprocess.run(command, check=True, stdout=output, env=env)

    return backup_path


def make_database_backup(dotenv: dict[str, str], project_root: Path, destination_dir: Path, include_key: bool) -> Path:
    database_url = config_value(dotenv, "DATABASE_URL")
    if database_url.startswith("mysql"):
        return make_mysql_backup(database_url, destination_dir)

    return make_sqlite_backup(project_root, destination_dir, include_key)


def main() -> int:
    parser = argparse.ArgumentParser(description="Crea respaldos locales y los copia a Microsoft OneDrive.")
    parser.add_argument("--target", choices=("database", "code", "all"), default="all")
    parser.add_argument("--project-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--onedrive-remote", default="")
    parser.add_argument("--onedrive-sync-dir", default="")
    parser.add_argument("--local-backup-dir", default="")
    parser.add_argument(
        "--incluir-llave",
        action="store_true",
        help="Incluir la llave de la bitacora en la copia externa (por omision solo va en el respaldo local).",
    )
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    dotenv = read_dotenv(project_root / ".env")
    onedrive_remote = args.onedrive_remote or config_value(dotenv, "FICOTOX_ONEDRIVE_REMOTE")
    onedrive_sync_dir = args.onedrive_sync_dir or config_value(dotenv, "FICOTOX_ONEDRIVE_SYNC_DIR")
    local_backup_dir_value = args.local_backup_dir or config_value(dotenv, "FICOTOX_BACKUP_DIR")
    local_backup_dir = Path(local_backup_dir_value).resolve() if local_backup_dir_value else project_root / "backups"
    database_backup_dir = local_backup_dir / "database"
    code_backup_dir = local_backup_dir / "code"
    ensure_dir(database_backup_dir)
    ensure_dir(code_backup_dir)

    created: list[Path] = []

    if args.target in {"database", "all"}:
        database_backup = make_database_backup(dotenv, project_root, database_backup_dir, args.incluir_llave)
        copied_path = copy_to_onedrive(database_backup, "backup/database", onedrive_remote, onedrive_sync_dir, dotenv)
        created.append(database_backup)
        if copied_path:
            created.append(copied_path)

    if args.target in {"code", "all"}:
        code_backup = make_code_backup(project_root, code_backup_dir)
        copied_path = copy_to_onedrive(code_backup, "backup/code", onedrive_remote, onedrive_sync_dir, dotenv)
        created.append(code_backup)
        if copied_path:
            created.append(copied_path)

    print("Respaldos creados:")
    for path in created:
        print(f" - {path}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(1)
