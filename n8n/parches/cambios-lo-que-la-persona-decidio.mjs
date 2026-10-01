/**
 * El prompt después del feedback beta del 01/10/2026 (INC-19, cliente
 * anonimizado): EOS asesora respetando lo que la persona ya decidió.
 *
 * Lo que reportó, en limpio:
 * - dijo que sus dos préstamos van primero porque se descuentan cada mes, y
 *   EOS igual armó el plan poniendo primero el arreglo de la moto;
 * - su ingreso es base más comisiones y horas extra, y varía;
 * - a veces tiene que repetir datos que ya dio, y EOS mezcla detalles.
 *
 * No hay acción ni dato de la base en juego: es conducta del asesor, y el
 * lugar es el prompt más la memoria. Cambia:
 * - lo que la persona decidió manda; el riesgo se dice, no se impone;
 * - ingreso variable: el plan se arma con la parte segura;
 * - una prioridad o la forma del ingreso se guardan (GUARDAR_MEMORIA ya es
 *   para "qué prefiere"), aunque el resto del mensaje sea una consulta;
 * - un plan son pasos con cuándo; las tareas se ofrecen, no se crean solas;
 * - lo que no se entiende se pregunta, no se adivina.
 *
 * Sin comillas invertidas: en n8n el prompt vive dentro de un literal de
 * plantilla. `aplicar` lo verifica.
 */

const ANCLA =
  "- Breve no es seco ni incompleto. Si hace falta una advertencia, va; si\n" +
  "  el número necesita una aclaración para no leerse mal, va. Lo que se\n" +
  "  saca es el relleno, no el contenido.\n";

export const CAMBIOS = [
  {
    donde: "asesoramiento: lo que la persona decidió manda (INC-19)",
    viejo: ANCLA,
    nuevo:
      ANCLA +
      [
        "- CUANDO ASESORÁS (deudas, gastos, un plan), LO QUE LA PERSONA YA",
        "  DECIDIÓ MANDA. Si dijo qué va primero (\"los préstamos son mi",
        "  prioridad porque se descuentan cada mes\"), armá el plan en ese orden.",
        "  Si ves un riesgo, decilo en una línea con su consecuencia y ofrecé la",
        "  alternativa, pero no cambies el orden por tu cuenta ni lo tapes con",
        "  una recomendación general.",
        "- INGRESO QUE VARÍA. Si el ingreso tiene una parte fija y otra que",
        "  cambia (sueldo base más comisiones u horas extra), separalas: el plan",
        "  se arma con la parte segura y lo variable va como extra. Si no sabés",
        "  la parte fija, preguntá solo eso; nunca supongas un sueldo fijo.",
        "- Una prioridad que la persona declara o cómo se compone su ingreso son",
        "  datos de cómo trabaja: mandá GUARDAR_MEMORIA con eso aunque el resto",
        "  del mensaje sea una consulta, para no volver a preguntarlo. Si ya",
        "  está en el contexto, usalo y no lo pidas de nuevo.",
        "- UN PLAN SON PASOS CON CUÁNDO. Si pide ordenar algo, dale pasos",
        "  concretos con su fecha o su orden, y ofrecé cargarlos como tareas: no",
        "  mandes CREAR_TAREA por un plan que nadie te pidió cargar. No prometas",
        "  \"lo analizo y te aviso\".",
        "- No mezcles personas, productos, cantidades ni compromisos de cosas",
        "  distintas. Si un nombre, una marca o una cantidad no se entiende,",
        "  preguntá solo eso en vez de adivinarlo.",
        "",
      ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) {
      throw new Error(
        `[${etiqueta}] "${c.donde}" trae una comilla invertida, y en n8n eso corta el prompt.`,
      );
    }

    // Ya aplicado: no se aplica dos veces.
    if (salida.includes(c.nuevo)) continue;

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(
        `[${etiqueta}] "${c.donde}": el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`,
      );
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}

/** Gateway, nodo `HTTP Request`: el prompt. Pura, sin red. */
export function transformarGateway(flujo) {
  const http = flujo.nodes.find((n) => n.name === "HTTP Request");
  if (!http) throw new Error('No existe el nodo "HTTP Request".');
  http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");
  return flujo;
}
