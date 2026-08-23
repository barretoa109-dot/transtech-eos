/**
 * Corpus de lectura de fechas.
 *
 * Una fecha corrida un día cambia "tu sueldo entra mañana" por "tu sueldo entró
 * ayer". Es el tipo de error que el usuario SÍ nota, y que le hace dejar de
 * creer en todo lo demás.
 */

import { parsearFecha } from "../../lib/finanzas/extraerMovimientos.ts";
import type { Caso, Suite } from "../tipos.ts";

function caso(
  texto: string,
  esperado: string | null,
  severidad: Caso["severidad"],
  porque: string,
): Caso {
  return {
    nombre: texto,
    severidad,
    porque,
    evaluar: () => {
      const obtenido = parsearFecha(texto);
      return {
        ok: obtenido === esperado,
        esperado: esperado ?? "no es una fecha",
        obtenido: obtenido ?? "no es una fecha",
      };
    },
  };
}

export const fechas: Suite = {
  nombre: "fechas",
  descripcion: "Lectura de fechas en convención paraguaya (día primero).",
  casos: [
    caso(
      "20/08/2026",
      "2026-08-20",
      "critico",
      "Formato del cuerpo del aviso del Banco GNB.",
    ),
    caso(
      "05/12/2026",
      "2026-12-05",
      "critico",
      "Ambiguo con la convención de EE.UU. En PY el día va primero: 5 de diciembre, no 12 de mayo.",
    ),
    caso("15 de agosto de 2026", "2026-08-15", "critico", "Fecha escrita en palabras, común en contratos."),
    caso(
      "15 de setiembre de 2026",
      "2026-09-15",
      "critico",
      "'Setiembre' sin p es la grafía habitual en Paraguay; olvidarla pierde un mes entero del año.",
    ),
    caso("15-8-26", "2026-08-15", "deseable", "Año de dos dígitos y sin ceros a la izquierda."),
    caso("1.8.2026", "2026-08-01", "deseable", "Separador punto, usado en algunos extractos."),

    // --- Rechazos: mejor ninguna fecha que una inventada ---
    caso(
      "31/02/2026",
      null,
      "critico",
      "Fecha imposible. Si se acepta, JavaScript la corre sola al 3 de marzo sin avisar.",
    ),
    caso(
      "08/15/2026",
      null,
      "critico",
      "Formato de EE.UU. No se puede adivinar: rechazarlo es la respuesta correcta.",
    ),
    caso("pagadero a 30 días", null, "critico", "Plazo relativo, no fecha."),
  ],
};
