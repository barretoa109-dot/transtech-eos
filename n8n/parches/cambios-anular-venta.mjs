/**
 * ANULAR_VENTA: "esa venta estaba mal, anulala".
 *
 * ============================================================
 * EL HUECO QUE SE ABRIÓ ANOCHE
 * ============================================================
 *
 * El 9 de septiembre de 2026 a las 22:13, una usuaria registró por chat una
 * venta de DOS unidades del mismo talle cuando eran una S y una M. Para
 * arreglarlo tuvo que ir a la pantalla de Negocio, encontrar la fila y
 * anularla a mano.
 *
 * EOS le había cargado el error en un segundo y no sabía deshacerlo. Es el
 * hueco número 8 del mapa de `docs/autonomia/verbos.md`: `eos_erp_anular_venta`
 * está en la base desde el 27 de agosto, probada, y sin verbo que la alcance.
 *
 * ============================================================
 * LO QUE EL PROMPT TIENE QUE DECIR, Y POR QUÉ CADA COSA
 * ============================================================
 *
 *   · La referencia es OPCIONAL. "Anulá esa venta" dicho justo después de
 *     cargarla es el caso normal, y pedirle a la persona que identifique la
 *     venta que acaba de ver en pantalla es devolverle trabajo.
 *
 *   · El motivo es opcional para la persona pero la base lo exige, así que
 *     cuando no lo diga el sistema pone "Anulada desde el chat". No se lo
 *     pedimos: quien se equivocó cargando quiere deshacer, no justificarse.
 *
 *   · NO se usa para "devolvieron una prenda". Una devolución es un hecho
 *     nuevo —la mercadería vuelve y la plata sale— y anular la venta original
 *     borraría que esa venta existió. Es la confusión cara de este verbo y por
 *     eso está escrita.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones permitidas",
    viejo: "REGISTRAR_OPORTUNIDAD\n\nAcciones del negocio (ERP y CRM):",
    nuevo: "REGISTRAR_OPORTUNIDAD\nANULAR_VENTA\n\nAcciones del negocio (ERP y CRM):",
  },
  {
    donde: "la forma de datos de ANULAR_VENTA",
    viejo: ["GUARDAR_MEMORIA", "  datos: { titulo, categoria?, contenido, importancia? }"].join("\n"),
    nuevo: [
      "ANULAR_VENTA",
      "  datos: { referencia?, motivo? }",
      "  Deshacer una venta que se cargó mal. \"Anulá esa venta\", \"la última",
      "  estaba mal\", \"anulá la de 370.000\", \"borrá la venta de Rossana\".",
      "  Devuelve el stock al estante y saca el ingreso del panel.",
      "  referencia es cómo ENCONTRARLA y es opcional: un monto, el nombre del",
      "  producto o el del cliente. Sin referencia se anula la MÁS RECIENTE de",
      "  los últimos siete días, que es lo que significa \"esa venta\" dicho",
      "  después de cargarla. El sistema informa cuál anuló, con fecha, total y",
      "  productos.",
      "  El motivo es opcional: si no lo dicen, no lo preguntes.",
      "  NO ES UNA DEVOLUCIÓN. Si le devolvieron una prenda, la venta existió y",
      "  tiene que seguir existiendo: eso se anota aparte. Anular borraría del",
      "  historial una venta que sí pasó.",
      "  Sólo de los últimos siete días. Para algo más viejo, decile que lo haga",
      "  desde Negocio > Ventas.",
      "",
      "GUARDAR_MEMORIA",
      "  datos: { titulo, categoria?, contenido, importancia? }",
    ].join("\n"),
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
