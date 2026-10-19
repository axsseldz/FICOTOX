"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { ArrowRight, CircleNotch, MagnifyingGlass } from "@phosphor-icons/react";
import { IncidenciaVentana, NcVentana } from "@/components/features/calidad/ventanas/CalidadVentanas";
import { reportarIncidencia } from "@/components/features/calidad/ReportarIncidencia";
import { ventanaDe } from "@/components/features/inicio/pendientes";
import { EVENTO_ABRIR_CUENTA } from "@/components/shell/AccountSheet";
import { useSession } from "@/components/session/SessionProvider";
import { cn } from "@/components/ui/cn";
import { useConfirm } from "@/components/ui/Overlay";
import { useBusqueda } from "@/lib/client/busqueda";
import { elegirTema } from "@/lib/client/tema";
import type { Comando, Reciente, ResultadoBusqueda } from "@/lib/shared/busqueda";
import { BusquedaFila } from "./BusquedaFila";

/*
 * Búsqueda universal. UN solo componente en dos lugares: en la página de
 * Inicio (`modo="pagina"`, con el panel flotando bajo la barra) y en la
 * ventana ⌘K de la barra lateral (`modo="ventana"`, dentro de un diálogo
 * centrado, con el campo ya enfocado). Misma lógica, mismos resultados, mismo
 * diseño y mismos recientes (los del servidor).
 *
 * Sin escribir solo se muestran los recientes (lo que buscó y lo que abrió);
 * al escribir, los resultados del servidor agrupados. ↑/↓ recorren los
 * resultados entre grupos, Enter abre y Esc cierra.
 */

export interface VentanaCalidad {
  tipo: "incidencia" | "nc";
  id: number;
}

const ENCABEZADO = "[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:justify-between [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-ink-3";
/* Seleccionado: el estilo compartido `.seleccion` (el mismo de la barra lateral). */
const ITEM = "seleccion group rounded-field outline-none";

export function Busqueda({ modo, onCerrar, alAbrirVentana, className }: { modo: "pagina" | "ventana"; onCerrar?: () => void; /* Quien la aloja se encarga de las ventanas de detalle (si no, las abre ella misma). */ alAbrirVentana?: (ventana: VentanaCalidad) => void; className?: string }) {
  const router = useRouter();
  const { token, logout } = useSession();
  const confirm = useConfirm();
  const { query, setQuery, grupos, buscado, cargando, recientes, cargarRecientes, registrar, quitar, borrarRecientes } = useBusqueda();
  const [enfocada, setEnfocada] = useState(false);
  // En el Inicio, el panel se abre cuando la persona interactúa, no por el enfoque automático.
  const [mostrar, setMostrar] = useState(false);
  const [ventana, setVentana] = useState<VentanaCalidad | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const enfoqueAutomatico = useRef(false);
  const escrito = query.trim().length > 0;
  const sinResultados = escrito && !cargando && buscado === query.trim() && grupos.length === 0;
  // El primer resultado queda seleccionado cada vez que cambian los resultados (llegan del servidor despues de escribir; cmdk solo preselecciona los que ya estaban).
  const primero = escrito ? (grupos[0]?.resultados[0] ? `${grupos[0].clave}-${grupos[0].resultados[0].clave}` : "") : recientes[0] ? `reciente-${recientes[0].id}` : "";
  const [elegido, setElegido] = useState({ para: "", valor: "" });
  const seleccion = elegido.para === primero ? elegido.valor : primero;
  const abierto = modo === "ventana" ? true : enfocada && (escrito ? grupos.length > 0 || sinResultados : mostrar && recientes.length > 0);

  useEffect(() => {
    if (modo === "ventana") {
      void cargarRecientes();
      return;
    }
    // En computadora se enfoca sola; en teléfono no, para no abrir el teclado.
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      enfoqueAutomatico.current = true;
      campo.current?.focus();
    }
  }, [modo, cargarRecientes]);

  useEffect(() => {
    if (modo !== "pagina" || !enfocada) return;
    const alPulsar = (event: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(event.target as Node)) {
        setEnfocada(false);
        setMostrar(false);
      }
    };
    document.addEventListener("pointerdown", alPulsar);
    return () => document.removeEventListener("pointerdown", alPulsar);
  }, [modo, enfocada]);

  const cerrar = () => {
    setEnfocada(false);
    setMostrar(false);
    onCerrar?.();
  };

  const ejecutar = async (comando: Comando) => {
    switch (comando) {
      case "tema_oscuro":
        return elegirTema("oscuro", token);
      case "tema_claro":
        return elegirTema("claro", token);
      case "tema_auto":
        return elegirTema("auto", token);
      case "cuenta":
        return void window.dispatchEvent(new Event(EVENTO_ABRIR_CUENTA));
      case "cambiar_password":
        return void window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CUENTA, { detail: { password: true } }));
      case "reportar_incidencia":
        return reportarIncidencia();
      case "cerrar_sesion": {
        const ok = await confirm({ title: "Cerrar sesión", description: "Saldrás de FICOTOX en este dispositivo.", confirmLabel: "Cerrar sesión", tone: "danger" });
        if (ok) logout();
      }
    }
  };

  /* Lo abierto se agrega a los recientes y lleva a su destino (ventana de detalle, pantalla o acción). */
  const abrir = (resultado: ResultadoBusqueda) => {
    registrar(resultado, query.trim());
    cerrar();
    setQuery("");
    if (resultado.comando) {
      void ejecutar(resultado.comando);
      return;
    }
    const v = ventanaDe(resultado.href);
    if (v && alAbrirVentana) alAbrirVentana(v);
    else if (v) setVentana(v);
    else router.push(resultado.href);
  };

  const abrirReciente = (reciente: Reciente) => {
    if (reciente.tipo === "consulta") {
      setQuery(reciente.titulo);
      campo.current?.focus();
      return;
    }
    abrir({ clave: reciente.clave, tipo: reciente.kind || "pantalla", titulo: reciente.titulo, sub: reciente.sub || undefined, href: reciente.href, mono: reciente.mono, comando: reciente.comando || undefined });
  };

  const verTodos = (href: string) => {
    if (query.trim()) registrar(null, query.trim());
    cerrar();
    setQuery("");
    router.push(href);
  };

  const panel = (
    <Command.List className={cn("scroll-thin overflow-y-auto p-2 pb-3", modo === "ventana" ? "max-h-[min(60vh,480px)]" : "max-h-[min(56vh,460px)]")}>
      {!escrito
        ? recientes.length > 0 && (
            <Command.Group
              className={ENCABEZADO}
              heading={
                <>
                  <span>Recientes</span>
                  <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={borrarRecientes} className="rounded-sm px-1.5 py-0.5 text-2xs font-normal text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-2">
                    Borrar recientes
                  </button>
                </>
              }
            >
              {recientes.map((r) => (
                <Command.Item key={r.id} value={`reciente-${r.id}`} onSelect={() => abrirReciente(r)} className={ITEM}>
                  <BusquedaFila fila={{ tipo: r.tipo === "consulta" ? null : r.kind, titulo: r.titulo, sub: r.sub, mono: r.mono }} onQuitar={() => quitar(r.id)} />
                </Command.Item>
              ))}
            </Command.Group>
          )
        : null}
      {escrito && sinResultados ? <p className="px-3 py-9 text-center text-base text-ink-3">No encontramos nada con «{query.trim()}»</p> : null}
      {escrito
        ? grupos.map((grupo) => (
            <Command.Group key={grupo.clave} heading={grupo.titulo} className={ENCABEZADO}>
              {grupo.resultados.map((r) => (
                <Command.Item key={r.clave} value={`${grupo.clave}-${r.clave}`} onSelect={() => abrir(r)} className={ITEM}>
                  <BusquedaFila fila={r} consulta={query} />
                </Command.Item>
              ))}
              {grupo.mas ? (
                <Command.Item value={`${grupo.clave}-todos`} onSelect={() => verTodos(grupo.mas!.href)} className={ITEM}>
                  <span className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-brand">
                    {grupo.mas.etiqueta} <ArrowRight size={13} />
                  </span>
                </Command.Item>
              ) : null}
            </Command.Group>
          ))
        : null}
    </Command.List>
  );

  return (
    <div
      ref={raiz}
      className={cn("relative z-[var(--z-popover)] mx-auto w-full", className)}
      /* Si el foco sale del buscador (Shift+Tab, clic en otro control), el panel del Inicio se cierra. */
      onBlur={(event) => {
        if (modo === "pagina" && !raiz.current?.contains(event.relatedTarget as Node | null)) {
          setEnfocada(false);
          setMostrar(false);
        }
      }}
    >
      <Command label="Buscar" shouldFilter={false} loop value={seleccion} onValueChange={(valor) => setElegido({ para: primero, valor })} className="w-full">
        <div className={cn("flex items-center gap-3.5", modo === "pagina" ? cn("rounded-panel bg-surface pr-4 pl-6 shadow-raised ring-1 ring-line/60 transition-shadow duration-300 ease-[var(--ease-spring)]", enfocada && "ring-focus") : "px-5")}>
          <MagnifyingGlass size={modo === "pagina" ? 24 : 22} className={cn("shrink-0 transition-colors", enfocada || modo === "ventana" ? "text-brand" : "text-ink-3")} />
          <Command.Input
            ref={campo}
            autoFocus={modo === "ventana"}
            value={query}
            onValueChange={setQuery}
            onFocus={() => {
              setEnfocada(true);
              if (enfoqueAutomatico.current) enfoqueAutomatico.current = false;
              else setMostrar(true);
              void cargarRecientes();
            }}
            onClick={() => setMostrar(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") setMostrar(true);
              if (event.key === "Escape" && modo === "pagina") {
                if (query) setQuery("");
                else {
                  cerrar();
                  (event.target as HTMLInputElement).blur();
                }
              }
            }}
            placeholder="Busca un folio, un reactivo, un equipo, o escribe lo que quieres hacer"
            aria-label="Buscar en FICOTOX"
            className={cn("min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-4", modo === "pagina" ? "h-[72px] text-lg sm:text-xl" : "h-[58px] text-lg sm:text-xl")}
          />
          <CircleNotch size={18} aria-hidden="true" className={cn("shrink-0 animate-spin text-ink-4 transition-opacity duration-200 motion-reduce:animate-none", cargando ? "opacity-100" : "opacity-0")} />
        </div>
        {/* mousedown sin preventDefault quitaría el foco al campo (y el onBlur cerraría el panel antes del clic). */}
        {modo === "ventana" ? (
          abierto && (recientes.length > 0 || escrito) ? (
            <div onMouseDown={(event) => event.preventDefault()} className="border-t border-line/70">
              {panel}
            </div>
          ) : null
        ) : (
          <div onMouseDown={(event) => event.preventDefault()} className={cn("absolute inset-x-0 top-[calc(100%+10px)] z-[var(--z-popover)] overflow-hidden rounded-panel border border-line bg-popover text-left shadow-panel", abierto ? "animate-materialize" : "hidden")}>
            {panel}
          </div>
        )}
      </Command>
      <IncidenciaVentana ids={ventana?.tipo === "incidencia" ? [ventana.id] : []} indice={ventana?.tipo === "incidencia" ? 0 : null} onIndice={() => undefined} onCerrar={() => setVentana(null)} />
      <NcVentana ids={ventana?.tipo === "nc" ? [ventana.id] : []} indice={ventana?.tipo === "nc" ? 0 : null} onIndice={() => undefined} onCerrar={() => setVentana(null)} />
    </div>
  );
}
