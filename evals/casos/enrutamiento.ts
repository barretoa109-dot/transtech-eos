/**
 * Corpus del enrutamiento de modelo (punto 10 del plan de fortalecimiento).
 *
 * `lib/eos/enrutamiento-modelo.ts` decide, en modo sombra, qué turnos PODRÍAN
 * ir a un modelo más barato. Equivocarse en un sentido cuesta plata (un saludo
 * atendido por el modelo caro); equivocarse en el otro cuesta la confianza del
 * usuario (una venta atendida por un modelo que no la entiende). Por eso:
 *
 *   - `critico`: todo mensaje que termina en una acción de negocio o en una
 *     cuenta de plata tiene que quedar en el modelo completo. Los mensajes son
 *     los del corpus de acciones, más las confirmaciones con pregunta pendiente.
 *   - `deseable`: que la cortesía pura se reconozca como simple. Fallar acá
 *     solo significa ahorrar menos.
 */

import { clasificarTurno, type ClaseTurno } from "../../lib/eos/enrutamiento-modelo.ts";
import type { Caso, Suite } from "../tipos.ts";

type Historial = { rol: "usuario" | "eos"; texto: string }[];

function caso(
  mensaje: string,
  esperado: ClaseTurno,
  severidad: Caso["severidad"],
  porque: string,
  historial: Historial = [],
): Caso {
  return {
    nombre: historial.length ? `${mensaje} (tras: ${historial.at(-1)?.texto})` : mensaje,
    severidad,
    porque,
    evaluar: () => {
      const r = clasificarTurno({ mensaje, adjuntos: 0, conCita: false, historial });
      return { ok: r.clase === esperado, esperado, obtenido: `${r.clase} (${r.motivo})` };
    },
  };
}

const ACCION = "termina en una acción que escribe en la base";
const PLATA = "pide razonar sobre la plata o el negocio de la persona";

const PROPUESTA: Historial = [
  { rol: "usuario", texto: "vendí 3 panes a Ana" },
  { rol: "eos", texto: "¿Registro la venta de 3 panes a Ana por Gs. 15.000?" },
];

export const enrutamiento: Suite = {
  nombre: "enrutamiento",
  descripcion: "qué turnos podrían ir a un modelo más barato sin arriesgar una acción",
  casos: [
    // Los mensajes del corpus de acciones: ninguno puede ser simple.
    caso("vendí 3 panes a Ana", "completo", "critico", ACCION),
    caso("Vendí un conjunto verde oliva talle S a 185.000gs", "completo", "critico", ACCION),
    caso("conté y hay 40 gaseosas", "completo", "critico", ACCION),
    caso("se me rompieron 3 botellas", "completo", "critico", ACCION),
    caso("agendá a Don Luis, RUC 800123", "completo", "critico", ACCION),
    caso("recordame llamar a Ana mañana", "completo", "critico", ACCION),
    caso("anotá: revisar la caja", "completo", "critico", ACCION),
    caso("urgentísimo: pagar el alquiler", "completo", "critico", ACCION),
    caso("acordate que el proveedor cierra los lunes", "completo", "critico", ACCION),
    caso("vendí 2 tortas y recordame reponer harina", "completo", "critico", ACCION),
    caso("mandale un mail a Ana", "completo", "critico", ACCION),
    caso("armame una planilla de ventas del mes", "completo", "critico", ACCION),
    caso("pasame un pdf con el resumen", "completo", "critico", ACCION),
    caso("mostrame el dashboard", "completo", "critico", ACCION),
    caso("¿cómo vengo este mes?", "completo", "critico", PLATA),
    caso("¿me conviene comprar más harina?", "completo", "critico", PLATA),
    caso("¿y el stock?", "completo", "critico", PLATA),
    caso("¿me alcanza?", "completo", "critico", PLATA),

    // Confirmaciones: con pregunta pendiente ejecutan la propuesta de EOS.
    caso("sí", "completo", "critico", "confirma la venta que EOS propuso", PROPUESTA),
    caso("dale", "completo", "critico", "confirma la venta que EOS propuso", PROPUESTA),
    caso("confirmo", "completo", "critico", "confirma la venta que EOS propuso", PROPUESTA),

    // Cortesía pura: lo único que la regla manda al modelo barato.
    caso("buenas", "simple", "deseable", "saludo sin pedido"),
    caso("hola", "simple", "deseable", "saludo sin pedido"),
    caso("muchas gracias!", "simple", "deseable", "agradecimiento sin pedido"),
    caso("chau", "simple", "deseable", "despedida"),
    caso("genial", "simple", "deseable", "acuse después de una respuesta cerrada", [
      { rol: "eos", texto: "Listo, quedó registrado." },
    ]),
  ],
};
