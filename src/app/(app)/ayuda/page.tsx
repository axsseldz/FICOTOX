"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ArrowsClockwise, BookOpenText, ClockCounterClockwise, Cube, FileText, Files, Flask, Keyboard, MagnifyingGlass, Prohibit, SealCheck, TestTube, UserCircle, WarningCircle } from "@phosphor-icons/react";
import { PageBody } from "@/components/shell/AppShell";
import { useSession } from "@/components/session/SessionProvider";
import { cn } from "@/components/ui/cn";
import { Atajo, Kbd } from "@/components/ui/Primitives";
import { HELP_TOPICS } from "@/lib/shared/busqueda";

/*
 * Ayuda: el manual de uso resumido, dentro de la plataforma. Una columna con
 * el índice (sigue el scroll) y secciones cortas con pasos concretos. Los
 * anclas coinciden con HELP_TOPICS, así el buscador abre la sección exacta.
 */

const SECTIONS: Array<{ anchor: string; title: string; icon: ReactNode }> = [
  { anchor: "empezar", title: "Cómo usar la plataforma", icon: <BookOpenText size={16} /> },
  { anchor: "cuenta", title: "Tu cuenta y la sesión", icon: <UserCircle size={16} /> },
  { anchor: "buscar", title: "Buscar", icon: <MagnifyingGlass size={16} /> },
  { anchor: "muestras", title: "Flujo de una muestra", icon: <TestTube size={16} /> },
  { anchor: "extraccion", title: "Extracciones ASP y DSP", icon: <Flask size={16} /> },
  { anchor: "analisis", title: "Análisis y firmas", icon: <SealCheck size={16} /> },
  { anchor: "informes", title: "Informes", icon: <FileText size={16} /> },
  { anchor: "inventario", title: "Inventario y avisos", icon: <Cube size={16} /> },
  { anchor: "calidad", title: "Calidad y auditoría", icon: <ArrowsClockwise size={16} /> },
  { anchor: "respaldos", title: "Respaldos", icon: <ClockCounterClockwise size={16} /> },
  { anchor: "documentos", title: "Documentos SGC", icon: <Files size={16} /> },
  { anchor: "anular", title: "Corregir un registro", icon: <Prohibit size={16} /> },
  { anchor: "atajos", title: "Atajos", icon: <Keyboard size={16} /> },
];

/* Al llegar con #ancla (desde el buscador o un enlace) la página se pinta después de la navegación: hay que desplazarse a mano. */
function useHashScroll(): void {
  useEffect(() => {
    const jump = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    const timer = window.setTimeout(jump, 50);
    window.addEventListener("hashchange", jump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", jump);
    };
  }, []);
}

function useActiveSection(): string {
  const [active, setActive] = useState(SECTIONS[0].anchor);
  useEffect(() => {
    const targets = SECTIONS.map((s) => document.getElementById(s.anchor)).filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: 0 },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return active;
}

function Section({ anchor, title, lead, children }: { anchor: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={anchor} className="scroll-mt-24 flex flex-col gap-4 rounded-card bg-surface p-6 shadow-card sm:p-7">
      <header className="flex flex-col gap-1">
        <h2 className="title-2 text-ink">{title}</h2>
        {lead ? <p className="max-w-[62ch] text-base leading-relaxed text-ink-3">{lead}</p> : null}
      </header>
      <div className="flex max-w-[68ch] flex-col gap-3 text-base leading-relaxed text-ink-2 [&_b]:font-semibold [&_b]:text-ink [&_kbd]:align-middle">{children}</div>
    </section>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span className="tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-strong">{index + 1}</span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Tip({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <p className={cn("flex gap-2.5 rounded-field px-3.5 py-3 text-sm", tone === "warn" ? "bg-warning-soft text-warning-text" : "bg-brand-faint text-brand-strong")}>
      <WarningCircle size={17} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Go({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-strong">
      {children} <ArrowRight size={12} weight="bold" />
    </Link>
  );
}

export default function AyudaPage() {
  const { can } = useSession();
  const active = useActiveSection();
  useHashScroll();

  return (
    <PageBody className="gap-6">
      <header className="flex flex-col gap-1">
        <p className="eyebrow text-brand-strong">Ayuda</p>
        <h1 className="display text-4xl text-ink sm:text-5xl">Cómo se usa FICOTOX</h1>
        <p className="max-w-[62ch] text-base text-ink-3">Lo esencial de cada parte del sistema en pasos cortos. Si buscas algo concreto, escríbelo en el buscador: los temas de esta guía también aparecen ahí.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Índice" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <ol className="scroll-thin flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {SECTIONS.map((section) => {
              const current = section.anchor === active;
              return (
                <li key={section.anchor} className="shrink-0">
                  <a href={`#${section.anchor}`} aria-current={current ? "location" : undefined} className={cn("press flex h-9 items-center gap-2.5 whitespace-nowrap rounded-field px-2.5 text-sm transition-colors", current ? "bg-brand-soft font-medium text-brand-strong" : "text-ink-2 hover:bg-surface-3/80 hover:text-ink")}>
                    <span className={cn("shrink-0", current ? "text-brand" : "text-ink-4")}>{section.icon}</span>
                    {section.title}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col gap-5">
          <Section anchor="empezar" title="Cómo usar la plataforma" lead="FICOTOX lleva el registro del laboratorio: las muestras desde que llegan hasta que se informa el resultado, y el inventario que se usa en el camino. Todo lo que se hace queda en una bitácora.">
            <Steps
              items={[
                <>
                  <b>Empieza por el buscador del Inicio.</b> Escribe un folio, un reactivo, un equipo o lo que quieras hacer («nueva recepción», «informes por revisar») y te lleva ahí. Desde cualquier pantalla: <Atajo atajo="Mod+K" />.
                </>,
                <>
                  <b>El Inicio te dice qué toca.</b> Bajo el saludo aparecen tus pendientes más urgentes (por autorizar, stock bajo, calibraciones, informes por liberar o enviar…); cada uno abre su lista ya filtrada. La campana avisa de lo nuevo que te toca.
                </>,
                <>
                  <b>Cada formato se llena paso a paso.</b> La guía de la izquierda marca en verde las secciones completas; no se puede guardar sin la información mínima. Con «Todo» ves el formato completo.
                </>,
                <>
                  <b>Nada se borra.</b> Si algo se capturó mal, se anula con motivo (y se puede restaurar). Fuera de borrador, la anulación la aprueba una segunda persona en «Por autorizar». Así el expediente siempre cuenta la historia completa.
                </>,
              ]}
            />
            <p>
              Lo que ves depende de tu rol: si una sección no aparece en la barra lateral, tu cuenta no tiene ese permiso. Pídeselo a quien administra los usuarios.
            </p>
          </Section>

          <Section anchor="cuenta" title="Tu cuenta y la sesión" lead="Entras con tu correo y tu contraseña. Tu cuenta, tu foto y la apariencia se cambian en Mi cuenta (tu nombre, abajo en la barra lateral).">
            <ul className="flex flex-col gap-2">
              <li>
                <b>Primer ingreso:</b> una cuenta nueva, o una contraseña que restableció quien administra los usuarios, llega con una contraseña temporal. Al entrar, el sistema te pide cambiarla antes de seguir (mínimo 10 caracteres). Después la cambias cuando quieras en <b>Mi cuenta › Cambiar contraseña</b>.
              </li>
              <li>
                <b>Cerrar sesión:</b> abre el menú de tu nombre en la barra lateral y elige <b>Cerrar sesión</b>, o escribe «cerrar sesión» en el buscador. En Mi cuenta, <b>Cerrar sesión en todos los dispositivos</b> cierra también las que dejaste abiertas en otras computadoras.
              </li>
              <li>
                <b>Inactividad:</b> tras un rato sin usar la plataforma (30 minutos por omisión) la sesión se cierra sola; un minuto antes aparece un aviso para continuar. Lo que estabas capturando se conserva debajo: vuelve a escribir tu contraseña y sigues donde ibas.
              </li>
              <li>
                <b>Varios roles:</b> si tienes más de un cargo, al firmar o aprobar el sistema te pregunta con cuál actúas y lo deja registrado.
              </li>
            </ul>
          </Section>

          <Section anchor="buscar" title="Buscar" lead="Un solo buscador encuentra registros, crea formatos nuevos y abre listas ya filtradas.">
            <ul className="flex flex-col gap-2">
              <li>
                <b>Folios:</b> «R 3», «E-D 1», «A 0000002», «IR 4». Da igual si escribes espacios o guiones.
              </li>
              <li>
                <b>Registros por su contenido:</b> el solicitante de una recepción, el ID interno de una muestra, el nombre o lote de un reactivo, la marca de un equipo, el técnico de un mantenimiento.
              </li>
              <li>
                <b>Acciones:</b> «nueva» lista todo lo que puedes crear; «nueva extracción ASP» abre directo ese formato; «reponer metanol» abre «Registrar movimiento» de ese reactivo.
              </li>
              <li>
                <b>Vistas por estado:</b> «stock bajo», «por revisar», «calibración», «mantenimientos vencidos», «enviados».
              </li>
              <li>
                <b>Ayuda:</b> «cómo anular», «atajos» abren la sección de esta guía.
              </li>
            </ul>
            <p>
              Los resultados llegan agrupados (muestras, informes, inventario, acciones…) y, si hay más, «Ver todos en…» abre la lista completa ya filtrada. Sin escribir nada, el buscador muestra lo último que buscaste o abriste; puedes quitar uno o borrarlos todos.
            </p>
          </Section>

          <Section anchor="muestras" title="Flujo de una muestra" lead="Cinco etapas, cada una con su folio. La siguiente solo se puede registrar cuando la anterior está lista.">
            <Steps
              items={[
                <>
                  <b>Recepción (R).</b> Quién entrega, qué muestra o lote, análisis solicitado, inspección visual (7 requisitos) y la <b>decisión de aceptación</b>. Sin decisión, o con la muestra rechazada, no se puede seguir. {can("muestras", "C", { objeto: "recepcion", borrador: true }) ? <Go href="/muestras/recepcion/nueva">Nueva recepción</Go> : null}
                </>,
                <>
                  <b>Procesamiento (P).</b> Lavado, desconche y molienda; equipo usado en cada paso y peso de la molienda. Descuenta las bolsas del inventario.
                </>,
                <>
                  <b>Extracción (E-A o E-D).</b> Un formato por toxina; pesos por tubo, equipos con folio de bitácora e insumos que se descuentan por tubo.
                </>,
                <>
                  <b>Análisis (A).</b> Resultados por muestra, controles de calidad, equipo y condiciones. Después se <b>revisa</b> y se <b>aprueba</b>.
                </>,
                <>
                  <b>Informe (IR).</b> Se elabora con los análisis aprobados, se revisa, se <b>autoriza</b>, se <b>libera</b> (genera el PDF final) y se <b>envía</b> al cliente. Al final se registra la <b>disposición final</b> de los remanentes en la recepción y la muestra queda cerrada; la disposición solo se puede registrar con el informe <b>liberado o enviado</b> (una muestra rechazada en la recepción se dispone sin informe, con motivo).
                </>,
              ]}
            />
            <p>
              Los estados avanzan solos: la recepción pasa por <b>En procesamiento</b>, <b>En extracción</b>, <b>En análisis</b>, <b>En revisión técnica</b>, <b>Validada</b>, <b>Informe elaborado</b> y <b>Liberada</b>, y queda <b>Cerrada</b> con la disposición final. Desde la fila de una recepción, procesamiento o extracción puedes saltar a la etapa siguiente con el folio ya vinculado.
            </p>
          </Section>

          <Section anchor="extraccion" title="Extracciones ASP y DSP" lead="Cada formato sigue su protocolo y lleva su propia serie de folios: E-A (ácido domoico) y E-D (toxinas lipofílicas).">
            <ul className="flex flex-col gap-2">
              <li>
                <b>Se llena solo lo que se puede.</b> Al elegir el procesamiento se cargan las muestras y el blanco en la tabla de pesos; los equipos que solo existen una vez en el catálogo (y con calibración vigente) se eligen solos; el folio de bitácora sugiere el siguiente al último usado; el folio de preparación de una solución sale de su lote.
              </li>
              <li>
                <b>Lo que sí hay que escribir:</b> pesos, folio de verificación de la balanza (viene de la bitácora física), y los pasos opcionales (limpieza SAX en ASP, hidrólisis en DSP).
              </li>
              <li>
                <b>Insumos por tubo.</b> Muestras y blanco, cada uno con réplica: el aviso bajo cada campo dice cuánto se descontará («9 mL × 4 tubos»).
              </li>
              <li>
                <b>Equipos con alerta.</b> Si un equipo está en mantenimiento o con calibración vencida, se avisa y se pide confirmación; no se bloquea.
              </li>
            </ul>
            <Tip>Las personas (quién extrajo, quién supervisó) se eligen de la lista del personal autorizado; el cargo no se captura: se guarda el del rol con el que actúa quien firma.</Tip>
          </Section>

          <Section anchor="analisis" title="Análisis, revisión y aprobación" lead="El análisis captura lo medido en el extracto y pasa por dos firmas antes de poder informarse.">
            <Steps
              items={[
                <>
                  Elige tipo y método: el sistema sugiere método, referencia e instrumento según la toxina, y las muestras vienen de la extracción.
                </>,
                <>
                  Captura resultado, unidad, límites e incertidumbre por muestra; la <b>conformidad</b> se sugiere comparando con el límite regulatorio (ASP 20 µg/g, DSP 160 µg/kg).
                </>,
                <>
                  Registra los controles de calidad (blanco, material de referencia, duplicado) y presiona <b>Registrar análisis</b>.
                </>,
                <>
                  <b>Marcar revisado</b> y luego <b>Aprobar</b> (permisos de revisar y aprobar ensayos). Quien elaboró o editó el análisis no puede revisarlo ni aprobarlo; revisor y aprobador sí pueden ser la misma persona. Si tienes varios roles que lo permiten, el sistema te pregunta con qué cargo actúas. Un análisis aprobado ya no se edita: si está mal, se corrige con una <b>enmienda</b> (nueva versión con el mismo folio).
                </>,
              ]}
            />
          </Section>

          <Section anchor="informes" title="Informes de resultados" lead="El informe (folio IR) es lo que recibe el cliente. Lo genera el sistema en PDF con firma y huella digital.">
            <Steps
              items={[
                <>
                  <b>Crear:</b> elige la recepción; se cargan cliente, ítems ensayados y los análisis aprobados. Revisa las declaraciones (alcance, regla de decisión, desviaciones) y crea el borrador. {can("informes", "C") ? <Go href="/informes/nuevo">Nuevo informe</Go> : null}
                </>,
                <>
                  <b>Marcar revisado</b> y <b>Autorizar</b> con firma. Quien elaboró el informe o alguno de sus análisis no lo revisa ni lo autoriza.
                </>,
                <>
                  <b>Liberar:</b> los resultados quedan congelados y se genera el PDF final con su huella SHA-256. Después, <b>Registrar envío</b> (fecha, medio y destinatario) o «Enviar desde la plataforma» si el correo está configurado.
                </>,
                <>
                  <b>Enmienda:</b> si hay que corregir un informe ya autorizado o liberado, se crea la versión siguiente (v2, v3…) y la anterior queda como «sustituida», con su PDF marcado sin validez.
                </>,
              ]}
            />
          </Section>

          <Section anchor="inventario" title="Inventario y avisos" lead="Reactivos, consumibles y equipos con sus existencias, caducidades, calibraciones y mantenimientos. Los formatos descuentan solos lo que usan.">
            <ul className="flex flex-col gap-2">
              <li>
                <b>Existencias.</b> Cada reactivo y consumible muestra un medidor: cuánto queda frente a su capacidad y el mínimo. «Stock bajo» es por debajo del mínimo (o del 20 % si no hay mínimo); los consumibles se cuentan en unidades (no en cajas) y avisan con 5 unidades o menos si no tienen mínimo propio. <b>Registrar movimiento</b> anota entradas, salidas, consumos o ajustes por conteo.
              </li>
              <li>
                <b>Sin existencias negativas.</b> Una salida, un consumo o un formato que descuenta más de lo que hay se rechaza y no descuenta nada; registra primero la entrada que falta o un ajuste por conteo. Al dar de alta un reactivo o consumible, la existencia inicial es la capacidad por el número de piezas.
              </li>
              <li>
                <b>Equipos y mantenimiento.</b> Programar un mantenimiento pone el equipo <b>En mantenimiento</b>; al completarlo vuelve a <b>Operativo</b> y, si fue calibración, actualiza la próxima fecha. Una calibración vencida se marca en el equipo y en los avisos.
              </li>
              <li>
                <b>Reporte de servicio (PDF).</b> Abre el mantenimiento (Inventario › Mantenimiento) y usa <b>Adjuntar reporte PDF</b> para subir el reporte que entregó el proveedor o el técnico (solo PDF; se guarda con su huella SHA-256 y entra en los respaldos). Se abre en el visor. Si se adjuntó por error, <b>Reemplazar</b> o <b>Quitar</b> piden motivo y tu contraseña; el archivo anterior se conserva y todo queda en la bitácora. Quien solo consulta lo ve, pero no puede cambiarlo.
              </li>
              <li>
                <b>Movimientos.</b> Cada entrada y salida queda con motivo y referencia («Extracción E-A folio 1»). Los movimientos no se borran: al anular un registro, lo que descontó se repone con un movimiento de reversión y ambos quedan en la lista.
              </li>
              <li>
                <b>Avisos del Inicio.</b> Mantenimientos vencidos, equipos con alerta de calibración, stock bajo, análisis e informes esperando firma. Al abrirlos, la lista llega ya filtrada con la misma cuenta.
              </li>
            </ul>
          </Section>

          <Section anchor="calidad" title="Calidad y auditoría" lead="Incidencias, no conformidades y la bitácora: todo lo que se hace queda registrado (quién, qué, cuándo y por qué).">
            <ul className="flex flex-col gap-2">
              <li>
                <b>Reportar una incidencia:</b> «Reportar incidencia» en la barra lateral (o en el buscador): qué pasó, dónde y, si quieres, una foto. Calidad la evalúa y la cierra o la escala a <b>no conformidad</b>.
              </li>
              <li>
                <b>No conformidades:</b> análisis de causa, acciones correctivas con responsable y fecha, y verificación de eficacia; si no fue eficaz, se reabre. Al cerrarla se genera su PDF. Las tuyas aparecen en «Mis acciones correctivas».
              </li>
              <li>
                <b>Por autorizar:</b> las acciones delicadas (anular algo avanzado, asignar un rol, ampliar permisos, obsoletar un documento, restaurar un respaldo…) no se hacen solas: quedan como solicitud hasta que otra persona con permiso la aprueba en <b>Por autorizar</b>. Nadie aprueba lo suyo.
              </li>
            </ul>
            <p>
              Cada formato tiene al final un <b>Historial</b> con frases sencillas («Axel aprobó el análisis A 0000004»); al pulsar una actividad se abre una ventana con qué pasó, qué cambió y el motivo. En <b>Calidad › Auditoría</b> se ve lo mismo para toda la plataforma, con el buscador y el botón «Filtros» (periodo, personas, tipo de actividad y área). La bitácora no se exporta: se consulta solo aquí. Está sellada: si alguien la altera fuera de la plataforma, se detecta solo y aparece un aviso rojo.
            </p>
          </Section>

          <Section anchor="respaldos" title="Respaldos" lead="La plataforma guarda copias verificadas de la base y de los archivos. Se consultan en Calidad › Respaldos.">
            <ul className="flex flex-col gap-2">
              <li>
                <b>Crear y probar:</b> quien administra el sistema crea un respaldo con <b>Crear respaldo</b> y comprueba que se puede recuperar con <b>Probar restauración</b>: se restaura en una copia aparte, corre 8 verificaciones y deja un acta, sin tocar los datos en uso.
              </li>
              <li>
                <b>Restaurar un respaldo:</b> en el respaldo elegido, <b>Restaurar este respaldo</b> con el motivo. Queda en <b>Por autorizar</b> hasta que otra persona de Calidad lo apruebe. Al aprobarse, la plataforma muestra «Restaurando» unos momentos, guarda antes un respaldo del estado actual, reemplaza los datos y cierra todas las sesiones: hay que volver a entrar.
              </li>
              <li>
                <b>Avisos:</b> si pasa más de un día sin respaldo o mucho tiempo sin una prueba de restauración, el Inicio lo avisa.
              </li>
            </ul>
            <Tip tone="warn">Restaurar regresa la plataforma al momento del respaldo: lo capturado después se pierde (queda en el respaldo previo que se guarda antes).</Tip>
          </Section>

          <Section anchor="documentos" title="Documentos SGC" lead="Los documentos controlados del laboratorio, en seis carpetas por gestión (el color es de la gestión, nunca del estado).">
            <ul className="flex flex-col gap-2">
              <li>
                <b>Consultar:</b> en <b>Documentos SGC › Documentos</b> busca por clave FX, título o palabra clave, o entra a la carpeta de su gestión; la revisión vigente se lee en el visor. Descargada o impresa es una copia no controlada.
              </li>
              <li>
                <b>Indicadores del inicio:</b> arriba de las carpetas, <b>Vigentes</b>, <b>En revisión</b> (en elaboración, revisión o autorización), <b>Próximos a revisar</b> (vence en 30 días o ya pasó) y <b>Mis lecturas pendientes</b>. Solo cuentan lo que tú puedes ver; al pulsarlos llegas a la lista o a la Bandeja ya filtrada.
              </li>
              <li>
                <b>Proponer un cambio:</b> «Nueva solicitud» (o «Proponer cambio» en la ficha) con la justificación. Mejora Continua la acepta y asigna elaborador, revisor y autorizador: tres personas distintas.
              </li>
              <li>
                <b>Elaborar, revisar y autorizar:</b> lo que te toca aparece en la <b>Bandeja</b> y en la campana. El elaborador carga el PDF y lo envía (desde ahí el archivo ya no cambia); el revisor acepta o devuelve con comentarios; el autorizador autoriza con su contraseña y Mejora Continua publica: la anterior queda obsoleta.
              </li>
              <li>
                <b>Confirmar lectura:</b> en la Bandeja, «Lecturas pendientes», pulsa «Leer», revisa el PDF y confirma «Leí y comprendí»; queda ligado a ti y a esa revisión.
              </li>
              <li>
                <b>Lista Maestra y externos:</b> la Lista Maestra FX-GCL-MD se filtra y se abre en PDF en el visor; las normas externas avisan cuando se acerca su próxima revisión.
              </li>
            </ul>
            <Tip>Si un botón está deshabilitado, debajo dice por qué. Los documentos restringidos o confidenciales solo los ven las personas autorizadas.</Tip>
          </Section>

          <Section anchor="anular" title="Corregir un registro" lead="Los registros técnicos no se borran; se anulan con motivo y, si hace falta, se restauran.">
            <ul className="flex flex-col gap-2">
              <li>
                <b>Anular:</b> en el formato, «Más acciones › Anular» y escribe el motivo (mínimo 5 caracteres). El registro queda visible con «Mostrar anuladas» y el inventario que descontó se repone.
              </li>
              <li>
                <b>Restaurar:</b> desde el registro anulado, con motivo. Solo si la etapa anterior sigue vigente.
              </li>
              <li>
                <b>No se puede anular</b> una etapa que ya tiene etapas posteriores (una recepción con procesamiento): primero se anulan esas.
              </li>
              <li>
                <b>Análisis aprobado o informe autorizado:</b> se corrigen con una <b>enmienda</b> (nueva versión que sustituye a la anterior al aprobarse o autorizarse). Anularlos, como cualquier anulación fuera de borrador, queda en «Por autorizar» hasta que otra persona lo apruebe.
              </li>
            </ul>
            <Tip tone="warn">Un registro anulado, cerrado, aprobado o autorizado se abre en solo lectura. Si el botón de guardar no aparece, esa es la razón.</Tip>
          </Section>

          <Section anchor="atajos" title="Atajos de teclado">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
              <dt className="flex items-center gap-1">
                <Atajo atajo="Mod+K" />
              </dt>
              <dd>Abrir el buscador desde cualquier pantalla.</dd>
              <dt className="flex items-center gap-1">
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> <Kbd>↵</Kbd>
              </dt>
              <dd>Moverse por los resultados y abrir.</dd>
              <dt className="flex items-center gap-1">
                <Kbd>Esc</Kbd>
              </dt>
              <dd>Cerrar el buscador, un panel o un diálogo.</dd>
              <dt className="flex items-center gap-1">
                <Atajo atajo="Mod+F" />
              </dt>
              <dd>Buscar dentro del PDF abierto en el visor.</dd>
              <dt className="flex items-center gap-1">
                <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>F</Kbd>
              </dt>
              <dd>En el visor: página anterior o siguiente y pantalla completa.</dd>
            </dl>
            <p className="text-sm text-ink-3">Los atajos se muestran según tu sistema: con ⌘ (Cmd) en Mac y con Ctrl en Windows y Linux.</p>
            <p className="text-sm text-ink-3">
              Temas de esta guía en el buscador: {HELP_TOPICS.map((t) => t.label.toLowerCase()).slice(1, 5).join(", ")}…
            </p>
          </Section>
        </div>
      </div>
    </PageBody>
  );
}
