/**
 * El prompt aprende a crear objetivos con su monto y su fecha.
 *
 * ============================================================
 * NO ES UNA ACCIÓN NUEVA. ES UNA ACCIÓN CIEGA
 * ============================================================
 *
 * `CREAR_OBJETIVO` está en la lista de acciones permitidas desde el primer
 * día, en las cuatro listas blancas de n8n, en el `check` de la base y en la
 * tabla de riesgo del Worker Gate. El trigger `eos_process_goal_command()` la
 * ejecuta y escribe en `eos_goals`.
 *
 * Lo único que nunca tuvo es la forma de sus datos. El modelo veía el nombre
 * de la acción y nada más, así que mandaba `{ titulo }` a secas: un objetivo
 * sin monto, sin fecha y sin ámbito. Con eso la fila entra, pero no se puede
 * calcular nada — que es exactamente el estado en que estaban los objetivos
 * antes de la v144.
 *
 * Es la variante callada del hueco que este proyecto ya conocía: una acción
 * que existe en la lista, no falla nunca, y no sirve para nada.
 *
 * ============================================================
 * LO QUE HABILITA
 * ============================================================
 *
 * Desde la v144 el objetivo lleva `ambito`, `moneda` y `clase`, y desde P4
 * `lib/finanzas/objetivos.ts` convierte uno monetario con fecha en aporte por
 * mes, ritmo real y desvío. "Quiero juntar 30 millones para diciembre" ahora
 * puede terminar en "apartá 6.000.000 por mes durante cuatro meses" — pero
 * solo si el modelo manda el monto y la fecha.
 */

export const CAMBIOS = [
  {
    donde: "la forma de datos de CREAR_OBJETIVO",
    viejo: [
      "  Hace DOS cosas: baja el saldo de la deuda y registra el gasto del mes.",
      "  Por eso no mandes además REGISTRAR_MOVIMIENTO_PERSONAL por el mismo",
      "  pago: quedaría contado dos veces.",
      "",
      "NEGOCIO O PERSONAL: LA PREGUNTA QUE VA ANTES DE CADA ACCION DE PLATA",
    ].join("\n"),
    nuevo: [
      "  Hace DOS cosas: baja el saldo de la deuda y registra el gasto del mes.",
      "  Por eso no mandes además REGISTRAR_MOVIMIENTO_PERSONAL por el mismo",
      "  pago: quedaría contado dos veces.",
      "",
      "CREAR_OBJETIVO",
      "  datos: { titulo, tipo_medicion?, valor_objetivo?, valor_actual?,",
      "           fecha_limite?, moneda?, ambito?, prioridad? }",
      "  Algo que la persona quiere lograr. \"Quiero juntar 30 millones para",
      "  diciembre\", \"quiero facturar 300 millones este año\", \"terminar la",
      "  mudanza en octubre\".",
      "  Cuando es PLATA mandá tipo_medicion monetario, valor_objetivo con el",
      "  monto, y fecha_limite en formato AAAA-MM-DD si te la dicen. Con esas",
      "  dos cosas EOS calcula cuánto tiene que apartar por mes, si su ahorro",
      "  alcanza y cuándo llega al ritmo que lleva. Sin fecha lo guarda igual,",
      "  pero no puede decir nada de eso.",
      "  valor_actual es cuánto lleva juntado HOY, si lo menciona.",
      "  Lo que NO es plata —terminar una mudanza, cerrar tres clientes— va con",
      "  tipo_medicion numerico o porcentaje y sin valor_objetivo en guaraníes.",
      "  Lleva ambito: negocio o personal. Ver la sección de abajo. Juntar para",
      "  un terreno es personal; facturar tanto en el año es del negocio.",
      "  NO INVENTES EL MONTO NI LA FECHA. Si te dijeron \"quiero ahorrar más\",",
      "  preguntá cuánto y para cuándo antes de mandar la acción: un objetivo",
      "  con un monto inventado le hace creer a la persona que va bien o mal",
      "  contra una meta que nunca eligió.",
      "",
      "NEGOCIO O PERSONAL: LA PREGUNTA QUE VA ANTES DE CADA ACCION DE PLATA",
    ].join("\n"),
  },
  {
    donde: "qué acciones llevan ambito",
    viejo: "REGISTRAR_GASTO_FIJO es de los dos y por eso lleva ambito.",
    nuevo: "REGISTRAR_GASTO_FIJO y CREAR_OBJETIVO son de los dos y por eso\nllevan ambito.",
  },
  {
    /*
     * "Ocho" quedó viejo hace cuatro acciones.
     *
     * Un número equivocado en una regla que dice "no se negocia" le enseña al
     * modelo que el texto no es exacto, y a quien lo edite mañana que no hay
     * que mantenerlo. Sin número no puede volver a quedar viejo.
     */
    donde: "el conteo de las reglas",
    viejo: "Reglas de estas ocho, que no se negocian:",
    nuevo: "Reglas de estas acciones, que no se negocian:",
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en "${c.donde}"`);

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": aparece ${partes.length - 1} veces, no 1.`);
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}
