"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CaretLeft, CaretRight, ListBullets, MagnifyingGlass, MagnifyingGlassMinus, MagnifyingGlassPlus, MoonStars, SidebarSimple, SquaresFour, X } from "@phosphor-icons/react";
import { useSession } from "@/components/session/SessionProvider";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { explicarError } from "@/lib/client/mensajes";
import { abrirPdfUrl, cargarPdfjs, type PdfDocumento } from "@/lib/client/pdf";

/*
 * Visor interno de PDF (Documentos SGC, informes) con pdf.js (carga progresiva por rangos):
 * - solo se dibujan las paginas cercanas a la vista (IntersectionObserver);
 * - capa de texto (TextLayer) para seleccionar y buscar con resaltado;
 * - miniaturas plegables e indice del PDF (getOutline) si lo tiene;
 * - zoom: ajustar al ancho, a la pagina, porcentajes, Ctrl + rueda y pellizco;
 * - pagina N de M, flechas y teclado (←/→, RePag/AvPag, Inicio/Fin, Ctrl+F);
 * - recuerda la ultima pagina leida por persona y documento.
 */

/* 100 % = tamano real (pt a px CSS). */
const PT_A_PX = 96 / 72;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
type Zoom = { modo: "ancho" } | { modo: "pagina" } | { modo: "valor"; valor: number };

interface Coincidencia {
  pagina: number;
  /* Indice de la coincidencia dentro de la pagina (orden de los fragmentos de texto). */
  k: number;
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
/* Lectura nocturna: solo en pantalla invierte suavemente la pagina (no cambia el documento ni lo impreso). */
.visor-nocturna [data-pagina] { filter: invert(0.88) hue-rotate(180deg) contrast(0.95); }
[data-pagina] { transition: filter 260ms ease; }
@media print { .visor-nocturna [data-pagina] { filter: none; } }
@media (prefers-reduced-motion: reduce) { [data-pagina] { transition: none; } }
.visor-resaltado-actual { background: color-mix(in srgb, var(--color-bloom) 60%, transparent); box-shadow: 0 0 0 1px var(--color-bloom); }
`;

const claveUltimaPagina = (usuario: unknown, docId: number | string, ambito: string) => `ficotox.${ambito}.pagina.${String(usuario || "anon")}.${docId}`;
const leerUltimaPagina = (clave: string): number => {
  try {
    return Number(window.localStorage.getItem(clave)) || 1;
  } catch {
    return 1;
  }
};

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
    (async () => {
      const pagina = await pdf.getPage(n);
      if (cancelada) return;
      const vistaBase = pagina.getViewport({ scale: 1 });
      setTam((prev) => (prev && prev.w === vistaBase.width && prev.h === vistaBase.height ? prev : { w: vistaBase.width, h: vistaBase.height }));
      const vista = pagina.getViewport({ scale: escala });
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
    })();
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
      {dibujada === null ? <span className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-4">Página {n}</span> : null}
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
    });
    io.observe(el);
    return () => {
      cancelada = true;
      io.disconnect();
    };
  }, [pdf, n, url]);
  useEffect(() => {
    if (activa) ref.current?.scrollIntoView({ block: "nearest" });
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

/* `url`: archivo protegido (con Range); `ambito` y `docId`: clave de la ultima pagina leida. */
export function VisorPdf({ url, ambito, docId, compacto }: { url: string; ambito: string; docId: number | string; compacto: boolean }) {
  const { token, user } = useSession();
  const [pdf, setPdf] = useState<PdfDocumento | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [base, setBase] = useState<{ w: number; h: number }>({ w: 612, h: 792 });
  const [zoom, setZoom] = useState<Zoom>({ modo: "ancho" });
  const [area, setArea] = useState({ w: 800, h: 600 });
  const [pagina, setPagina] = useState(1);
  // Texto del campo de pagina mientras se escribe (null = muestra la pagina actual).
  const [paginaTexto, setPaginaTexto] = useState<string | null>(null);
  const [cerca, setCerca] = useState<Set<number>>(() => new Set([1, 2]));
  // Miniaturas abiertas en pantallas medianas o grandes; en la angosta, ocultas.
  const [panel, setPanel] = useState<"miniaturas" | "indice" | null>(() => (compacto && typeof window !== "undefined" && !window.matchMedia("(min-width: 768px)").matches ? null : "miniaturas"));
  const [indice, setIndice] = useState<NodoIndice[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [consultaTexto, setConsultaTexto] = useState("");
  const [consulta, setConsulta] = useState("");
  const [coincidencias, setCoincidencias] = useState<Coincidencia[]>([]);
  const [actual, setActual] = useState(0);
  // Lectura nocturna (opcional, no se guarda en el documento).
  const [nocturna, setNocturna] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const buscarRef = useRef<HTMLInputElement | null>(null);
  const textos = useRef<Map<number, string[]>>(new Map());
  const marcasPorPagina = useRef<Map<number, HTMLElement[]>>(new Map());
  const clavePagina = claveUltimaPagina(user?.id || user?.email, docId, ambito);
  const restaurada = useRef(false);

  // Cargar el PDF (progresivo) y su indice.
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
  }, [url, token]);

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

  const escala = useMemo(() => {
    const anchoUtil = Math.max(200, area.w - 48);
    if (zoom.modo === "ancho") return Math.min(anchoUtil / base.w, 4);
    if (zoom.modo === "pagina") return Math.min(anchoUtil / base.w, Math.max(200, area.h - 32) / base.h);
    return zoom.valor * PT_A_PX;
  }, [zoom, area, base]);
  const porcentaje = Math.round((escala / PT_A_PX) * 100);
  const total = pdf?.numPages || 0;

  // Paginas cercanas a la vista (se dibujan) y pagina actual (la mas visible).
  useEffect(() => {
    const raiz = scrollRef.current;
    if (!raiz || !pdf) return;
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
      { root: raiz, rootMargin: "800px 0px" },
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
      { root: raiz, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of Array.from(raiz.querySelectorAll<HTMLElement>("[data-pagina]"))) {
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
      el?.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : comportamiento });
      setCerca((prev) => (prev.has(destino) ? prev : new Set(prev).add(destino)));
    },
    [total],
  );

  // Ultima pagina leida: se restaura al abrir y se guarda al avanzar.
  useEffect(() => {
    if (!pdf || restaurada.current) return;
    restaurada.current = true;
    const ultima = leerUltimaPagina(clavePagina);
    if (ultima > 1 && ultima <= pdf.numPages) window.setTimeout(() => irA(ultima, "auto"), 60);
  }, [pdf, clavePagina, irA]);
  useEffect(() => {
    if (!restaurada.current) return;
    try {
      window.localStorage.setItem(clavePagina, String(pagina));
    } catch {
      /* sin almacenamiento */
    }
  }, [pagina, clavePagina]);

  // Al cambiar la escala, la pagina actual sigue a la vista.
  const paginaRef = useRef(pagina);
  useEffect(() => {
    paginaRef.current = pagina;
  }, [pagina]);
  useEffect(() => {
    if (pdf) irA(paginaRef.current, "auto");
  }, [escala, pdf, irA]);

  // Ctrl + rueda y pellizco.
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
    const toque = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (e.type === "touchstart") distancia = d;
      else if (distancia) {
        e.preventDefault();
        fijar(d / distancia);
        distancia = d;
      }
    };
    el.addEventListener("wheel", rueda, { passive: false });
    el.addEventListener("touchstart", toque, { passive: true });
    el.addEventListener("touchmove", toque, { passive: false });
    return () => {
      el.removeEventListener("wheel", rueda);
      el.removeEventListener("touchstart", toque);
      el.removeEventListener("touchmove", toque);
    };
  }, [escala]);

  const pasoZoom = (dir: 1 | -1) => {
    const actualZ = escala / PT_A_PX;
    const sig = dir > 0 ? ZOOMS.find((z) => z > actualZ + 0.01) : [...ZOOMS].reverse().find((z) => z < actualZ - 0.01);
    setZoom({ modo: "valor", valor: sig ?? (dir > 0 ? Math.min(5, actualZ * 1.25) : Math.max(0.25, actualZ / 1.25)) });
  };

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
  const onMarcas = useCallback((n: number, marcas: HTMLElement[]) => {
    marcasPorPagina.current.set(n, marcas);
  }, []);
  // Al cambiar de coincidencia, la marca actual se centra cuando su pagina ya esta dibujada.
  useEffect(() => {
    if (!actualC) return;
    const t = window.setTimeout(() => marcasPorPagina.current.get(actualC.pagina)?.[actualC.k]?.scrollIntoView({ block: "center" }), 250);
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

  const teclado = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setBuscando(true);
      window.setTimeout(() => buscarRef.current?.focus(), 0);
      return;
    }
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
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
    }
  };

  if (error) return <div className="p-6"><ErrorState message={explicarError(error, "No se pudo abrir el PDF").que} /></div>;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="visor-pdf" onKeyDown={teclado}>
      <style>{ESTILOS}</style>
      {/* Barra del PDF: paneles, pagina, zoom y busqueda. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-2 py-1.5 sm:gap-2 sm:px-3">
        <span className="hidden md:contents">
          <IconButton label={panel ? "Ocultar panel lateral" : "Mostrar miniaturas"} onClick={() => setPanel((p) => (p ? null : "miniaturas"))} aria-pressed={!!panel}>
            <SidebarSimple size={17} />
          </IconButton>
        </span>
        <div className="flex items-center gap-1">
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
              className="tnum h-8 w-12 rounded-[8px] border border-line bg-surface-2 px-1.5 text-center text-[13px] text-ink focus:border-brand/55 focus:outline-none"
            />
            <span className="tnum whitespace-nowrap">
              de <span data-testid="visor-total-paginas">{total || "…"}</span>
            </span>
          </label>
          <IconButton label="Página siguiente" onClick={() => irA(pagina + 1)} disabled={!total || pagina >= total}>
            <CaretRight size={16} weight="bold" />
          </IconButton>
        </div>
        <div className="mx-0.5 hidden h-5 w-px bg-line sm:block" />
        <div className="flex items-center gap-1">
          <IconButton label="Alejar" onClick={() => pasoZoom(-1)}>
            <MagnifyingGlassMinus size={17} />
          </IconButton>
          <select
            aria-label="Zoom"
            value={zoom.modo === "valor" ? "valor" : zoom.modo}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "ancho" || v === "pagina") setZoom({ modo: v });
              else if (v !== "valor") setZoom({ modo: "valor", valor: Number(v) });
            }}
            className="h-8 rounded-[8px] border border-line bg-surface-2 px-1.5 text-[12.5px] text-ink focus:border-brand/55 focus:outline-none"
          >
            <option value="ancho">Ajustar al ancho</option>
            <option value="pagina">Ajustar a la página</option>
            {zoom.modo === "valor" && !ZOOMS.includes(zoom.valor) ? <option value="valor">{porcentaje} %</option> : null}
            {ZOOMS.map((z) => (
              <option key={z} value={zoom.modo === "valor" && zoom.valor === z ? "valor" : z}>
                {Math.round(z * 100)} %
              </option>
            ))}
          </select>
          <IconButton label="Acercar" onClick={() => pasoZoom(1)}>
            <MagnifyingGlassPlus size={17} />
          </IconButton>
          <span data-testid="visor-zoom" className="tnum hidden min-w-[3.2rem] text-right text-[12px] text-ink-3 sm:inline">
            {porcentaje} %
          </span>
          <IconButton label={nocturna ? "Quitar lectura nocturna" : "Lectura nocturna"} onClick={() => setNocturna((v) => !v)} aria-pressed={nocturna} className={nocturna ? "bg-brand-soft text-brand-strong" : undefined}>
            <MoonStars size={17} weight={nocturna ? "fill" : "regular"} />
          </IconButton>
        </div>
        <div className="ml-auto flex items-center gap-1">
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
                    setBuscando(false);
                    setConsultaTexto("");
                    void buscar("");
                  }
                }}
                className="h-8 w-36 rounded-[8px] border border-line bg-surface-2 px-2 text-[13px] text-ink focus:border-brand/55 focus:outline-none sm:w-52"
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
              <IconButton
                label="Cerrar búsqueda"
                onClick={() => {
                  setBuscando(false);
                  setConsultaTexto("");
                  void buscar("");
                }}
              >
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
        </div>
      </div>

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
        <div ref={scrollRef} tabIndex={0} aria-label="Páginas del PDF" className={cn("scroll-thin relative min-h-0 flex-1 overflow-auto bg-surface-3/70 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-brand)]", nocturna && "visor-nocturna")}>
          {!pdf ? (
            <div className="mx-auto flex max-w-[720px] flex-col gap-4 p-6">
              <Skeleton className="h-[480px] w-full" />
            </div>
          ) : (
            <div className="flex min-w-max flex-col items-center gap-4 px-6 py-5">
              {Array.from({ length: total }, (_, i) => (
                <PaginaPdf key={i + 1} pdf={pdf} n={i + 1} escala={escala} base={base} cerca={cerca.has(i + 1)} consulta={consulta} actualK={actualC && actualC.pagina === i + 1 ? actualC.k : -1} onMarcas={onMarcas} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
