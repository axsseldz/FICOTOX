# Documentos SGC · Respaldo y restauración

El módulo usa el respaldo general de FICOTOX (`npm run respaldar` y `npm run restaurar`; ver [README.md](../../README.md), sección 4). No tiene un respaldo aparte: la base y los archivos documentales viajan juntos, con huellas, en el mismo respaldo (CA-13).

## Qué incluye el respaldo del módulo

| Parte | Dónde está | Cómo se protege |
| --- | --- | --- |
| Tablas `sgc_*` (11) | Dentro de `ficotox.sqlite3`: fichas, revisiones, archivos, flujo, solicitudes, renovaciones, externos, distribución, lecturas y catálogos | Copia en línea de la base (API de respaldo de SQLite) con `integrity_check`. El manifest guarda el **conteo de filas de cada tabla `sgc_*`**, que se compara al restaurar (desde la Fase 4). |
| Bitácora del módulo | Tabla `auditoria` (entidad `sgc_documentos`) | Cadena de sellos con la llave de la bitácora; se verifica al restaurar. |
| PDF y archivos fuente | `instance/sgc/<documento>/<revision>/<uuid>.<ext>` | Cada archivo va en el respaldo con su **SHA-256** en el manifest y se compara **otra vez contra `sgc_archivos.sha256`** de la base restaurada. |
| Archivos de apoyo de las solicitudes | `instance/sgc/solicitudes/<id>/…` | Igual que los anteriores (SHA-256 en el manifest). |
| Llave de la bitácora | `backups/<id>/llave/` (o aparte, con `--sin-llave`) | Solo su huella va en el manifest; la llave se guarda fuera de la computadora. |

No se respaldan los secretos (`.env`) ni la contraseña SMTP; la suite `respaldos` lo comprueba.

## Cómo se prueba la restauración

1. `npm run respaldar` crea `backups/AAAAMMDD-HHMMSS/` con `datos/`, `archivos/`, `llave/` y `manifest.json`.
2. `npm run restaurar -- --respaldo AAAAMMDD-HHMMSS --responsable "Nombre"` restaura **en una carpeta aparte** (`instance-restaurada/<fecha>/`), sin tocar la instancia real, y corre las 8 verificaciones:
   1. el manifest es válido y cada archivo del respaldo tiene el SHA-256 correcto (un PDF de `sgc/` alterado se detecta aquí);
   2. `PRAGMA integrity_check`;
   3. el esquema es compatible (migración 24);
   4. la llave de la bitácora coincide con la del manifest;
   5. la cadena de la bitácora está íntegra;
   6. los conteos por tabla coinciden, incluidas todas las `sgc_*`;
   7. los archivos coinciden con la base por SHA-256, incluidos los **archivos de Documentos SGC**;
   8. el tiempo total.
3. El acta queda en `backups/pruebas-restauracion/<fecha>.md` y `.json`, con espacio para la firma del responsable y la revisión de Mejora Continua.
4. Al terminar, se borra la copia `instance-restaurada/<fecha>/`; el acta se conserva.
5. **Restauración real** (solo en una emergencia y con la plataforma detenida): `npm run restaurar -- --respaldo <id> --destino instance --confirmar --responsable "Nombre"`. Antes crea un respaldo de la instancia actual y agrega a la bitácora la entrada «restauración desde respaldo».

**Pruebas automáticas** (suite `tests/respaldos.mjs`):

- el respaldo incluye `archivos/sgc/`;
- la restauración copia y verifica la carpeta `sgc/`;
- un PDF de `sgc/` alterado hace fallar la verificación 1;
- el manifest cuenta las nueve tablas operativas `sgc_*`;
- una llave distinta o ausente se detecta.

## Acta de la prueba de restauración (Fase 4)

Se hizo con la instancia de desarrollo, sembrada con los datos de demostración (`npm run demo:documentos`): 9 documentos, 12 revisiones, 12 archivos PDF, un externo, distribución y una obsolescencia aprobada. Todos son datos anonimizados.

| Dato | Valor |
| --- | --- |
| Fecha | 14 de octubre de 2026, 12:03 (America/Tijuana) |
| Respaldo usado | `20261014-120352` |
| Responsable | Equipo de desarrollo (prueba Fase 4) |
| Modo | Prueba (carpeta aparte; la instancia real no se tocó) |
| Esquema | 24 |
| Resultado | **APROBADA** (8 de 8) |

| # | Verificación | Resultado | Detalle |
| --- | --- | --- | --- |
| 1 | Manifest e integridad de los archivos del respaldo | ✅ | Base y 12 archivos con SHA-256 correcto. |
| 2 | PRAGMA integrity_check | ✅ | ok |
| 3 | Esquema compatible | ✅ | Esquema 24, igual al de la aplicación. |
| 4 | Llave de la bitácora | ✅ | La huella coincide con el manifest y el sello del manifest es válido. |
| 5 | Cadena de la bitácora | ✅ | 301 entradas íntegras: sellos válidos, sin huecos y con los disparadores presentes. |
| 6 | Conteos por tabla | ✅ | 39 tablas iguales al manifest, incluidas las 11 `sgc_*`. |
| 7 | Archivos contra la base (SHA-256) | ✅ | **Archivos de Documentos SGC: 12, ninguno faltante ni alterado**; las demás carpetas, sin diferencias. |
| 8 | Tiempo total de restauración | ✅ | 0.03 s |

El acta original está en `backups/pruebas-restauracion/20261014-120352.md`, en la computadora de desarrollo; `backups/` no entra al repositorio. La copia restaurada se borró al terminar.

Firma del responsable: ______________________  Revisó (Mejora Continua): ______________________
