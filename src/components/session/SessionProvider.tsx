"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL, getJsonAuth, postJson, registrarAvisoSesion, sendJsonAuth } from "@/lib/client/api";
import { adoptarTemaDeCuenta } from "@/lib/client/tema";
import { clearSession, getStoredPermissions, getStoredToken, setSession, setStoredPermissions } from "@/lib/client/session";
import type { ApiRecord, AuthConfig, ModuleAction, PermissionsMap, RolSesion, SessionUser } from "@/lib/client/types";
import { ALCANCES_SOLO_CON_OBJETO, alcancePermite, type Accion, type Alcance, type ContextoAlcance, type Modulo } from "@/lib/shared/permisos";

/*
 * Sesion de la aplicacion: token, usuario, permisos y configuracion de acceso.
 * - `status` pasa por "checking" -> "authenticated" | "anonymous".
 * - `can(modulo, accion, contexto?)` resuelve los permisos efectivos (union de
 *   los roles vigentes; Fase 1). El servidor es quien decide: esto solo muestra
 *   u oculta menus y botones. Los permisos se vuelven a pedir al servidor cada
 *   minuto y al volver a la ventana, para reflejar roles revocados o vencidos.
 */

export type SessionStatus = "checking" | "authenticated" | "anonymous";

export interface SessionValue {
  status: SessionStatus;
  token: string;
  user: SessionUser | null;
  permissions: PermissionsMap;
  roles: RolSesion[];
  authConfig: AuthConfig;
  can: (modulo: Modulo, accion?: ModuleAction, ctx?: ContextoAlcance) => boolean;
  /* Alcance mas amplio con el que la persona tiene (modulo, accion), o null. */
  alcance: (modulo: Modulo, accion?: Accion) => Alcance | null;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  acceptLogin: (data: ApiRecord) => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
  /* Fase 2: cerrar la sesion en todos los dispositivos (token_version). */
  logoutAll: () => Promise<void>;
  /*
   * Cierre por inactividad: la sesion se "bloquea" (se descarta el token) pero la
   * pagina sigue montada, asi lo capturado no se pierde; al volver a entrar
   * (unlock) se continua donde se quedo.
   */
  locked: boolean;
  lock: () => void;
  unlock: (password: string) => Promise<void>;
  unlockWith: (data: ApiRecord) => void;
}

/* Mensaje para la pantalla de acceso cuando el servidor cerro la sesion. */
export const AVISO_LOGIN_KEY = "ficotox.aviso-login";

const DEFAULT_AUTH_CONFIG: AuthConfig = {};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [permissions, setPermissions] = useState<PermissionsMap>({});
  const [roles, setRoles] = useState<RolSesion[]>([]);
  const [authConfig, setAuthConfig] = useState<AuthConfig>(DEFAULT_AUTH_CONFIG);
  const started = useRef(false);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);

  const enter = useCallback((nextToken: string, nextUser: SessionUser, nextPermissions: PermissionsMap, nextRoles: RolSesion[] = []) => {
    setStoredPermissions(nextPermissions);
    setToken(nextToken);
    setUser(nextUser);
    adoptarTemaDeCuenta(nextUser.tema);
    setPermissions(nextPermissions);
    setRoles(nextRoles);
    setStatus("authenticated");
  }, []);

  const leave = useCallback(() => {
    clearSession();
    setToken("");
    setUser(null);
    setPermissions({});
    setRoles([]);
    setStatus("anonymous");
  }, []);

  const refreshMe = useCallback(async () => {
    // Bloqueada por inactividad: no hay token que refrescar; se espera a que vuelva a entrar.
    if (lockedRef.current) return;
    const stored = getStoredToken();
    if (!stored) {
      leave();
      return;
    }
    try {
      const data = await getJsonAuth(`${API_BASE_URL}/auth/me`, stored);
      enter(stored, (data.user || {}) as SessionUser, (data.permissions || {}) as PermissionsMap, (data.roles || []) as RolSesion[]);
    } catch (err) {
      // Sesion revocada o cuenta no vigente: el acceso muestra el motivo.
      const mensaje = err instanceof Error ? err.message : "";
      if (mensaje && !/token/i.test(mensaje)) {
        try {
          window.sessionStorage.setItem(AVISO_LOGIN_KEY, mensaje);
        } catch {
          /* sin almacenamiento */
        }
      }
      leave();
    }
  }, [enter, leave]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/config`);
        const data = (await response.json().catch(() => ({}))) as ApiRecord;
        if (response.ok) setAuthConfig(data as AuthConfig);
      } catch {
        setAuthConfig(DEFAULT_AUTH_CONFIG);
      }
      const stored = getStoredToken();
      if (!stored) {
        setStatus("anonymous");
        return;
      }
      setPermissions(getStoredPermissions());
      await refreshMe();
    })();
  }, [refreshMe]);

  const loginWithEmail = useCallback(
    async (email: string, password: string) => {
      const data = await postJson(`${API_BASE_URL}/auth/login`, { email, password });
      setSession(data.token as string, (data.user || {}) as SessionUser);
      enter(data.token as string, (data.user || {}) as SessionUser, (data.permissions || {}) as PermissionsMap, (data.roles || []) as RolSesion[]);
    },
    [enter],
  );

  const acceptLogin = useCallback(
    (data: ApiRecord) => {
      setSession(data.token as string, (data.user || {}) as SessionUser);
      enter(data.token as string, (data.user || {}) as SessionUser, (data.permissions || {}) as PermissionsMap, (data.roles || []) as RolSesion[]);
    },
    [enter],
  );

  const logout = useCallback(() => {
    lockedRef.current = false;
    setLocked(false);
    leave();
    router.replace("/login");
  }, [leave, router]);

  const logoutAll = useCallback(async () => {
    await sendJsonAuth("POST", `${API_BASE_URL}/auth/logout-all`, token, {});
    logout();
  }, [token, logout]);

  const lock = useCallback(() => {
    lockedRef.current = true;
    setLocked(true);
    clearSession();
    setToken("");
  }, []);

  const unlockWith = useCallback(
    (data: ApiRecord) => {
      lockedRef.current = false;
      setLocked(false);
      setSession(data.token as string, (data.user || {}) as SessionUser);
      enter(data.token as string, (data.user || {}) as SessionUser, (data.permissions || {}) as PermissionsMap, (data.roles || []) as RolSesion[]);
    },
    [enter],
  );

  const unlock = useCallback(
    async (password: string) => {
      const data = await postJson(`${API_BASE_URL}/auth/login`, { email: user?.email || "", password });
      unlockWith(data);
    },
    [user, unlockWith],
  );

  // El servidor cerro la sesion (token revocado, cuenta fuera de vigencia) o exige cambiar la contrasena.
  useEffect(() => {
    registrarAvisoSesion((codigo, mensaje) => {
      if (codigo === "cambiar_password") {
        void refreshMe();
        return;
      }
      try {
        window.sessionStorage.setItem(AVISO_LOGIN_KEY, mensaje);
      } catch {
        /* sin almacenamiento */
      }
      lockedRef.current = false;
      setLocked(false);
      leave();
      router.replace("/login");
    });
    return () => registrarAvisoSesion(null);
  }, [leave, refreshMe, router]);

  // Revocar o vencer un rol tiene efecto inmediato en el servidor; aqui se refleja al volver a la ventana y cada minuto.
  useEffect(() => {
    if (status !== "authenticated") return;
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshMe();
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [status, refreshMe]);

  const can = useCallback(
    (modulo: Modulo, accion: ModuleAction = "V", ctx?: ContextoAlcance) => {
      if (!permissions[modulo]?.[accion]) return false;
      // Fase 11: sin contexto no cuenta un alcance que solo vale con objeto ("incidencias" no abre la bitacora).
      if (!ctx) return roles.some((rol) => { const a = rol.permisos[modulo]?.[accion]; return !!a && !ALCANCES_SOLO_CON_OBJETO.has(a); }) || !ALCANCES_SOLO_CON_OBJETO.has(permissions[modulo]![accion]!);
      // Con contexto: basta que un rol vigente lo permita con alguno de sus alcances.
      return roles.some((rol) => {
        const alcance = rol.permisos[modulo]?.[accion];
        return !!alcance && alcancePermite(alcance, ctx);
      }) || alcancePermite(permissions[modulo]![accion]!, ctx);
    },
    [permissions, roles],
  );

  const alcance = useCallback((modulo: Modulo, accion: Accion = "V") => permissions[modulo]?.[accion] ?? null, [permissions]);

  const value = useMemo<SessionValue>(
    () => ({ status, token, user, permissions, roles, authConfig, can, alcance, loginWithEmail, acceptLogin, logout, refreshMe, logoutAll, locked, lock, unlock, unlockWith }),
    [status, token, user, permissions, roles, authConfig, can, alcance, loginWithEmail, acceptLogin, logout, refreshMe, logoutAll, locked, lock, unlock, unlockWith],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession debe usarse dentro de SessionProvider");
  return ctx;
}
