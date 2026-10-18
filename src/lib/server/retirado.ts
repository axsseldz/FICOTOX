import { NextResponse } from "next/server";

/*
 * Flujo anterior de control documental (/api/documentos-sgc, Fase 7): se retiro
 * y despues tambien la Biblioteca que lo sustituyo; el control documental vigente
 * es Documentos SGC (/api/sgc). Sus escrituras responden 410; las tablas y los
 * archivos se conservan sin uso.
 */
const MENSAJE_RETIRADO = "Funcionalidad retirada: el control documental vigente está en Documentos SGC";

export async function funcionalidadRetirada(): Promise<Response> {
  return NextResponse.json({ message: MENSAJE_RETIRADO, codigo: "retirado" }, { status: 410 });
}

/* Pantallas de Administracion retiradas (Revision de accesos se integro en Usuarios; Respaldos solo por linea de comandos). */
export function pantallaRetirada(detalle: string): Response {
  return NextResponse.json({ message: `Funcionalidad retirada: ${detalle}`, codigo: "retirado" }, { status: 410 });
}

/* Decision confirmada por el laboratorio: la bitacora (y el historial de cada registro) no se exporta. */
export function exportacionBitacoraRetirada(): Response {
  return NextResponse.json({ message: "Funcionalidad retirada: la bitácora no se exporta; se consulta solo dentro de la plataforma", codigo: "retirado" }, { status: 410 });
}
