/**
 * El chat aprende a anotar cuánta plata hay en una cuenta.
 *
 * ============================================================
 * EL DATO MÁS FRECUENTE ERA EL ÚNICO QUE OBLIGABA A SALIR DEL CHAT
 * ============================================================
 *
 * El patrimonio, el disponible real y la cobertura del fondo de emergencia
 * arrancan todos del mismo número: cuánto hay hoy y desde qué fecha. Hasta
 * ahora ese número solo se cargaba por pantalla, y es el que más cambia —cada
 * vez que la persona mira su homebanking.
 *
 * ============================================================
 * LA CONFUSIÓN QUE HAY QUE EVITAR, Y ES LA MÁS FÁCIL DE COMETER
 * ============================================================
 *
 * "Tengo 3 millones en Ueno" NO es un ingreso. La persona no cobró tres
 * millones: está diciendo lo que ya tenía. Anotado como movimiento personal,
 * le infla lo que cobró en el mes y con eso su tasa de ahorro, su presupuesto
 * y su capacidad de ahorro proyectada.
 *
 * Es el mismo error que ya se corrigió una vez con las transferencias, y por
 * el mismo motivo aparece explícito en el prompt.
 *
 * Ver la migración v149 para por qué no adivina el tipo de institución y por
 * qué, con dos cuentas parecidas, se niega a elegir.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones permitidas",
    viejo: "REGISTRAR_PAGO_DEUDA\nCORREGIR_MOVIMIENTO\n\nAcciones del negocio (ERP y CRM):",
    nuevo:
      "REGISTRAR_PAGO_DEUDA\nCORREGIR_MOVIMIENTO\nDECLARAR_SALDO\n\nAcciones del negocio (ERP y CRM):",
  },
  {
    donde: "la forma de datos de DECLARAR_SALDO",
    viejo: [
      "CREAR_OBJETIVO",
      "  datos: { titulo, tipo_medicion?, valor_objetivo?, valor_actual?,",
    ].join("\n"),
    nuevo: [
      "DECLARAR_SALDO",
      "  datos: { cuenta, saldo, moneda?, tipo?, fecha? }",
      "  Cuánta plata tiene la persona en una cuenta suya. \"Tengo 3 millones",
      "  en Ueno\", \"en efectivo me quedan 500 mil\", \"el saldo de la caja de",
      "  ahorro es 12.400.000\", \"no me queda nada en el banco\".",
      "  Es el número del que dependen su patrimonio, su disponible real y su",
      "  fondo de emergencia: sin él EOS proyecta sobre nada.",
      "  NO ES UN INGRESO. La persona no cobró 3 millones: te está diciendo lo",
      "  que YA tenía. Mandarlo como movimiento personal le infla lo que cobró",
      "  en el mes y con eso su tasa de ahorro y su presupuesto.",
      "  cuenta es el nombre tal como lo dice. Si no la tiene cargada el",
      "  sistema la crea; si tiene dos parecidas te va a pedir cuál es.",
      "  tipo SOLO si lo dice: banco, cooperativa, financiera, billetera o",
      "  efectivo. No lo adivines por el nombre del lugar — el sistema deja la",
      "  cuenta sin clasificar y la persona la clasifica en un clic, que es",
      "  mejor que quedarse con una suposición que parece un dato.",
      "  moneda SOLO si lo dice. Si no, se usa la de esa cuenta.",
      "  Es SIEMPRE de la persona. La caja y las cuentas del negocio se cargan",
      "  desde Negocios.",
      "",
      "CREAR_OBJETIVO",
      "  datos: { titulo, tipo_medicion?, valor_objetivo?, valor_actual?,",
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
