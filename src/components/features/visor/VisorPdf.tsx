"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type UIEvent } from "react";
import { BookOpenText, CaretDown, CaretLeft, CaretRight, CornersIn, CornersOut, DownloadSimple, ListBullets, MagnifyingGlass, MagnifyingGlassMinus, MagnifyingGlassPlus, MoonStars, Printer, SidebarSimple, SquaresFour, X } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { explicarError } from "@/lib/client/mensajes";
import { abrirPdfUrl, cargarPdfjs, type PdfDocumento } from "@/lib/client/pdf";

/*
 * Visor interno de PDF (Documentos SGC, informes, reportes y NC) con pdf.js (carga progresiva por rangos):
 * - el documento es lo principal: paginas centradas, nitidas a la densidad de la pantalla;
 * - una sola barra flotante abajo: se oculta sola al leer y reaparece al mover el cursor, al subir o al tocar;
 * - solo se dibujan las paginas cercanas a la vista (IntersectionObserver), con siluetas mientras cargan;
 * - capa de texto para seleccionar y buscar con resaltado; miniaturas e indice plegables (cerrados por omision);
 * - zoom: ajustar al ancho (con ancho maximo de lectura), a la pagina, 100 % o porcentajes; se recuerda por persona;
 * - teclado (flechas, RePag/AvPag, +/−, F, Ctrl+F, Esc) y tableta (pellizco, doble toque, deslizar);
 * - modo Lectura: el documento a pantalla completa dentro de la plataforma; Esc lo cierra;
 * - descargar e imprimir solo si la persona tiene permiso (si no, deshabilitados con el motivo).
 */

/* 100 % = tamano real (pt a px CSS). */
const PT_A_PX = 96 / 72;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/* Ancho maximo comodo de lectura para "Ajustar al ancho" (px CSS). */
const ANCHO_LECTURA = 900;
type Zoom = { modo: "ancho" } | { modo: "pagina" } | { modo: "valor"; valor: number };

interface Coincidencia {
  pagina: number;
  /* Indice de la coincidencia dentro de la pagina (orden de los fragmentos de texto). */
  k: number;
}

/* Acciones de la barra. Sin accion (o con `null`) el boton queda deshabilitado con su motivo. */
export interface AccionesVisor {
  descargar?: (() => void) | null;
  imprimir?: (() => void) | null;
  motivoDescargar?: string;
  motivoImprimir?: string;
}

const ESTILOS = `
.visor-textlayer { position: absolute; inset: 0; overflow: clip; line-height: 1; text-align: initial; opacity: 1; z-index: 1; transform-origin: 0 0;
  --min-font-size: 1; --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size)); --min-font-size-inv: calc(1 / var(--min-font-size)); }
.visor-textlayer :is(span, br) { color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%; user-select: text; }
.visor-textlayer > :not(.markedContent), .visor-textlayer .markedContent span:not(.markedContent) { z-index: 1; --font-height: 0; font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1; --rotate: 0deg; transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
.visor-textlayer .markedContent { display: contents; }
.visor-textlayer ::selection { background: color-mix(in srgb, var(--color-brand) 30%, transparent); color: transparent; }
.visor-textlayer .endOfContent { display: block; position: absolute; inset: 100% 0 0; z-index: 0; cursor: default; user-select: none; }
.visor-resaltado { background: color-mix(in srgb, var(--color-warning) 45%, transparent); color: transparent; border-radius: 2px; }
.visor-resaltado-actual { background: color-mix(in srgb, var(--color-bloom) 60%, transparent); box-shadow: 0 0 0 1px var(--color-bloom); }
/* Lectura nocturna: solo en pantalla invierte suavemente la pagina (no cambia el documento ni lo impreso). */
.visor-nocturna [data-pagina] { filter: invert(0.88) hue-rotate(180deg) contrast(0.95); }
[data-pagina] { transition: filter 260ms ease; }
@media print { .visor-nocturna [data-pagina] { filter: none; } }
@media (prefers-reduced-motion: reduce) { [data-pagina] { transition: none; } }
`;

const claveUltimaPagina = (usuario: unknown, docId: number | string, ambito: string) => `ficotox.${ambito}.pagina.${String(usuario || "anon")}.${docId}`;
const claveZoom = (usuario: unknown) => `ficotox.visor.zoom.${String(usuario || "anon")}`;
const leerUltimaPagina = (clave: string): number => {
  try {
    return Number(window.localStorage.getItem(clave)) || 1;
  } catch {
    return 1;
  }
};
/* Zoom recordado por persona; si el valor guardado no sirve, ajustar al ancho. */
const leerZoom = (clave: string): Zoom => {
  try {
    const v = JSON.parse(window.localStorage.getItem(clave) || "null");
    if (v?.modo === "ancho" || v?.modo === "pagina") return { modo: v.modo };
    if (v?.modo === "valor" && typeof v.valor === "number" && v.valor >= 0.25 && v.valor <= 5) return { modo: "valor", valor: v.valor };
  } catch {
    /* sin almacenamiento o dato invalido */
  }
  return { modo: "ancho" };
};

/*
 * Lleva `el` a la vista desplazando SOLO su contenedor `cont` (el visor o el panel
 * de miniaturas). scrollIntoView movia tambien la pagina que contiene al visor
 * (en la ficha SGC, el encabezado se salia de la pantalla al abrir o al ajustar el zoom).
 */
function desplazarDentro(cont: HTMLElement | null, el: HTMLElement | null | undefined, bloque: "start" | "center" | "nearest", comportamiento: ScrollBehavior = "auto") {
  if (!cont || !el) return;
  const r = el.getBoundingClientRect();
  const c = cont.getBoundingClientRect();
  let top = cont.scrollTop;
  if (bloque === "start") top += r.top - c.top;
  else if (bloque === "center") top += r.top - c.top - (c.height - r.height) / 2;
  else if (r.top < c.top) top += r.top - c.top;
  else if (r.bottom > c.bottom) top += r.bottom - c.bottom;
  const left = bloque === "center" ? cont.scrollLeft + (r.left - c.left) - (c.width - r.width) / 2 : cont.scrollLeft;
  const reducir = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  cont.scrollTo({ top, left, behavior: reducir ? "auto" : comportamiento });
}

/* Resalta las apariciones de `consulta` dentro de los fragmentos de la capa de texto; devuelve las marcas en orden. */
function resaltar(capa: HTMLElement, consulta: string): HTMLElement[] {
  for (const m of Array.from(capa.querySelectorAll("mark.visor-resaltado"))) {
    const padre = m.parentNode;
    if (!padre) continue;
    padre.replaceChild(document.createTextNode(m.textContent || ""), m);
    padre.normalize();
  }
  const marcas: HTMLElement[] = [];
  if (!consulta) return marcas;
  const spans = Array.from(capa.querySelectorAll<HTMLElement>("span")).filter((s) => !s.children.length && !s.classList.contains("markedContent"));
  for (const span of spans) {
    const texto = span.textContent || "";
    const bajo = texto.toLowerCase();
    let desde = 0;
    let i = bajo.indexOf(consulta, desde);
    if (i < 0) continue;
    const frag = document.createDocumentFragment();
    while (i >= 0) {
      if (i > desde) frag.appendChild(document.createTextNode(texto.slice(desde, i)));
      const mark = document.createElement("mark");
      mark.className = "visor-resaltado";
      mark.textContent = texto.slice(i, i + consulta.length);
      frag.appendChild(mark);
      marcas.push(mark);
      desde = i + consulta.length;
      i = bajo.indexOf(consulta, desde);
    }
    if (desde < texto.length) frag.appendChild(document.createTextNode(texto.slice(desde)));
    span.textContent = "";
    span.appendChild(frag);
  }
  return marcas;
}

/* Silueta de una pagina mientras se dibuja: bloque con lineas de texto que pulsan (sin movimiento con reduced-motion). */
function SilhuetaPagina({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2.5 p-[9%] motion-safe:animate-pulse", className)} aria-hidden="true">
      <span className="h-3 w-2/5 rounded bg-surface-3" />
      <span className="mt-2 h-2 w-full rounded bg-surface-3/70" />
      <span className="h-2 w-[94%] rounded bg-surface-3/70" />
      <span className="h-2 w-[88%] rounded bg-surface-3/70" />
      <span className="h-2 w-full rounded bg-surface-3/70" />
      <span className="h-2 w-[72%] rounded bg-surface-3/70" />
      <span className="mt-4 h-2 w-full rounded bg-surface-3/70" />
      <span className="h-2 w-[96%] rounded bg-surface-3/70" />
      <span className="h-2 w-[60%] rounded bg-surface-3/70" />
    </div>
  );
}

function PaginaPdf({ pdf, n, escala, base, cerca, consulta, actualK, onMarcas }: { pdf: PdfDocumento; n: number; escala: number; base: { w: number; h: number }; cerca: boolean; consulta: string; actualK: number; onMarcas?: (n: number, marcas: HTMLElement[]) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const capaRef = useRef<HTMLDivElement | null>(null);
  const [tam, setTam] = useState<{ w: number; h: number } | null>(null);
  const [dibujada, setDibujada] = useState<number | null>(null);
  const w = (tam?.w || base.w) * escala;
  const h = (tam?.h || base.h) * escala;

  useEffect(() => {
    if (!cerca || dibujada === escala) return;
    let cancelada = false;
    let tareaRender: { cancel: () => void } | null = null;
    const dibujar = async () => {
      const pagina = await pdf.getPage(n);
      if (cancelada) return;
      const vistaBase = pagina.getViewport({ scale: 1 });
      setTam((prev) => (prev && prev.w === vistaBase.width && prev.h === vistaBase.height ? prev : { w: vistaBase.width, h: vistaBase.height }));
      const vista = pagina.getViewport({ scale: escala });
      // Densidad de la pantalla: el documento se ve nitido en retina.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = canvasRef.current;
      const capa = capaRef.current;
      if (!canvas || !capa) return;
      const fuera = document.createElement("canvas");
      fuera.width = Math.ceil(vista.width * dpr);
      fuera.height = Math.ceil(vista.height * dpr);
      const ctx = fuera.getContext("2d");
      if (!ctx) return;
      const render = pagina.render({ canvas: fuera, canvasContext: ctx, viewport: vista, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      tareaRender = render;
      try {
        await render.promise;
      } catch {
        return;
      }
      if (cancelada) return;
      canvas.width = fuera.width;
      canvas.height = fuera.height;
      canvas.getContext("2d")?.drawImage(fuera, 0, 0);
      const { TextLayer } = await cargarPdfjs();
      const contenido = await pagina.getTextContent();
      if (cancelada) return;
      capa.replaceChildren();
      capa.style.setProperty("--total-scale-factor", String(escala));
      await new TextLayer({ textContentSource: contenido, container: capa, viewport: vista }).render();
      if (cancelada) return;
      setDibujada(escala);
    };
    // Si el documento se cierra mientras se dibuja (al salir o cerrar el visor), no es un error.
    dibujar().catch(() => undefined);
    return () => {
      cancelada = true;
      tareaRender?.cancel();
    };
  }, [pdf, n, escala, cerca, dibujada]);

  // Resaltado de la busqueda (cada vez que cambia la consulta o la pagina se vuelve a dibujar).
  useEffect(() => {
    const capa = capaRef.current;
    if (!capa || dibujada === null) return;
    const marcas = resaltar(capa, consulta);
    marcas.forEach((m, i) => m.classList.toggle("visor-resaltado-actual", i === actualK));
    onMarcas?.(n, marcas);
  }, [consulta, dibujada, actualK, n, onMarcas]);

  return (
    <div data-pagina={n} className="relative mx-auto bg-papel shadow-[0_1px_3px_rgba(16,32,43,0.18),0_8px_24px_-12px_rgba(16,32,43,0.25)]" style={{ width: w, height: h }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <div ref={capaRef} className="visor-textlayer" />
      {dibujada === null ? <SilhuetaPagina className="absolute inset-0" /> : null}
    </div>
  );
}

function Miniatura({ pdf, n, activa, onIr }: { pdf: PdfDocumento; n: number; activa: boolean; onIr: (n: number) => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || url) return;
    let cancelada = false;
    const io = new IntersectionObserver(async (entradas) => {
      if (!entradas.some((e) => e.isIntersecting)) return;
      io.disconnect();
      try {
        await generar();
      } catch {
        /* documento cerrado o pagina no disponible: la miniatura queda en blanco */
      }
    });
    const generar = async () => {
      const pagina = await pdf.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const vista = pagina.getViewport({ scale: 220 / base.width });
      const c = document.createElement("canvas");
      c.width = Math.ceil(vista.width);
      c.height = Math.ceil(vista.height);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      try {
        await pagina.render({ canvas: c, canvasContext: ctx, viewport: vista }).promise;
      } catch {
        return;
      }
      if (!cancelada) setUrl(c.toDataURL("image/png"));
    };
    io.observe(el);
    return () => {
      cancelada = true;
      io.disconnect();
    };
  }, [pdf, n, url]);
  useEffect(() => {
    if (activa) desplazarDentro(ref.current?.closest<HTMLElement>("[data-testid=visor-miniaturas]") ?? null, ref.current, "nearest");
  }, [activa]);
  return (
    <button ref={ref} type="button" onClick={() => onIr(n)} aria-label={`Ir a la página ${n}`} aria-current={activa ? "page" : undefined} className={cn("press flex w-full flex-col items-center gap-1 rounded-[10px] p-1.5 text-[11.5px]", activa ? "bg-brand-faint text-brand-strong" : "text-ink-3 hover:bg-surface-3")}>
      <span className={cn("block w-full overflow-hidden rounded-[4px] bg-papel ring-1", activa ? "ring-2 ring-brand" : "ring-line")} style={{ aspectRatio: "0.77" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura generada en el navegador (data URL) */}
        {url ? <img src={url} alt="" className="h-full w-full object-contain" /> : null}
      </span>
      <span className="tnum">{n}</span>
    </button>
  );
}

interface NodoIndice {
  title: string;
  dest: string | unknown[] | null;
  items: NodoIndice[];
}

function Indice({ nodos, onIr, nivel = 0 }: { nodos: NodoIndice[]; onIr: (dest: NodoIndice["dest"]) => void; nivel?: number }) {
  return (
    <ul className={cn("flex flex-col", nivel > 0 && "ml-3 border-l border-line pl-2")}>
      {nodos.map((nodo, i) => (
        <li key={`${nivel}-${i}`}>
          <button type="button" onClick={() => onIr(nodo.dest)} className="press w-full rounded-[8px] px-2 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-surface-3 hover:text-ink">
            {nodo.title || "(sin título)"}
          </button>
          {nodo.items?.length ? <Indice nodos={nodo.items} onIr={onIr} nivel={nivel + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

const SIN_PERMISO_DESCARGAR = "No tienes permiso para descargar este archivo";
const SIN_PERMISO_IMPRIMIR = "No tienes permiso para imprimir este archivo";

/* `url`: archivo protegido (con Range); `ambito` y `docId`: clave de la ultima pagina leida y del zoom. */
export function VisorPdf({ url, ambito, docId, acciones }: { url: string; ambito: string; docId: number | string; acciones?: AccionesVisor }) {
  const { token, user } = useSession();
  const [pdf, setPdf] = useState<PdfDocumento | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reintento, setReintento] = useState(0);
  const [base, setBase] = useState<{ w: number; h: number }>({ w: 612, h: 792 });
  const clave = claveUltimaPagina(user?.id || user?.email, docId, ambito);
  const zoomClave = claveZoom(user?.id || user?.email);
  const [zoom, setZoom] = useState<Zoom>(() => leerZoom(zoomClave));
  const [area, setArea] = useState({ w: 800, h: 600 });
  const [pagina, setPagina] = useState(1);
  // Texto del campo de pagina mientras se escribe (null = muestra la pagina actual).
  const [paginaTexto, setPaginaTexto] = useState<string | null>(null);
  const [cerca, setCerca] = useState<Set<number>>(() => new Set([1, 2]));
  // Miniaturas e indice cerrados por omision.
  const [panel, setPanel] = useState<"miniaturas" | "indice" | null>(null);
  const [indice, setIndice] = useState<NodoIndice[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [consultaTexto, setConsultaTexto] = useState("");
  const [consulta, setConsulta] = useState("");
  const [coincidencias, setCoincidencias] = useState<Coincidencia[]>([]);
  const [actual, setActual] = useState(0);
  const [nocturna, setNocturna] = useState(false);
  const [lectura, setLectura] = useState(false);
  const [completa, setCompleta] = useState(false);
  const [menuZoom, setMenuZoom] = useState(false);
  // Barra flotante: visible al empezar, se oculta sola al leer y reaparece con el cursor, el scroll hacia arriba o un toque.
  const [barra, setBarra] = useState(true);
  const [sobreBarra, setSobreBarra] = useState(false);
  const fijadaRef = useRef(false);
  const temporizadorBarra = useRef<number | null>(null);
  const ultimoTop = useRef(0);
  // Ultimo gesto de la persona: el scroll que hace el propio visor (al ajustar o saltar) no oculta la barra.
  const ultimoGesto = useRef(0);
  const raiz = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const buscarRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const textos = useRef<Map<number, string[]>>(new Map());
  const marcasPorPagina = useRef<Map<number, HTMLElement[]>>(new Map());
  const restaurada = useRef(false);
  const ocultarBarra = useCallback(() => {
    if (temporizadorBarra.current) window.clearTimeout(temporizadorBarra.current);
    temporizadorBarra.current = window.setTimeout(() => {
      if (!fijadaRef.current) setBarra(false);
    }, 3000);
  }, []);
  const mostrarBarra = useCallback(() => {
    setBarra(true);
    ocultarBarra();
  }, [ocultarBarra]);
  // Con la busqueda, el menu o el cursor sobre la barra, la barra no se oculta.
  const fijada = buscando || menuZoom || sobreBarra;
  useEffect(() => {
    fijadaRef.current = fijada;
    if (fijada) {
      if (temporizadorBarra.current) window.clearTimeout(temporizadorBarra.current);
    } else ocultarBarra();
  }, [fijada, ocultarBarra]);
  useEffect(() => () => {
    if (temporizadorBarra.current) window.clearTimeout(temporizadorBarra.current);
  }, []);

  // Cargar el PDF (progresivo) y su indice. `reintento` lo vuelve a intentar.
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    let doc: PdfDocumento | null = null;
    (async () => {
      try {
        doc = await abrirPdfUrl(url, token);
        if (!vivo) return;
        const p1 = await doc.getPage(1);
        const v = p1.getViewport({ scale: 1 });
        setBase({ w: v.width, h: v.height });
        setPdf(doc);
        mostrarBarra();
        const outline = (await doc.getOutline().catch(() => null)) as NodoIndice[] | null;
        if (vivo && outline?.length) setIndice(outline);
      } catch (err) {
        if (vivo) setError(err);
      }
    })();
    return () => {
      vivo = false;
      void doc?.loadingTask.destroy();
    };
  }, [url, token, reintento, mostrarBarra]);

  // Tamano del area visible (para ajustar al ancho o a la pagina).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const medir = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdf]);

  // El zoom elegido se recuerda por persona.
  useEffect(() => {
    try {
      window.localStorage.setItem(zoomClave, JSON.stringify(zoom));
    } catch {
      /* sin almacenamiento */
    }
  }, [zoom, zoomClave]);

  const escala = useMemo(() => {
    const anchoUtil = Math.max(200, Math.min(area.w - 48, ANCHO_LECTURA));
    if (zoom.modo === "ancho") return Math.min(anchoUtil / base.w, 4);
    if (zoom.modo === "pagina") return Math.min(anchoUtil / base.w, Math.max(200, area.h - 32) / base.h);
    return zoom.valor * PT_A_PX;
  }, [zoom, area, base]);
  const porcentaje = Math.round((escala / PT_A_PX) * 100);
  const total = pdf?.numPages || 0;

  // Paginas cercanas a la vista (se dibujan) y pagina actual (la mas visible).
  useEffect(() => {
    const raizScroll = scrollRef.current;
    if (!raizScroll || !pdf) return;
    const cercanas = new IntersectionObserver(
      (entradas) => {
        setCerca((prev) => {
          const sig = new Set(prev);
          for (const e of entradas) {
            const n = Number((e.target as HTMLElement).dataset.pagina);
            if (e.isIntersecting) sig.add(n);
          }
          return sig.size === prev.size ? prev : sig;
        });
      },
      { root: raizScroll, rootMargin: "800px 0px" },
    );
    const visibles = new Map<number, number>();
    const actualIo = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) visibles.set(Number((e.target as HTMLElement).dataset.pagina), e.intersectionRatio);
        let mejor = 0;
        let ratio = 0;
        for (const [n, r] of visibles) if (r > ratio || (r === ratio && n < mejor)) [mejor, ratio] = [n, r];
        if (mejor) setPagina(mejor);
      },
      { root: raizScroll, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of Array.from(raizScroll.querySelectorAll<HTMLElement>("[data-pagina]"))) {
      cercanas.observe(el);
      actualIo.observe(el);
    }
    return () => {
      cercanas.disconnect();
      actualIo.disconnect();
    };
  }, [pdf, total]);

  const irA = useCallback(
    (n: number, comportamiento: ScrollBehavior = "smooth") => {
      const destino = Math.min(Math.max(1, Math.round(n)), total || 1);
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-pagina="${destino}"]`);
      desplazarDentro(scrollRef.current, el, "start", comportamiento);
      setCerca((prev) => (prev.has(destino) ? prev : new Set(prev).add(destino)));
    },
    [total],
  );

  // Ultima pagina leida: se restaura al abrir y se guarda al avanzar.
  useEffect(() => {
    if (!pdf || restaurada.current) return;
    restaurada.current = true;
    const ultima = leerUltimaPagina(clave);
    if (ultima > 1 && ultima <= pdf.numPages) window.setTimeout(() => irA(ultima, "auto"), 60);
  }, [pdf, clave, irA]);
  useEffect(() => {
    if (!restaurada.current) return;
    try {
      window.localStorage.setItem(clave, String(pagina));
    } catch {
      /* sin almacenamiento */
    }
  }, [pagina, clave]);

  // Al cambiar la escala, la pagina actual sigue a la vista.
  const paginaRef = useRef(pagina);
  useEffect(() => {
    paginaRef.current = pagina;
  }, [pagina]);
  useEffect(() => {
    if (pdf) irA(paginaRef.current, "auto");
  }, [escala, pdf, irA]);

  const pasoZoom = useCallback(
    (dir: 1 | -1) => {
      const actualZ = escala / PT_A_PX;
      const sig = dir > 0 ? ZOOMS.find((z) => z > actualZ + 0.01) : [...ZOOMS].reverse().find((z) => z < actualZ - 0.01);
      setZoom({ modo: "valor", valor: sig ?? (dir > 0 ? Math.min(5, actualZ * 1.25) : Math.max(0.25, actualZ / 1.25)) });
    },
    [escala],
  );

  // Ctrl + rueda, pellizco, doble toque (acercar o ajustar) y deslizar entre paginas (tableta).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fijar = (factor: number) => setZoom((z) => ({ modo: "valor", valor: Math.min(5, Math.max(0.25, (z.modo === "valor" ? z.valor : escala / PT_A_PX) * factor)) }));
    const rueda = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      fijar(Math.exp(-e.deltaY * 0.0025));
    };
    let distancia = 0;
    let pellizco = false;
    let inicio: { x: number; y: number; x2: number; y2: number; t: number } | null = null;
    let tapAnterior: { x: number; y: number; t: number } | null = null;
    const pinzaMover = (e: TouchEvent) => {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (distancia) {
        e.preventDefault();
        fijar(d / distancia);
      }
      distancia = d;
    };
    const toque = (e: TouchEvent) => {
      if (e.type === "touchstart") {
        if (e.touches.length === 2) {
          pellizco = true;
          inicio = null;
          distancia = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        } else if (e.touches.length === 1) {
          pellizco = false;
          inicio = { x: e.touches[0].clientX, y: e.touches[0].clientY, x2: e.touches[0].clientX, y2: e.touches[0].clientY, t: Date.now() };
        }
        return;
      }
      if (e.type === "touchmove") {
        if (e.touches.length === 2) pinzaMover(e);
        else if (inicio) {
          // Ultima posicion del dedo: el gesto se mide hasta aqui (touchend no siempre trae el punto).
          inicio.x2 = e.touches[0].clientX;
          inicio.y2 = e.touches[0].clientY;
        }
        return;
      }
      // touchend: solo cuando se levanta el ultimo dedo.
      if (e.touches.length > 0) return;
      if (pellizco || !inicio) {
        pellizco = false;
        distancia = 0;
        inicio = null;
        return;
      }
      const termino = { clientX: inicio.x2, clientY: inicio.y2 };
      const dx = termino.clientX - inicio.x;
      const dy = termino.clientY - inicio.y;
      const duracion = Date.now() - inicio.t;
      const quieto = Math.hypot(dx, dy) < 12 && duracion < 300;
      if (quieto) {
        const ahora = Date.now();
        if (tapAnterior && ahora - tapAnterior.t < 320 && Math.hypot(termino.clientX - tapAnterior.x, termino.clientY - tapAnterior.y) < 30) {
          // Doble toque: alterna entre ajustar al ancho y 200 %.
          tapAnterior = null;
          setZoom((z) => (z.modo === "valor" && z.valor >= 2 ? { modo: "ancho" } : { modo: "valor", valor: 2 }));
        } else tapAnterior = { x: termino.clientX, y: termino.clientY, t: ahora };
      } else {
        tapAnterior = null;
        // Deslizar horizontal (sin desplazamiento lateral de la pagina) cambia de pagina.
        const sinDesplazamientoLateral = el.scrollWidth <= el.clientWidth + 1;
        if (sinDesplazamientoLateral && duracion < 600 && Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) irA(pagina + (dx < 0 ? 1 : -1));
      }
      inicio = null;
      pellizco = false;
      distancia = 0;
    };
    el.addEventListener("wheel", rueda, { passive: false });
    el.addEventListener("touchstart", toque, { passive: true });
    el.addEventListener("touchmove", toque, { passive: false });
    el.addEventListener("touchend", toque, { passive: true });
    return () => {
      el.removeEventListener("wheel", rueda);
      el.removeEventListener("touchstart", toque);
      el.removeEventListener("touchmove", toque);
      el.removeEventListener("touchend", toque);
    };
  }, [escala, irA, pagina]);

  // Busqueda en todo el documento: cuenta por fragmento de texto (igual que el resaltado).
  const buscar = useCallback(
    async (texto: string) => {
      const q = texto.trim().toLowerCase();
      setConsulta(q);
      setActual(0);
      if (!pdf || !q) return setCoincidencias([]);
      const encontradas: Coincidencia[] = [];
      for (let n = 1; n <= pdf.numPages; n += 1) {
        let partes = textos.current.get(n);
        if (!partes) {
          const contenido = await (await pdf.getPage(n)).getTextContent();
          partes = contenido.items.map((i) => ("str" in i ? i.str : ""));
          textos.current.set(n, partes);
        }
        let k = 0;
        for (const p of partes) {
          const bajo = p.toLowerCase();
          let i = bajo.indexOf(q);
          while (i >= 0) {
            encontradas.push({ pagina: n, k });
            k += 1;
            i = bajo.indexOf(q, i + q.length);
          }
        }
      }
      setCoincidencias(encontradas);
      if (encontradas.length) irA(encontradas[0].pagina);
    },
    [pdf, irA],
  );
  const actualC = coincidencias[actual];
  const irCoincidencia = (i: number) => {
    if (!coincidencias.length) return;
    const sig = (i + coincidencias.length) % coincidencias.length;
    setActual(sig);
    irA(coincidencias[sig].pagina);
  };
  const cerrarBusqueda = () => {
    setBuscando(false);
    setConsultaTexto("");
    void buscar("");
  };
  const onMarcas = useCallback((n: number, marcas: HTMLElement[]) => {
    marcasPorPagina.current.set(n, marcas);
  }, []);
  // Al cambiar de coincidencia, la marca actual se centra cuando su pagina ya esta dibujada.
  useEffect(() => {
    if (!actualC) return;
    const t = window.setTimeout(() => desplazarDentro(scrollRef.current, marcasPorPagina.current.get(actualC.pagina)?.[actualC.k], "center"), 250);
    return () => window.clearTimeout(t);
  }, [actualC]);

  const irDestino = async (dest: NodoIndice["dest"]) => {
    if (!pdf || !dest) return;
    try {
      const explicito = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      const ref = explicito?.[0];
      if (!ref) return;
      const indicePag = typeof ref === "number" ? ref : await pdf.getPageIndex(ref as Parameters<PdfDocumento["getPageIndex"]>[0]);
      irA(indicePag + 1);
    } catch {
      /* destino invalido */
    }
  };

  // Pantalla completa del navegador (sobre el propio visor).
  const pantallaCompleta = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await raiz.current?.requestFullscreen();
    } catch {
      /* el navegador no permitio la pantalla completa */
    }
  }, []);
  useEffect(() => {
    const cambio = () => setCompleta(document.fullscreenElement === raiz.current);
    document.addEventListener("fullscreenchange", cambio);
    return () => document.removeEventListener("fullscreenchange", cambio);
  }, []);

  // Modo Lectura: Esc lo cierra sin cerrar lo que lo contiene (captura antes que el resto).
  useEffect(() => {
    if (!lectura) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement).closest?.("input")) return;
      e.stopPropagation();
      setLectura(false);
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [lectura]);

  // Cerrar el menu de zoom al pulsar fuera.
  useEffect(() => {
    if (!menuZoom) return;
    const fuera = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuZoom(false);
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [menuZoom]);

  const alDesplazar = (e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    const porPersona = Date.now() - ultimoGesto.current < 500;
    if (porPersona && top > ultimoTop.current + 2) {
      if (!fijadaRef.current) setBarra(false);
    } else if (porPersona && top < ultimoTop.current - 2) mostrarBarra();
    ultimoTop.current = top;
  };
  const gesto = () => {
    ultimoGesto.current = Date.now();
  };

  const teclado = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    mostrarBarra();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      mostrarBarra();
      setBuscando(true);
      window.setTimeout(() => buscarRef.current?.focus(), 0);
      return;
    }
    if (e.key === "Escape" && menuZoom) {
      setMenuZoom(false);
      return;
    }
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      irA(pagina + 1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      irA(pagina - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      irA(1);
    } else if (e.key === "End") {
      e.preventDefault();
      irA(total);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      pasoZoom(1);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      pasoZoom(-1);
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      void pantallaCompleta();
    }
  };

  // Descargar e imprimir: solo con permiso (si no, el boton queda deshabilitado con su motivo).
  const descargar = acciones?.descargar ?? null;
  const imprimir = acciones?.imprimir ?? null;
  const motivoDescargar = acciones?.motivoDescargar || SIN_PERMISO_DESCARGAR;
  const motivoImprimir = acciones?.motivoImprimir || SIN_PERMISO_IMPRIMIR;

  if (error)
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center p-6">
        <div role="alert" className="flex flex-col items-center gap-3 text-center">
          <p className="text-[15px] font-semibold text-ink">No se pudo cargar el documento</p>
          <p className="max-w-md text-[13px] text-ink-3">{explicarError(error, "No se pudo abrir el PDF").hacer}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setReintento((r) => r + 1);
            }}
            className="press h-8 rounded-[8px] bg-surface px-3 text-[13px] font-medium text-ink shadow-card hover:bg-surface-2"
          >
            Reintentar
          </button>
        </div>
      </div>
    );

  return (
    <div
      ref={raiz}
      className={cn("relative flex h-full min-h-0 flex-col", lectura && "fixed inset-0 z-[var(--z-ventana)] h-auto bg-black/85")}
      data-testid="visor-pdf"
      data-lectura={lectura || undefined}
      onKeyDown={teclado}
      onPointerMove={mostrarBarra}
      onTouchStart={mostrarBarra}
    >
      <style>{ESTILOS}</style>

      <div className="flex min-h-0 flex-1">
        {panel && pdf ? (
          <aside className="hidden w-[168px] shrink-0 flex-col border-r border-line bg-surface md:flex" aria-label="Páginas del documento">
            {indice.length ? (
              <div className="flex gap-1 border-b border-line p-1.5" role="tablist" aria-label="Panel lateral">
                <button type="button" role="tab" aria-selected={panel === "miniaturas"} onClick={() => setPanel("miniaturas")} className={cn("press flex flex-1 items-center justify-center gap-1 rounded-[8px] py-1 text-[12px]", panel === "miniaturas" ? "bg-surface-3 text-ink" : "text-ink-3")}>
                  <SquaresFour size={14} /> Páginas
                </button>
                <button type="button" role="tab" aria-selected={panel === "indice"} onClick={() => setPanel("indice")} className={cn("press flex flex-1 items-center justify-center gap-1 rounded-[8px] py-1 text-[12px]", panel === "indice" ? "bg-surface-3 text-ink" : "text-ink-3")}>
                  <ListBullets size={14} /> Índice
                </button>
              </div>
            ) : null}
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2" data-testid="visor-miniaturas">
              {panel === "indice" && indice.length ? (
                <Indice nodos={indice} onIr={irDestino} />
              ) : (
                <div className="flex flex-col gap-1">
                  {Array.from({ length: total }, (_, i) => (
                    <Miniatura key={i + 1} pdf={pdf} n={i + 1} activa={pagina === i + 1} onIr={(n) => irA(n)} />
                  ))}
                </div>
              )}
            </div>
          </aside>
        ) : null}
        <div ref={scrollRef} tabIndex={0} onScroll={alDesplazar} onWheel={gesto} onTouchMove={gesto} onKeyDown={gesto} aria-label="Páginas del PDF" className={cn("scroll-thin relative min-h-0 flex-1 overflow-auto outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-brand)]", lectura ? "bg-transparent" : "bg-surface-3/70", nocturna && "visor-nocturna")}>
          {!pdf ? (
            // Silueta del mismo tamano y en el mismo lugar que tendra la primera pagina (hoja carta con el zoom elegido): al llegar el PDF no hay salto.
            <div className="flex min-w-max flex-col items-center gap-4 px-6 pt-5 pb-24" role="status" aria-label="Cargando el documento">
              <div className="rounded-[4px] bg-papel shadow-[0_1px_3px_rgba(16,32,43,0.18)]" style={{ width: base.w * escala, height: base.h * escala }}>
                <SilhuetaPagina className="h-full" />
              </div>
            </div>
          ) : (
            <div className="flex min-w-max flex-col items-center gap-4 px-6 pt-5 pb-24">
              {Array.from({ length: total }, (_, i) => (
                <PaginaPdf key={i + 1} pdf={pdf} n={i + 1} escala={escala} base={base} cerca={cerca.has(i + 1)} consulta={consulta} actualK={actualC && actualC.pagina === i + 1 ? actualC.k : -1} onMarcas={onMarcas} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Barra flotante: una sola, centrada abajo. */}
      <div
        role="toolbar"
        aria-label="Controles del documento"
        onPointerEnter={() => setSobreBarra(true)}
        onPointerLeave={() => setSobreBarra(false)}
        onFocus={mostrarBarra}
        className={cn(
          "absolute inset-x-0 bottom-4 z-20 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-1 rounded-[18px] border border-line/70 bg-surface/85 px-2 py-1 sm:rounded-full text-ink-2 shadow-card backdrop-blur-md transition-[opacity,translate] duration-200 motion-reduce:transition-none",
          barra ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
        )}
        data-testid="visor-barra"
      >
        <span className="hidden md:contents">
          <IconButton label={panel ? "Ocultar panel lateral" : "Mostrar miniaturas"} onClick={() => setPanel((p) => (p ? null : "miniaturas"))} aria-pressed={!!panel}>
            <SidebarSimple size={17} />
          </IconButton>
        </span>
        <IconButton label="Página anterior" onClick={() => irA(pagina - 1)} disabled={pagina <= 1}>
          <CaretLeft size={16} weight="bold" />
        </IconButton>
        <label className="flex items-center gap-1 text-[13px] text-ink-2">
          <span className="sr-only">Página</span>
          <input
            data-testid="visor-pagina-actual"
            value={paginaTexto ?? String(pagina)}
            inputMode="numeric"
            onChange={(e) => setPaginaTexto(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                irA(Number(paginaTexto ?? pagina) || 1);
                setPaginaTexto(null);
              }
            }}
            onBlur={() => setPaginaTexto(null)}
            aria-label="Página actual"
            className="tnum h-8 w-11 rounded-[8px] border border-line bg-surface-2 px-1.5 text-center text-[13px] text-ink focus:border-brand/55 focus:outline-none"
          />
          <span className="tnum whitespace-nowrap">
            de <span data-testid="visor-total-paginas">{total || "…"}</span>
          </span>
        </label>
        <IconButton label="Página siguiente" onClick={() => irA(pagina + 1)} disabled={!total || pagina >= total}>
          <CaretRight size={16} weight="bold" />
        </IconButton>

        <div className="mx-0.5 hidden h-5 w-px bg-line sm:block" />

        <IconButton label="Alejar (−)" onClick={() => pasoZoom(-1)}>
          <MagnifyingGlassMinus size={17} />
        </IconButton>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuZoom((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuZoom}
            aria-label="Zoom"
            title="Zoom"
            className="press flex h-8 items-center gap-0.5 rounded-[8px] px-1.5 text-[12.5px] text-ink hover:bg-surface-3/80"
          >
            <span data-testid="visor-zoom" className="tnum min-w-[3.2rem] text-center">
              {porcentaje} %
            </span>
            <CaretDown size={11} />
          </button>
          {menuZoom ? (
            <div role="menu" aria-label="Opciones de zoom" className="absolute bottom-full left-1/2 mb-2 flex w-44 -translate-x-1/2 flex-col rounded-[12px] border border-line bg-surface p-1 text-[13px] shadow-card">
              {[
                { etiqueta: "Ajustar al ancho", zoom: { modo: "ancho" } as Zoom },
                { etiqueta: "Página completa", zoom: { modo: "pagina" } as Zoom },
                { etiqueta: "100 %", zoom: { modo: "valor", valor: 1 } as Zoom },
              ].map((op) => (
                <button
                  key={op.etiqueta}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setZoom(op.zoom);
                    setMenuZoom(false);
                  }}
                  className="press rounded-[8px] px-2.5 py-1.5 text-left text-ink-2 hover:bg-surface-3 hover:text-ink"
                >
                  {op.etiqueta}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <IconButton label="Acercar (+)" onClick={() => pasoZoom(1)}>
          <MagnifyingGlassPlus size={17} />
        </IconButton>

        <div className="mx-0.5 hidden h-5 w-px bg-line sm:block" />

        {buscando ? (
          <div className="flex items-center gap-1">
            <input
              ref={buscarRef}
              data-testid="visor-buscar"
              type="search"
              value={consultaTexto}
              placeholder="Buscar en el documento"
              aria-label="Buscar en el documento"
              onChange={(e) => setConsultaTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (consultaTexto.trim().toLowerCase() === consulta && coincidencias.length) irCoincidencia(actual + (e.shiftKey ? -1 : 1));
                  else void buscar(consultaTexto);
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  cerrarBusqueda();
                }
              }}
              className="h-8 w-32 rounded-[8px] border border-line bg-surface-2 px-2 text-[13px] text-ink focus:border-brand/55 focus:outline-none sm:w-48"
            />
            <span data-testid="visor-resultados" className="tnum min-w-[4.5rem] text-center text-[12px] text-ink-3" aria-live="polite">
              {consulta ? (coincidencias.length ? `${actual + 1} de ${coincidencias.length}` : "Sin resultados") : ""}
            </span>
            <IconButton label="Coincidencia anterior" onClick={() => irCoincidencia(actual - 1)} disabled={!coincidencias.length}>
              <CaretLeft size={15} />
            </IconButton>
            <IconButton label="Coincidencia siguiente" onClick={() => irCoincidencia(actual + 1)} disabled={!coincidencias.length}>
              <CaretRight size={15} />
            </IconButton>
            <IconButton label="Cerrar búsqueda" onClick={cerrarBusqueda}>
              <X size={15} />
            </IconButton>
          </div>
        ) : (
          <IconButton
            label="Buscar en el documento (Ctrl+F)"
            onClick={() => {
              setBuscando(true);
              window.setTimeout(() => buscarRef.current?.focus(), 0);
            }}
          >
            <MagnifyingGlass size={17} />
          </IconButton>
        )}
        <IconButton label={nocturna ? "Quitar lectura nocturna" : "Lectura nocturna"} onClick={() => setNocturna((v) => !v)} aria-pressed={nocturna} className={nocturna ? "bg-brand-soft text-brand-strong" : undefined}>
          <MoonStars size={17} weight={nocturna ? "fill" : "regular"} />
        </IconButton>
        <IconButton label={lectura ? "Salir del modo Lectura (Esc)" : "Modo Lectura"} onClick={() => setLectura((v) => !v)} aria-pressed={lectura}>
          <BookOpenText size={17} />
        </IconButton>
        <IconButton label={completa ? "Salir de pantalla completa (F)" : "Pantalla completa (F)"} onClick={() => void pantallaCompleta()}>
          {completa ? <CornersIn size={17} /> : <CornersOut size={17} />}
        </IconButton>

        <div className="mx-0.5 hidden h-5 w-px bg-line sm:block" />

        <IconButton label={descargar ? "Descargar" : `Descargar: ${motivoDescargar}`} onClick={descargar ?? undefined} disabled={!descargar}>
          <DownloadSimple size={17} />
        </IconButton>
        <IconButton label={imprimir ? "Imprimir" : `Imprimir: ${motivoImprimir}`} onClick={imprimir ?? undefined} disabled={!imprimir}>
          <Printer size={17} />
        </IconButton>
      </div>
    </div>
  );
}
