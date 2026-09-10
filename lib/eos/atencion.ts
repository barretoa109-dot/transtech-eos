/**
 * Qué necesita EOS de vos. Y casi siempre, nada.
 *
 * ============================================================
 * LA REGLA QUE HACE QUE ESTO SIRVA
 * ============================================================
 *
 * Solo entra acá lo que **bloquea algo que EOS podría hacer**. No lo que
 * estaría bueno tener, no lo que un formulario dejó vacío, no lo que un
 * checklist de onboarding querría completo.
 *
 * La diferencia no es de grado. Una lista de cosas que "convendría cargar" se
 * lee dos veces y después se ignora para siempre, y arrastra consigo la
 * credibilidad de todo lo demás que EOS diga. Una lista donde cada renglón
 * dice QUÉ SE DESTRABA se lee siempre, porque cada vez que se resuelve uno
 * pasa algo.
 *
 * Por eso cada pendiente lleva `porque`: no "falta el costo de 3 productos"
 * sino "sin el costo no puedo calcularte el margen de esos 3". Si un pendiente
 * no puede completar esa frase, no va.
 *
 * ============================================================
 * Y CASI SIEMPRE TIENE QUE DECIR "NADA"
 * ============================================================
 *
 * El titular es lo que la persona lee de reojo. Si dice "nada" cuando no hay
 * nada, entonces el día que diga "2 decisiones" se le va a creer.
 *
 * Un centro de atención que siempre tiene algo es un adorno.
 */

/** Qué clase de atención pide. El orden importa: es el orden en que se muestran. */
export type Clase =
  /** Algo espera un sí o un no de la persona. Nadie más lo puede resolver. */
  | "decision"
  /** EOS necesita un dato que no puede deducir sin inventarlo. */
  | "dato"
  /** Algo que se declaró hace tiempo y ya no se puede afirmar como cierto. */
  | "envejecido";

export type Pendiente = {
  /**
   * Estable entre corridas. Es lo que permite no volver a mostrar algo que la
   * persona ya vio y decidió ignorar, y lo que evita que el mismo pendiente
   * aparezca dos veces con distinto texto.
   */
  clave: string;
  clase: Clase;
  titulo: string;
  /** Qué se destraba al resolverlo. Sin esto, el pendiente no entra. */
  porque: string;
  /** Dónde se resuelve, escrito como se llama la pantalla. */
  donde: string;
  cuantos?: number;
};

export type Entradas = {
  hoy: string;

  /** Acciones del chat esperando que alguien las apruebe. */
  aprobacionesPendientes?: number;

  /** Comandos que fallaron y nadie miró. */
  accionesFallidas?: Array<{ accion: string; motivo?: string | null }>;

  /** Productos vendibles sin costo cargado. */
  productosSinCosto?: number;
  productosTotales?: number;

  /** Cuentas personales: cuántas hay y cuál es el saldo declarado más viejo. */
  cuentas?: Array<{ nombre: string; saldo: number | null; al: string | null }>;

  /** Tarjetas sin ciclo, y resúmenes viejos. */
  tarjetas?: Array<{
    nombre: string;
    cierra: number | null;
    vence: number | null;
    resumenAl: string | null;
  }>;

  /** Deudas sin cuota declarada: sin ella no se puede ordenar ningún pago. */
  deudasSinCuota?: Array<{ acreedor: string }>;

  /** Oportunidades abiertas sin monto: el embudo no puede prever nada. */
  oportunidadesSinMonto?: number;

  /** Ventas a crédito vencidas hace rato, si el negocio lleva cartera. */
  porCobrarViejo?: { cuantas: number; masViejaEnDias: number } | null;
};

/**
 * Cuándo un saldo declarado deja de poder afirmarse.
 *
 * Treinta días es un ciclo completo de sueldo, alquiler y tarjeta: pasado eso,
 * el número que la persona dijo ya pasó por todo lo que le podía pasar.
 *
 * No es un plazo técnico y no pretende serlo. Es el punto donde EOS deja de
 * decir "tenés X" y pasa a decir "decías tener X".
 */
export const DIAS_PARA_REFRESCAR_SALDO = 30;

/**
 * El resumen de una tarjeta envejece más rápido que un saldo.
 *
 * Cuarenta y cinco días son un ciclo y medio: a esa altura ya cerró otro
 * resumen y el que EOS tiene guardado corresponde a un período que la persona
 * ya pagó (o no).
 */
export const DIAS_PARA_REFRESCAR_RESUMEN = 45;

/** Cuántos días de atraso hacen que una venta a crédito valga la pena mencionarla. */
export const DIAS_DE_CARTERA_VIEJA = 30;

function diasEntre(desde: string, hasta: string): number {
  const a = enUTC(desde);
  const b = enUTC(hasta);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / 86_400_000);
}

function enUTC(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || iso.length < 10) return null;
  const [anio, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia) return null;
  return Date.UTC(anio, mes - 1, dia);
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}

/**
 * Todo lo que EOS necesita de la persona, ordenado por lo que destraba.
 *
 * Las decisiones primero porque nadie más las puede tomar; después los datos,
 * que son trabajo de un minuto; y último lo envejecido, que no impide nada
 * pero vuelve dudosa cualquier respuesta que se apoye en ello.
 */
export function armarAtencion(e: Entradas): Pendiente[] {
  const pendientes: Pendiente[] = [];

  // ---------------------------------------------------------------- decisiones
  const aprobaciones = e.aprobacionesPendientes ?? 0;
  if (aprobaciones > 0) {
    pendientes.push({
      clave: "aprobaciones",
      clase: "decision",
      titulo: `${aprobaciones} ${plural(aprobaciones, "acción esperando", "acciones esperando")} tu visto bueno`,
      porque: "Hasta que las apruebes no se ejecutan, y lo que pediste no queda hecho.",
      donde: "Autonomía",
      cuantos: aprobaciones,
    });
  }

  const fallidas = e.accionesFallidas ?? [];
  if (fallidas.length > 0) {
    /*
     * Se nombran las acciones, no la cantidad.
     *
     * "3 acciones fallaron" no le dice a nadie si perdió una venta o un
     * recordatorio. Los nombres sí, y son lo que decide si esto se mira ahora
     * o el lunes.
     */
    const nombres = [...new Set(fallidas.map((f) => f.accion))].slice(0, 3).join(", ");

    pendientes.push({
      clave: "acciones-fallidas",
      clase: "decision",
      titulo: `${fallidas.length} ${plural(fallidas.length, "orden que no pudo", "órdenes que no pudieron")} completarse`,
      porque: `Quedaron sin hacer: ${nombres}. Si todavía hacen falta, pedímelas de nuevo.`,
      donde: "el chat",
      cuantos: fallidas.length,
    });
  }

  // --------------------------------------------------------------------- datos
  const sinCosto = e.productosSinCosto ?? 0;
  if (sinCosto > 0) {
    pendientes.push({
      clave: "productos-sin-costo",
      clase: "dato",
      titulo: `${sinCosto} ${plural(sinCosto, "producto sin costo", "productos sin costo")}`,
      porque: `Sin el costo no puedo calcularte el margen de ${plural(sinCosto, "ese producto", "esos productos")}, ni decirte si conviene venderlo.`,
      donde: "Negocio > Productos",
      cuantos: sinCosto,
    });
  }

  const cuentas = e.cuentas ?? [];
  const sinSaldo = cuentas.filter((c) => c.saldo === null || c.saldo === undefined);
  if (cuentas.length === 0) {
    pendientes.push({
      clave: "sin-cuentas",
      clase: "dato",
      titulo: "No me contaste dónde tenés tu plata",
      porque:
        "Sin al menos una cuenta con su saldo no puedo decirte cuánto tenés, ni tu patrimonio, ni si llegás a fin de mes.",
      donde: "Personal > Lo que tengo",
    });
  } else if (sinSaldo.length > 0) {
    pendientes.push({
      clave: "cuentas-sin-saldo",
      clase: "dato",
      titulo: `${sinSaldo.length} ${plural(sinSaldo.length, "cuenta sin saldo", "cuentas sin saldo")}`,
      porque: `${sinSaldo.map((c) => c.nombre).slice(0, 3).join(", ")} ${plural(sinSaldo.length, "queda", "quedan")} afuera de tu total mientras no me digas cuánto ${plural(sinSaldo.length, "tiene", "tienen")}.`,
      donde: "Personal > Lo que tengo",
      cuantos: sinSaldo.length,
    });
  }

  const tarjetas = e.tarjetas ?? [];
  const sinCiclo = tarjetas.filter((t) => !t.cierra || !t.vence);
  if (sinCiclo.length > 0) {
    pendientes.push({
      clave: "tarjetas-sin-ciclo",
      clase: "dato",
      titulo: `${sinCiclo.length} ${plural(sinCiclo.length, "tarjeta sin", "tarjetas sin")} día de cierre o de vencimiento`,
      porque: `De ${sinCiclo.map((t) => t.nombre).slice(0, 3).join(", ")} no puedo calcular cuándo cae la cuota ni si entra en el mes.`,
      donde: "Personal > Lo que debo",
      cuantos: sinCiclo.length,
    });
  }

  const sinCuota = e.deudasSinCuota ?? [];
  if (sinCuota.length > 0) {
    pendientes.push({
      clave: "deudas-sin-cuota",
      clase: "dato",
      titulo: `${sinCuota.length} ${plural(sinCuota.length, "deuda sin cuota", "deudas sin cuota")}`,
      porque: `Sin saber cuánto y qué día le pagás a ${sinCuota.map((d) => d.acreedor).slice(0, 3).join(", ")}, no puedo ordenarte los pagos ni avisarte antes de que venzan.`,
      donde: "Personal > Lo que debo",
      cuantos: sinCuota.length,
    });
  }

  const sinMonto = e.oportunidadesSinMonto ?? 0;
  if (sinMonto > 0) {
    pendientes.push({
      clave: "oportunidades-sin-monto",
      clase: "dato",
      titulo: `${sinMonto} ${plural(sinMonto, "oportunidad sin monto", "oportunidades sin monto")}`,
      porque: "El embudo no puede prever cuánto podrías facturar con lo que tenés abierto.",
      donde: "Negocio > Oportunidades",
      cuantos: sinMonto,
    });
  }

  // ---------------------------------------------------------------- envejecido
  const conSaldo = cuentas.filter(
    (c): c is { nombre: string; saldo: number; al: string } =>
      typeof c.saldo === "number" && typeof c.al === "string",
  );

  const viejas = conSaldo.filter((c) => diasEntre(c.al, e.hoy) > DIAS_PARA_REFRESCAR_SALDO);

  if (viejas.length > 0) {
    const masVieja = viejas.reduce((peor, c) =>
      diasEntre(c.al, e.hoy) > diasEntre(peor.al, e.hoy) ? c : peor,
    );

    pendientes.push({
      clave: "saldos-viejos",
      clase: "envejecido",
      titulo: `${viejas.length} ${plural(viejas.length, "saldo declarado", "saldos declarados")} hace más de un mes`,
      porque: `El de ${masVieja.nombre} es del ${masVieja.al}. Mientras tanto no puedo decir "tenés", solo "decías tener".`,
      donde: "el chat: decime cuánto tenés hoy",
      cuantos: viejas.length,
    });
  }

  const resumenViejo = tarjetas.filter(
    (t) => t.resumenAl && diasEntre(t.resumenAl, e.hoy) > DIAS_PARA_REFRESCAR_RESUMEN,
  );

  if (resumenViejo.length > 0) {
    pendientes.push({
      clave: "resumenes-viejos",
      clase: "envejecido",
      titulo: `${resumenViejo.length} ${plural(resumenViejo.length, "resumen de tarjeta viejo", "resúmenes de tarjeta viejos")}`,
      porque: `Ya cerró otro ciclo desde entonces, así que el que tengo de ${resumenViejo.map((t) => t.nombre).slice(0, 2).join(", ")} corresponde a un período que ya pasó.`,
      donde: "el chat: pasame el resumen de este mes",
      cuantos: resumenViejo.length,
    });
  }

  const cartera = e.porCobrarViejo;
  if (cartera && cartera.cuantas > 0 && cartera.masViejaEnDias > DIAS_DE_CARTERA_VIEJA) {
    pendientes.push({
      clave: "cartera-vieja",
      clase: "envejecido",
      titulo: `${cartera.cuantas} ${plural(cartera.cuantas, "venta a crédito sin cobrar", "ventas a crédito sin cobrar")}`,
      porque: `La más vieja tiene ${cartera.masViejaEnDias} días. Si ya te pagaron, decímelo y la saco de lo que te deben.`,
      donde: "el chat: “me pagó fulano”",
      cuantos: cartera.cuantas,
    });
  }

  return pendientes;
}

/**
 * El titular. Es lo que se lee de reojo, y por eso es una sola línea.
 *
 * Cuenta decisiones y datos por separado porque son trabajos distintos: una
 * decisión es pensar, un dato es escribir un número. Lo envejecido no entra en
 * el titular — no bloquea nada, y meterlo haría que casi nunca diga "nada".
 */
export function titularDeAtencion(pendientes: Pendiente[]): string {
  const decisiones = pendientes.filter((p) => p.clase === "decision").length;
  const datos = pendientes.filter((p) => p.clase === "dato").length;

  if (decisiones === 0 && datos === 0) return "Nada.";

  const partes: string[] = [];
  if (decisiones > 0) {
    partes.push(`${decisiones} ${plural(decisiones, "decisión", "decisiones")}`);
  }
  if (datos > 0) {
    partes.push(`${datos} ${plural(datos, "dato", "datos")}`);
  }

  return `${partes.join(" y ")}.`;
}
