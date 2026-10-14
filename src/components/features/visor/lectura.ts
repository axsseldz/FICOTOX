/* Tipografia de lectura para docx y Markdown (tokens de la app; sin colores sueltos). */
export const ESTILOS_LECTURA = `
.visor-lectura { max-width: 760px; margin: 0 auto; padding: 40px 48px; background: var(--color-surface); color: var(--color-ink); font-size: 16px; line-height: 1.7;
  border-radius: 14px; box-shadow: var(--shadow-card); overflow-wrap: anywhere; }
@media (max-width: 640px) { .visor-lectura { padding: 22px 18px; font-size: 15px; border-radius: 0; } }
.visor-lectura h1 { font-size: 1.75em; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 0.7em; }
.visor-lectura h2 { font-size: 1.35em; line-height: 1.25; font-weight: 650; margin: 1.6em 0 0.6em; }
.visor-lectura h3 { font-size: 1.12em; font-weight: 650; margin: 1.4em 0 0.5em; }
.visor-lectura h4, .visor-lectura h5, .visor-lectura h6 { font-weight: 650; margin: 1.2em 0 0.4em; }
.visor-lectura p { margin: 0 0 0.9em; }
.visor-lectura ul, .visor-lectura ol { margin: 0 0 1em; padding-left: 1.5em; }
.visor-lectura ul { list-style: disc; } .visor-lectura ol { list-style: decimal; }
.visor-lectura li { margin: 0.2em 0; }
.visor-lectura a { color: var(--color-brand-strong); text-decoration: underline; text-underline-offset: 2px; }
.visor-lectura strong { font-weight: 650; }
.visor-lectura blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 3px solid var(--color-line-strong); color: var(--color-ink-2); }
.visor-lectura code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.9em; background: var(--color-surface-2); border-radius: 4px; padding: 0.1em 0.35em; }
.visor-lectura pre { background: var(--color-surface-2); border-radius: 10px; padding: 12px 14px; overflow-x: auto; margin: 0 0 1em; }
.visor-lectura pre code { background: none; padding: 0; }
.visor-lectura table { border-collapse: collapse; margin: 0 0 1.2em; font-size: 0.92em; display: block; overflow-x: auto; }
.visor-lectura th, .visor-lectura td { border: 1px solid var(--color-line); padding: 6px 10px; text-align: left; vertical-align: top; }
.visor-lectura th { background: var(--color-surface-2); font-weight: 600; }
.visor-lectura img { max-width: 100%; height: auto; }
.visor-lectura hr { border: 0; border-top: 1px solid var(--color-line); margin: 1.6em 0; }
`;
