/*
 * Tamaños de etiqueta (todos en hoja carta, 215.9 × 279.4 mm) y acomodo en
 * hojas. Lo usan la página de impresión y las pruebas.
 */
export type TamanoEtiqueta = "pequena" | "mediana" | "grande" | "media_hoja";

/* Hoja carta: 215.9 × 279.4 mm. Márgenes y separaciones de las hojas de etiquetas comerciales. */
export const TAMANOS: Record<TamanoEtiqueta, { nombre: string; detalle: string; ancho: number; alto: number; columnas: number; filas: number; margenSup: number; margenIzq: number; separacionCol: number; separacionFila: number; completa: boolean; letra: { folio: number; id: number; dato: number }; padding: number }> = {
  pequena: { nombre: "Pequeña", detalle: "50 × 25 mm · 40 por hoja", ancho: 50, alto: 25, columnas: 4, filas: 10, margenSup: 14.7, margenIzq: 6, separacionCol: 1.3, separacionFila: 0, completa: false, letra: { folio: 7, id: 9, dato: 6.5 }, padding: 1.6 },
  mediana: { nombre: "Mediana", detalle: "66.7 × 25.4 mm · tipo Avery 5160, 30 por hoja", ancho: 66.7, alto: 25.4, columnas: 3, filas: 10, margenSup: 12.7, margenIzq: 4.8, separacionCol: 3.2, separacionFila: 0, completa: true, letra: { folio: 7, id: 8.5, dato: 5.6 }, padding: 1.5 },
  grande: { nombre: "Grande", detalle: "101.6 × 50.8 mm · tipo Avery 5163, 10 por hoja", ancho: 101.6, alto: 50.8, columnas: 2, filas: 5, margenSup: 12.7, margenIzq: 4, separacionCol: 4.8, separacionFila: 0, completa: true, letra: { folio: 11, id: 15, dato: 9 }, padding: 4 },
  media_hoja: { nombre: "Media hoja", detalle: "1 por media carta · contenedores grandes", ancho: 215.9, alto: 139.7, columnas: 1, filas: 2, margenSup: 0, margenIzq: 0, separacionCol: 0, separacionFila: 0, completa: true, letra: { folio: 20, id: 34, dato: 15 }, padding: 14 },
};
export const ORDEN: TamanoEtiqueta[] = ["pequena", "mediana", "grande", "media_hoja"];
export const porHoja = (t: TamanoEtiqueta) => TAMANOS[t].columnas * TAMANOS[t].filas;

/* Acomoda las etiquetas (copias incluidas) en hojas, dejando vacías las posiciones anteriores a `inicio`. */
export function acomodar<T>(items: T[], copias: number, inicio: number, tamano: TamanoEtiqueta): Array<Array<T | null>> {
  const lugares: Array<T | null> = [...Array(Math.max(0, inicio - 1)).fill(null), ...items.flatMap((item) => Array(copias).fill(item) as T[])];
  const n = porHoja(tamano);
  const hojas: Array<Array<T | null>> = [];
  for (let i = 0; i < lugares.length; i += n) hojas.push(lugares.slice(i, i + n));
  return hojas;
}

