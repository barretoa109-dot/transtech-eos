import type { MovimientoProyectado } from "./recurrencia.ts";

/**
 * "El 28 te vas a quedar corto para el alquiler."
 *
 * La fase 3 de la hoja de ruta pide que EOS avise ANTES de que el problema
 * exista. Todo lo que hace falta para eso ya estaba en la base —cuotas con
 * fecha, gastos fijos declarados, series detectadas, el próximo ingreso—; lo
 * que faltaba era cruzarlo en una línea de tiempo y encontrar el día en que la
 * plata no alcanza.
 *
 * ============================================================
 * LA DIFERENCIA CON EL DISPONIBLE REAL, QUE NO HAY QUE BORRAR
 * ============================================================
 *
 * El panel calcula el disponible real SIN sumar el ingreso estimado, porque no
 * se gasta plata que todavía no entró. Acá es al revés: **la simulación sí
 * cuenta los ingresos proyectados**, y tiene que hacerlo.
 *
 * Si no los contara, EOS avisaría "el 28 te quedás corto" a alguien que cobra
 * el 25. Esa alerta es falsa, y una alerta falsa no es un costo menor: enseña
 * a ignorar las alertas, que es exactamente lo que rompe el producto. Un
 * número conservador es prudente en un panel que el usuario mira; una alarma
 * conservadora de más es ruido que apaga las verdaderas.
 */

export type Riesgo = {
  /** El día en que el saldo cruza la reserva mínima. */
  fecha: string;
  /** Cuántos días faltan para ese día. */
  dias: number;
  /** Cuánto falta para no cruzarla. Siempre positivo. */
  faltante: number;
  /** El gasto que produce el cruce. */
  gatillo: { descripcion: string; monto: number };
  /**
   * El primer ingreso que llega DESPUÉS del problema, si hay alguno.
   *
   * Es el dato que convierte un susto en una decisión: no es lo mismo estar
   * corto dos días antes de cobrar que estar corto sin nada a la vista.
   */
  alivio: { descripcion: string; fecha: string; monto: number; dias_tarde: number } | null;
};

/** Ventana de aviso. Más lejos que esto todavía no es un problema. */
const HORIZONTE_DIAS = 45;

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function sumarDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Recorre los próximos días y devuelve el primer momento en que la plata no
 * alcanza. `null` significa que no hay problema a la vista, que es la
 * respuesta más frecuente y la que no genera ninguna notificación.
 */
export function detectarRiesgo(opciones: {
  hoy: string;
  saldoActual: number;
  reservaMinima: number;
  egresos: MovimientoProyectado[];
  ingresos: MovimientoProyectado[];
  horizonteDias?: number;
}): Riesgo | null {
  const { hoy, saldoActual, reservaMinima, egresos, ingresos } = opciones;
  const hasta = sumarDias(hoy, opciones.horizonteDias ?? HORIZONTE_DIAS);

  const enVentana = (m: MovimientoProyectado) => m.fecha >= hoy && m.fecha <= hasta;

  /**
   * Dentro de un mismo día, los egresos van PRIMERO.
   *
   * Si el sueldo entra el mismo 5 en que se debita la cuota, no se puede dar
   * por sentado que la acreditación llegue antes que el débito. Acá conviene
   * ser conservador: avisar de un aprieto que termina resolviéndose solo es
   * mucho más barato que callarse uno real.
   */
  const eventos = [
    ...egresos.filter(enVentana).map((m) => ({ ...m, orden: 0, signo: -1 })),
    ...ingresos.filter(enVentana).map((m) => ({ ...m, orden: 1, signo: 1 })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden - b.orden);

  let saldo = saldoActual;

  for (const evento of eventos) {
    saldo += evento.signo * evento.monto;

    if (evento.signo === 1 || saldo >= reservaMinima) continue;

    // Primer cruce: se informa y se corta. Un aviso, un tema.
    const posteriores = ingresos
      .filter((i) => i.fecha > evento.fecha)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    const siguiente = posteriores[0] ?? null;

    return {
      fecha: evento.fecha,
      dias: diasEntre(hoy, evento.fecha),
      faltante: Math.round((reservaMinima - saldo) * 100) / 100,
      gatillo: { descripcion: evento.descripcion, monto: evento.monto },
      alivio: siguiente
        ? {
            descripcion: siguiente.descripcion,
            fecha: siguiente.fecha,
            monto: siguiente.monto,
            dias_tarde: diasEntre(evento.fecha, siguiente.fecha),
          }
        : null,
    };
  }

  return null;
}

/* =========================================================
   CÓMO LO DICE EOS

   La hoja de ruta pide, junto con el motor de alertas, un manual de tono. Las
   reglas viven acá y no en un documento aparte para que sean ejecutables: un
   documento de estilo se desactualiza sin que nadie se entere; una función con
   tests, no.

   1. **Siempre con fecha y monto.** "Te vas a quedar corto" sin número es
      ansiedad sin información. El usuario de este producto ya sabe que está
      preocupado; lo que no sabe es cuánto ni cuándo.
   2. **Sin culpa.** Nunca "gastaste de más" ni "no controlaste". El aviso
      habla del futuro y de plata, no del carácter de nadie.
   3. **Un tema por vez.** Se avisa del primer problema, no de los cuatro que
      podrían venir. Cuatro problemas juntos se leen como una catástrofe y se
      cierran sin leer.
   4. **Terminar en algo que se pueda hacer o saber.** Cuándo entra plata de
      nuevo es información accionable; "cuidá tus gastos" no lo es.
========================================================= */

function plata(monto: number, moneda: string): string {
  const simbolo = moneda === "USD" ? "US$" : "₲";
  return `${simbolo} ${new Intl.NumberFormat("es-PY").format(Math.round(monto))}`;
}

function diaDelMes(iso: string): string {
  return String(Number(iso.slice(8, 10)));
}

/** El aviso, listo para mandar por correo o push. */
export function redactarAviso(riesgo: Riesgo, moneda = "PYG"): string {
  const cuando =
    riesgo.dias === 0
      ? "hoy"
      : riesgo.dias === 1
        ? "mañana"
        : `el ${diaDelMes(riesgo.fecha)}`;

  const base = `${cuando === "hoy" ? "Hoy" : cuando === "mañana" ? "Mañana" : `El ${diaDelMes(riesgo.fecha)}`} te va a faltar ${plata(
    riesgo.faltante,
    moneda,
  )} para ${riesgo.gatillo.descripcion.toLowerCase()}.`;

  if (!riesgo.alivio) {
    // Sin ingreso a la vista, no se inventa un consuelo. Decir "ya se va a
    // acomodar" cuando no hay nada previsto sería mentirle al usuario.
    return `${base} No tengo ningún ingreso previsto antes de esa fecha.`;
  }

  const cuandoEntra =
    riesgo.alivio.dias_tarde === 1
      ? "un día después"
      : `${riesgo.alivio.dias_tarde} días después`;

  return `${base} Tu próximo ingreso previsto entra ${cuandoEntra}, el ${diaDelMes(
    riesgo.alivio.fecha,
  )}.`;
}
