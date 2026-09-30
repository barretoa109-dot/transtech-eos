/**
 * Cuando lo que pasó de verdad no coincide con lo que el modelo anunció, manda
 * lo que pasó.
 *
 * ============================================================
 * EL CASO (29/09/2026, 17:34)
 * ============================================================
 *
 * El modelo escribe su "respuesta" ANTES de que se ejecute nada. Escribió:
 *
 *     "Registro tres cosas en Personal: compra en Punto Farma por Gs. 46.000
 *      con la Green, pago mínimo de la Green por Gs. 188.000, e ingreso de
 *      Gs. 100.000."
 *
 * El pago falló (Green es una tarjeta, no una deuda). Abajo venían los
 * comprobantes, uno de ellos un error. La persona leyó primero "registro tres
 * cosas" —con un monto que ella no dijo— y le creyó a eso. El prompt ya tenía
 * la regla "NO ANUNCIES EL RESULTADO" y el modelo la rompió igual: una regla de
 * prompt no alcanza como única barrera.
 *
 * ============================================================
 * LA REGLA
 * ============================================================
 *
 * Si alguna acción FALLÓ, o llegó y ya estaba (`ya_estaba`, `repetidos`,
 * `sin_cambios`), las oraciones del modelo que anuncian un registro se sacan:
 * quedan los comprobantes, que salen de la base. El resto de lo que escribió
 * —una explicación, una pregunta, un consejo— se queda.
 *
 * Cuando todo salió bien no se toca nada: ahí el anuncio coincide con el
 * comprobante y además es lo que le deja ver a la persona qué entendió EOS
 * (producto, cliente, precio) antes de que alguien lo note tarde.
 *
 * ============================================================
 * UNA SOLA FUENTE PARA LOS DOS CAMINOS
 * ============================================================
 *
 * `resultados.ts` las usa, y el parche
 * `n8n/parches/2026-09-29-finanzas-confirma-lo-guardado.mjs` las copia tal
 * cual al nodo `08 GW Agregar Resultados Worker`. Por eso no dependen de nada
 * de afuera y los tipos son solo `any` en la firma.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** ¿Hay que sacar los anuncios del modelo? Solo si lo que pasó los contradice. */
export function anunciosContradichos(resultados: any): boolean {
  const lista = Array.isArray(resultados) ? resultados : [];
  return lista.some(function (r: any) {
    if (!r || typeof r !== "object") return false;
    if (r.ok === false || r.error) return true;
    const res = r.resultado && typeof r.resultado === "object" ? r.resultado : {};
    return (
      res.ya_estaba === true ||
      res.sin_cambios === true ||
      (Array.isArray(res.repetidos) && res.repetidos.length > 0)
    );
  });
}

/** ¿Esta oración anuncia que algo se registró, se cargó o se va a mandar? */
export function esAnuncio(oracion: any): boolean {
  let o = String(oracion || "").trim().toLowerCase();
  // Muletillas del principio: "Igual, la vuelvo a mandar", "Listo: anoté…".
  // Después del verbo no va \b: en JavaScript la "é" no cuenta como letra
  // para \b, y "anoté" no cortaría nunca.
  o = o.replace(/^(igual|entonces|ahora|listo|perfecto|bien|dale|ok|así que|y)[,:;]?\s+/, "");
  if (
    /^(ya\s+)?(te\s+)?(lo\s+|la\s+|los\s+|las\s+|le\s+)?(registro|registré|registramos|anoto|anoté|cargo|cargué|guardo|guardé|actualizo|actualicé|corrijo|corregí|agendo|agendé|sumo|sumé|vuelvo a|mando|mandé|envío|envié|dejo|dejé|voy a (registrar|anotar|cargar|guardar|actualizar|mandar|agendar|corregir|sumar|dejar))(?=[\s,.:;!?]|$)/.test(
      o,
    )
  ) {
    return true;
  }
  return /\b(qued(ó|a|aron|an) (anotad|registrad|cargad|guardad|agendad|actualizad)|la acción quedó completada)/.test(o);
}

/**
 * Saca del texto del modelo las oraciones que anuncian registros.
 *
 * Corta en oraciones solo donde después del punto viene una mayúscula: así
 * "Gs. 46.000" no se parte en dos.
 */
export function sinAnuncios(texto: any): string {
  const parrafos = String(texto || "").split(/\n+/);
  const quedan: string[] = [];

  for (const parrafo of parrafos) {
    const oraciones = parrafo.split(/(?<=[.!?:])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“])/);
    const buenas = oraciones.filter(function (o: string) {
      return o.trim() && !esAnuncio(o);
    });
    if (buenas.length > 0) quedan.push(buenas.join(" ").trim());
  }

  return quedan.join("\n\n").trim();
}

/** Lo que viaja a n8n, en orden. */
export const FUNCIONES_SIN_ANUNCIOS_PARA_N8N = [anunciosContradichos, esAnuncio, sinAnuncios];
