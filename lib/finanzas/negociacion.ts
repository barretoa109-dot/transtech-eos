import type { Deuda } from "./deudas.ts";

/**
 * El mensaje de negociación que EOS redacta solo.
 *
 * ============================================================
 * POR QUÉ ESTO ES UNA PLANTILLA Y NO UNA LLAMADA AL MODELO
 * ============================================================
 *
 * Este texto sale del sistema hacia un TERCERO —un banco, la SET, un
 * proveedor— con los números del usuario adentro y su nombre arriba. Un modelo
 * puede redactar mejor, pero también puede inventar una cifra, prometer una
 * fecha que el usuario no puede cumplir, o adornar con un motivo que no es
 * cierto. Cualquiera de las tres cosas la paga el usuario, no nosotros.
 *
 * Con una plantilla, cada número del mensaje viene de la base y cada promesa
 * está calculada sobre la capacidad real. Y se puede testear, que con un
 * modelo no.
 *
 * ============================================================
 * EOS NO MANDA ESTE MENSAJE
 * ============================================================
 *
 * Lo redacta y se lo da al usuario. Mandarlo sería hablar en su nombre con
 * alguien que le presta plata, comprometiéndolo a algo, sin que él lea lo que
 * se dijo. La regla no negociable de la hoja de ruta —ninguna acción que
 * comprometa al usuario sin un tap explícito— aplica de lleno acá.
 */

export type Estrategia = "prorroga" | "pago_parcial" | "refinanciacion";

export type Negociacion = {
  acreedor: string;
  estrategia: Estrategia;
  /** Por qué EOS eligió esta estrategia. Es para el usuario, no para el acreedor. */
  porque: string;
  asunto: string;
  mensaje: string;
};

/**
 * Si la plata entra dentro de esta ventana, el problema es de calendario y no
 * de capacidad: se pide una prórroga corta, que es lo más fácil de conceder.
 */
const DIAS_PARA_PRORROGA = 15;

/** Por debajo de esto, un pago parcial no compra buena voluntad. */
const PARCIAL_MINIMO = 0.4;

function plata(monto: number, moneda: string): string {
  const simbolo = moneda === "USD" ? "US$" : "Gs.";
  return `${simbolo} ${new Intl.NumberFormat("es-PY").format(Math.round(monto))}`;
}

function fechaLarga(iso: string): string {
  const meses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${Number(dia)} de ${meses[Number(mes) - 1]}`;
}

/**
 * Elige la estrategia con los datos, no preguntando.
 *
 * El usuario que llega acá ya está incómodo. Hacerle elegir entre tres formas
 * de negociar que no conoce es devolverle el problema con más pasos.
 */
export function elegirEstrategia(opciones: {
  cuota: number;
  disponible: number;
  proximoIngreso: { fecha: string; dias: number } | null;
  capacidadMensual: number;
}): Estrategia {
  const { cuota, disponible, proximoIngreso, capacidadMensual } = opciones;

  // Hay plata, llega tarde. Es un problema de calendario.
  if (proximoIngreso && proximoIngreso.dias <= DIAS_PARA_PRORROGA) return "prorroga";

  // La cuota no entra en lo que se puede pagar mes a mes: pedir prórroga sería
  // patear el mismo problema treinta días. Lo que hay que cambiar es la cuota.
  if (cuota > capacidadMensual) return "refinanciacion";

  if (disponible >= cuota * PARCIAL_MINIMO) return "pago_parcial";

  return "refinanciacion";
}

/**
 * El borrador.
 *
 * Reglas de redacción, deliberadas:
 *
 *   - **Propuesta concreta con fecha y monto.** Un acreedor responde a una
 *     propuesta, no a un pedido de comprensión.
 *   - **Sin explicar la vida privada.** Nada de "atravieso un momento difícil".
 *     El usuario no le debe a su acreedor una confesión, y dar motivos invita a
 *     que se los evalúe.
 *   - **Sin disculpas repetidas.** Una mención del atraso alcanza. Un mensaje
 *     que pide perdón tres veces negocia desde abajo.
 *   - **Reconocer la deuda.** No se discute el monto: se propone cómo pagarlo.
 */
export function redactarNegociacion(opciones: {
  deuda: Deuda;
  disponible: number;
  capacidadMensual: number;
  proximoIngreso: { fecha: string; dias: number } | null;
  nombreUsuario?: string | null;
}): Negociacion {
  const { deuda, disponible, capacidadMensual, proximoIngreso } = opciones;
  const cuota = deuda.cuota_monto ?? 0;
  const moneda = deuda.moneda;
  const firma = opciones.nombreUsuario?.trim() ? `\n\nSaludos cordiales,\n${opciones.nombreUsuario.trim()}` : "";

  const estrategia = elegirEstrategia({
    cuota,
    disponible,
    proximoIngreso,
    capacidadMensual,
  });

  const encabezado = `Estimados de ${deuda.acreedor}:`;

  if (estrategia === "prorroga" && proximoIngreso) {
    return {
      acreedor: deuda.acreedor,
      estrategia,
      porque: `Tenés un ingreso previsto el ${fechaLarga(proximoIngreso.fecha)}. No es un problema de capacidad, es de fecha: conviene pedir unos días y no tocar las condiciones del crédito.`,
      asunto: `Solicitud de prórroga de vencimiento — ${deuda.acreedor}`,
      mensaje:
        `${encabezado}\n\n` +
        `Me dirijo a ustedes en relación a mi cuota de ${plata(cuota, moneda)}.\n\n` +
        `Solicito una prórroga hasta el ${fechaLarga(proximoIngreso.fecha)}, fecha en la que ` +
        `podré abonarla en su totalidad. Me comprometo a realizar el pago completo ese día.\n\n` +
        `Quedo a disposición para confirmar la operación por este medio.${firma}`,
    };
  }

  if (estrategia === "pago_parcial") {
    const resto = Math.max(0, cuota - disponible);
    const cuando = proximoIngreso ? fechaLarga(proximoIngreso.fecha) : "el mes próximo";

    return {
      acreedor: deuda.acreedor,
      estrategia,
      porque: `Podés cubrir ${plata(disponible, moneda)} de los ${plata(cuota, moneda)} de la cuota. Un pago parcial en fecha sostiene la relación mucho mejor que un silencio.`,
      asunto: `Propuesta de pago parcial — ${deuda.acreedor}`,
      mensaje:
        `${encabezado}\n\n` +
        `Me dirijo a ustedes en relación a mi cuota de ${plata(cuota, moneda)}.\n\n` +
        `Propongo abonar ${plata(disponible, moneda)} en la fecha de vencimiento y el saldo ` +
        `restante de ${plata(resto, moneda)} el ${cuando}.\n\n` +
        `Quedo a disposición para confirmar la operación por este medio.${firma}`,
    };
  }

  // Refinanciación: la cuota no entra, y va a seguir sin entrar.
  const propuesta = Math.max(0, Math.floor(capacidadMensual));

  return {
    acreedor: deuda.acreedor,
    estrategia: "refinanciacion",
    porque:
      propuesta > 0
        ? `La cuota de ${plata(cuota, moneda)} no entra en lo que te queda por mes (${plata(capacidadMensual, moneda)}). Pedir prórroga patearía el mismo problema treinta días: lo que hay que cambiar es la cuota.`
        : `Hoy no te queda nada por mes para esta cuota. Lo honesto es decirlo y pedir una reestructuración, no prometer un pago que no vas a poder hacer.`,
    asunto: `Solicitud de refinanciación — ${deuda.acreedor}`,
    mensaje:
      `${encabezado}\n\n` +
      `Me dirijo a ustedes en relación a mi deuda, cuyo saldo asciende a ` +
      `${plata(deuda.saldo_declarado, moneda)} con una cuota mensual de ${plata(cuota, moneda)}.\n\n` +
      (propuesta > 0
        ? `Solicito refinanciar el saldo con una cuota mensual de hasta ` +
          `${plata(propuesta, moneda)}, extendiendo el plazo según corresponda. ` +
          `Es el monto que puedo sostener sin incurrir en nuevos atrasos.\n\n`
        : `Solicito una reunión para reestructurar el saldo. Prefiero plantearlo antes de ` +
          `incurrir en un atraso y no después.\n\n`) +
      `Quedo a disposición para acordar los detalles.${firma}`,
  };
}

/**
 * Lo que la interfaz tiene que decirle al usuario junto al borrador.
 *
 * Vive en el código y no en la pantalla para que sea imposible mostrar el
 * mensaje sin esta advertencia al lado.
 */
export const ADVERTENCIA = "Este mensaje no se envía solo. Revisalo y mandalo vos.";
