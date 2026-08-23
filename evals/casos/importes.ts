/**
 * Corpus de lectura de importes.
 *
 * El guaraní se escribe con punto de miles y sin centavos; el dólar, al revés.
 * Confundirlos no produce un error chico: produce un error de mil veces. Por eso
 * casi todo este corpus es crítico.
 */

import { parsearImporte } from "../../lib/finanzas/extraerMovimientos.ts";
import type { Caso, Suite } from "../tipos.ts";

type Esperado = { monto: number; moneda: "PYG" | "USD" } | null;

function describir(v: Esperado): string {
  return v ? `${v.moneda} ${v.monto}` : "no es un importe";
}

function caso(
  texto: string,
  esperado: Esperado,
  severidad: Caso["severidad"],
  porque: string,
): Caso {
  return {
    nombre: texto,
    severidad,
    porque,
    evaluar: () => {
      const obtenido = parsearImporte(texto);
      const ok =
        esperado === null
          ? obtenido === null
          : obtenido !== null &&
            obtenido.monto === esperado.monto &&
            obtenido.moneda === esperado.moneda;

      return { ok, esperado: describir(esperado), obtenido: describir(obtenido) };
    },
  };
}

export const importes: Suite = {
  nombre: "importes",
  descripcion: "Lectura de montos en formato paraguayo, donde el punto es miles.",
  casos: [
    // --- Guaraníes, todas las formas en que se escriben en la práctica ---
    caso("Gs. 1.500.000", { monto: 1_500_000, moneda: "PYG" }, "critico", "Forma más común en facturas."),
    caso("₲184.000", { monto: 184_000, moneda: "PYG" }, "critico", "Símbolo pegado al número, sin espacio."),
    caso(
      "PYG 50.000",
      { monto: 50_000, moneda: "PYG" },
      "critico",
      "Formato literal del aviso del Banco GNB que ya ingresó a producción.",
    ),
    caso(
      "2.300.000 guaraníes",
      { monto: 2_300_000, moneda: "PYG" },
      "critico",
      "Moneda escrita en palabras y después del número.",
    ),
    caso(
      "1.234.567",
      { monto: 1_234_567, moneda: "PYG" },
      "critico",
      "Sin moneda: en un documento paraguayo el default es guaraní.",
    ),
    caso("Gs 1.500", { monto: 1_500, moneda: "PYG" }, "critico", "Importe chico: el punto sigue siendo miles."),

    // --- Dólares: acá el punto sí puede ser decimal ---
    caso(
      "USD 1,500.50",
      { monto: 1_500.5, moneda: "USD" },
      "critico",
      "Formato anglosajón: coma de miles, punto decimal. Leerlo al revés da 1,5 en vez de 1500.",
    ),
    caso(
      "USD 1.50",
      { monto: 1.5, moneda: "USD" },
      "critico",
      "Dos decimales en dólares: el punto NO es de miles.",
    ),
    caso(
      "$1.500",
      { monto: 1_500, moneda: "USD" },
      "critico",
      "Tres cifras después del punto: es de miles aunque sea dólar.",
    ),
    caso(
      "US$ 250",
      { monto: 250, moneda: "USD" },
      "critico",
      "Notación US$ usada en carteles y contratos en PY.",
    ),

    // --- Lo que NO es un importe. Guardrail 3: decir "no sé" antes que inventar ---
    caso("Gs. 0", null, "critico", "Cero no es un movimiento; guardarlo ensucia el historial."),
    caso("saldo no disponible", null, "critico", "Texto sin números."),
    caso(
      "5,5%",
      null,
      "deseable",
      "Un porcentaje leído como importe mete ₲5,5 en el disponible real. Ruido, no mentira grande.",
    ),
    caso(
      "50%",
      null,
      "critico",
      "Porcentaje redondo: sin decimales que lo delaten, ₲50 entra como movimiento real. El chequeo por mutación mostró que sin este caso el filtro de '%' era código muerto.",
    ),
    caso(
      "Comprobante Nro 000123456",
      null,
      "deseable",
      "Números de comprobante y de cuenta son la fuente de falsos importes más común en un extracto.",
    ),
    caso(
      "Gs. 1,5",
      null,
      "deseable",
      "El guaraní no tiene centavos: un decimal en PYG significa que la lectura salió mal.",
    ),
  ],
};
