/**
 * La cotización, leída de Google (v239).
 *
 * `monedas.ts` documenta por qué EOS nunca convierte entre monedas en NINGÚN
 * cálculo. Esto no cambia esa regla: es una vista aparte, que se suma, no que
 * reemplaza. El dueño declaró el 10/10/2026 que la cotización tiene que salir
 * de Google -- y como Google no tiene una API pública para esto, la única
 * forma real de leer "el número de Google" es un Google Sheet publicado con
 * la fórmula GOOGLEFINANCE, exportado como CSV.
 *
 * Apagado sin configuración, igual que FCM o APNs: sin `GOOGLE_SHEET_COTIZACION_URL`
 * no se consulta ni se guarda nada.
 */

export type Cotizacion = {
  moneda_desde: string;
  moneda_hasta: string;
  valor: number;
  origen: string;
  obtenida_en: string;
};

export function cotizacionConfigurada(): boolean {
  return Boolean(process.env.GOOGLE_SHEET_COTIZACION_URL);
}

/**
 * Lee el primer número del CSV que publica el Sheet.
 *
 * Una celda con `=GOOGLEFINANCE("CURRENCY:USDPYG")` publicada como CSV baja
 * como una sola línea, a veces con comillas alrededor: `"7350.5"` o
 * `7350.5`. No se asume la posición exacta de la celda -- se busca el
 * primer número de la respuesta entera, así que funciona tanto si el Sheet
 * tiene una sola celda como si tiene una fila con una etiqueta al lado.
 */
export function leerNumeroDeCsv(texto: string): number | null {
  const coincidencia = texto.match(/-?\d[\d.,]*\d|-?\d/);
  if (!coincidencia) return null;

  // Google separa miles con coma y decimales con punto en el CSV publicado
  // en inglés, que es el formato por defecto de un Sheet nuevo.
  const numero = Number(coincidencia[0].replace(/,/g, ""));
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

/** Trae el valor crudo del Sheet publicado. `null` si falla o no da un número válido. */
export async function obtenerDeGoogleSheet(url: string): Promise<number | null> {
  try {
    const respuesta = await fetch(url, { cache: "no-store" });
    if (!respuesta.ok) return null;
    return leerNumeroDeCsv(await respuesta.text());
  } catch (e) {
    console.error("Cotización: no se pudo leer el Google Sheet:", e);
    return null;
  }
}

/**
 * Lee el Sheet y guarda la cotización del día, desde el cron.
 *
 * Apagado sin configuración: sin la URL, no hace nada y no es un error --
 * es el mismo estado que FCM o APNs antes de cargar sus claves.
 */
export async function actualizarCotizacion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tipos generados no incluyen esta tabla
  admin: any,
  par: { desde: string; hasta: string },
): Promise<{ actualizado: boolean; valor?: number }> {
  const url = process.env.GOOGLE_SHEET_COTIZACION_URL;
  if (!url) return { actualizado: false };

  const valor = await obtenerDeGoogleSheet(url);
  if (valor === null) return { actualizado: false };

  const { error } = await admin.from("eos_cotizaciones").upsert(
    {
      moneda_desde: par.desde,
      moneda_hasta: par.hasta,
      valor,
      origen: "google",
      obtenida_en: new Date().toISOString(),
    },
    { onConflict: "moneda_desde,moneda_hasta" },
  );

  if (error) {
    console.error("Cotización: no se pudo guardar:", error);
    return { actualizado: false };
  }

  return { actualizado: true, valor };
}
