/**
 * Detección de recurrencia y proyección financiera.
 *
 * Hasta acá EOS solo sabía sumar lo que ya había pasado y restar los
 * compromisos que el usuario había cargado a mano. Eso es una calculadora.
 *
 * La doctrina EOS Finanzas pide otra cosa: "EOS detecta → entiende → organiza
 * → prevé". Prever es esto: si el alquiler se pagó tres meses seguidos, EOS no
 * necesita que se lo carguen para saber que el mes que viene se paga otra vez.
 * Y si el sueldo entra todos los 30, EOS puede responder "próximo ingreso
 * estimado: 30 de agosto" sin preguntarle nada a nadie.
 *
 * Deliberadamente puro (sin I/O, sin fechas del sistema salvo las que se le
 * pasan) por la misma razón que `extraerMovimientos`: un error acá contamina el
 * disponible real, que es el número con el que el usuario decide si puede
 * gastar o no.
 *
 * Lo que este módulo NO hace, a propósito:
 *   - No escribe movimientos. Una proyección es dato derivado; persistirla
 *     duplicaría el gasto cuando el movimiento real aparezca.
 *   - No inventa series con una sola aparición. Un gasto no es recurrente
 *     porque ocurrió una vez.
 */

export type MovimientoBase = {
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number;
  fecha: string; // ISO YYYY-MM-DD
  descripcion: string | null;
};

export type Periodicidad = "semanal" | "quincenal" | "mensual" | "bimestral";

export type SerieRecurrente = {
  clave: string;
  tipo: MovimientoBase["tipo"];
  descripcion: string;
  /** Importe típico de la serie (mediana, no promedio: resiste un outlier). */
  monto: number;
  periodicidad: Periodicidad;
  ocurrencias: number;
  ultima_fecha: string;
  proxima_fecha: string;
  confianza: number;
};

export type MovimientoProyectado = {
  tipo: MovimientoBase["tipo"];
  descripcion: string;
  monto: number;
  fecha: string;
  periodicidad: Periodicidad;
  confianza: number;
};

/**
 * Tolerancia de importe dentro de una serie.
 *
 * El alquiler sube, la tarjeta varía, el sueldo tiene aguinaldo o descuentos.
 * Exigir el importe exacto haría que EOS no detecte nada en la vida real; ser
 * demasiado laxo agruparía gastos que no tienen nada que ver.
 */
const TOLERANCIA_MONTO = 0.15;

/** Con dos apariciones ya hay patrón, pero la confianza todavía es baja. */
const MIN_OCURRENCIAS = 2;

/** Series por debajo de esto no se proyectan: ensucian el disponible real. */
const CONFIANZA_MINIMA = 0.6;

/**
 * Cuántos períodos puede estar atrasada una serie antes de darla por muerta.
 *
 * Si el colegio terminó o la suscripción se dio de baja, la serie deja de
 * aparecer — pero el patrón viejo sigue en la base. Proyectarla igual le
 * restaría al usuario plata que en realidad tiene, que es exactamente el tipo
 * de error que la doctrina manda evitar: la interfaz tiene que reducir
 * ansiedad, no inventar compromisos que ya no existen.
 *
 * Uno de tolerancia porque el movimiento real puede simplemente no estar
 * cargado todavía; a partir de ahí, EOS asume que la serie se terminó.
 */
const MAX_PERIODOS_ATRASO = 1;

const DIAS = 86_400_000;

/* =========================================================
   NORMALIZACIÓN
========================================================= */

/**
 * Reduce una descripción a su núcleo comparable.
 *
 * "Pago alquiler agosto 2026" y "PAGO ALQUILER - Septiembre/2026" tienen que
 * caer en la misma serie: se sacan acentos, números, meses y puntuación, que
 * son justamente la parte que cambia entre repeticiones.
 */
export function normalizarDescripcion(texto: string | null): string {
  if (!texto) return "";

  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\d+/g, " ")
    .replace(
      /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/g,
      " ",
    )
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Etiqueta legible de una serie.
 *
 * La descripción cruda del primer movimiento arrastra el mes en el que
 * ocurrió ("Sueldo mayo 2026"), y mostrar eso al lado de un ingreso proyectado
 * para agosto confunde en vez de explicar. El nombre normalizado ya viene sin
 * números ni meses: alcanza con presentarlo.
 */
function etiqueta(nombre: string): string {
  if (!nombre) return "Movimiento";
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

/* =========================================================
   FECHAS (UTC, para que no se corra un día según la zona)
========================================================= */

function aFecha(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

function aISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / DIAS);
}

/**
 * Suma meses respetando el fin de mes.
 *
 * Un vencimiento el 31 no puede caer el 3 de marzo: si el mes destino no tiene
 * ese día, se ancla al último día del mes. Es como funciona cualquier débito.
 */
function sumarMeses(iso: string, meses: number): string {
  const base = aFecha(iso);
  const dia = base.getUTCDate();
  const destino = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + meses, 1));
  const ultimoDia = new Date(
    Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0),
  ).getUTCDate();
  destino.setUTCDate(Math.min(dia, ultimoDia));
  return aISO(destino);
}

export function sumarDias(iso: string, dias: number): string {
  return aISO(new Date(aFecha(iso).getTime() + dias * DIAS));
}

function avanzar(iso: string, periodicidad: Periodicidad): string {
  if (periodicidad === "semanal") return sumarDias(iso, 7);
  if (periodicidad === "quincenal") return sumarDias(iso, 15);
  if (periodicidad === "bimestral") return sumarMeses(iso, 2);
  return sumarMeses(iso, 1);
}

/* =========================================================
   ESTADÍSTICA MÍNIMA
========================================================= */

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

/* =========================================================
   DETECCIÓN DE PERIODICIDAD
========================================================= */

/**
 * Deduce cada cuánto se repite una serie a partir de sus fechas.
 *
 * Se mira primero el día del mes: es la señal más fuerte y más estable en la
 * vida real (sueldos, alquileres, cuotas caen "el 30", aunque el intervalo en
 * días varíe entre 28 y 31). Recién si eso no cierra se usa el intervalo.
 */
function detectarPeriodicidad(fechas: string[]): Periodicidad | null {
  if (fechas.length < MIN_OCURRENCIAS) return null;

  const dias = fechas.map((f) => aFecha(f).getUTCDate());
  const diaTipico = mediana(dias);
  const mismoDiaDelMes = dias.every((d) => Math.abs(d - diaTipico) <= 3);

  const intervalos: number[] = [];
  for (let i = 1; i < fechas.length; i += 1) {
    intervalos.push(diasEntre(fechas[i - 1], fechas[i]));
  }
  const intervalo = mediana(intervalos);

  if (mismoDiaDelMes && intervalo >= 25 && intervalo <= 35) return "mensual";
  if (intervalo >= 6 && intervalo <= 8) return "semanal";
  if (intervalo >= 13 && intervalo <= 17) return "quincenal";
  if (intervalo >= 25 && intervalo <= 35) return "mensual";
  if (intervalo >= 55 && intervalo <= 65) return "bimestral";

  return null;
}

/* =========================================================
   DETECCIÓN DE SERIES
========================================================= */

/**
 * Encuentra los movimientos que se repiten con patrón.
 *
 * Requisitos para que algo sea una serie, todos deliberados:
 *   1. Descripción reconocible — sin nombre no hay forma de saber que dos
 *      importes parecidos son "lo mismo" y no dos gastos distintos.
 *   2. Al menos dos apariciones.
 *   3. Importes consistentes entre sí (ver TOLERANCIA_MONTO).
 *   4. Una cadencia reconocible.
 */
export function detectarSeries(movimientos: MovimientoBase[]): SerieRecurrente[] {
  const grupos = new Map<string, { descripcion: string; items: MovimientoBase[] }>();

  for (const mov of movimientos) {
    const nombre = normalizarDescripcion(mov.descripcion);

    // Sin descripción utilizable no agrupamos: preferimos no detectar nada
    // antes que fusionar gastos distintos que casualmente costaron parecido.
    if (nombre.length < 3) continue;
    if (!Number.isFinite(mov.monto) || mov.monto <= 0) continue;

    const clave = `${mov.tipo}::${nombre}`;
    const grupo = grupos.get(clave);

    if (grupo) {
      grupo.items.push(mov);
    } else {
      grupos.set(clave, { descripcion: etiqueta(nombre), items: [mov] });
    }
  }

  const series: SerieRecurrente[] = [];

  for (const [clave, { descripcion, items }] of grupos) {
    if (items.length < MIN_OCURRENCIAS) continue;

    // Una misma fecha repetida no aporta cadencia (dos gastos el mismo día).
    const ordenados = [...items].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const fechas = [...new Set(ordenados.map((m) => m.fecha.slice(0, 10)))];
    if (fechas.length < MIN_OCURRENCIAS) continue;

    const montoTipico = mediana(ordenados.map((m) => m.monto));
    if (montoTipico <= 0) continue;

    const consistente = ordenados.every(
      (m) => Math.abs(m.monto - montoTipico) / montoTipico <= TOLERANCIA_MONTO,
    );
    if (!consistente) continue;

    const periodicidad = detectarPeriodicidad(fechas);
    if (!periodicidad) continue;

    // Tres apariciones ya no son casualidad; dos siguen siendo indicio.
    const confianza = fechas.length >= 4 ? 0.95 : fechas.length === 3 ? 0.85 : 0.6;

    const ultima = fechas[fechas.length - 1];

    series.push({
      clave,
      tipo: ordenados[0].tipo,
      descripcion,
      monto: Math.round(montoTipico * 100) / 100,
      periodicidad,
      ocurrencias: fechas.length,
      ultima_fecha: ultima,
      proxima_fecha: avanzar(ultima, periodicidad),
      confianza,
    });
  }

  return series.sort((a, b) => a.proxima_fecha.localeCompare(b.proxima_fecha));
}

/* =========================================================
   PROYECCIÓN
========================================================= */

/**
 * Proyecta las próximas ocurrencias de las series dentro de un horizonte.
 *
 * `yaRegistrados` evita el error más caro de todo este módulo: si el usuario ya
 * tiene cargado el alquiler de septiembre como compromiso, EOS no puede además
 * proyectarlo — le restaría dos veces la misma plata y le mostraría un
 * disponible más bajo del real. Se comparan por nombre normalizado y mes.
 */
export function proyectar(
  series: SerieRecurrente[],
  opciones: { desde: string; hasta: string; yaRegistrados?: MovimientoBase[] },
): MovimientoProyectado[] {
  const { desde, hasta, yaRegistrados = [] } = opciones;

  const ocupados = new Set(
    yaRegistrados
      .map((m) => {
        const nombre = normalizarDescripcion(m.descripcion);
        return nombre.length >= 3 ? `${m.tipo}::${nombre}::${m.fecha.slice(0, 7)}` : null;
      })
      .filter((clave): clave is string => clave !== null),
  );

  const proyectados: MovimientoProyectado[] = [];

  for (const serie of series) {
    if (serie.confianza < CONFIANZA_MINIMA) continue;

    let fecha = serie.proxima_fecha;

    // Si la serie quedó atrasada (el movimiento real todavía no se cargó),
    // se avanza hasta alcanzar el horizonte en vez de proyectar el pasado.
    let atraso = 0;
    while (fecha < desde && atraso <= MAX_PERIODOS_ATRASO) {
      fecha = avanzar(fecha, serie.periodicidad);
      atraso += 1;
    }

    // Se pasó de atraso: la serie dejó de ocurrir, no la resucitamos.
    if (fecha < desde) continue;

    let guardia = 0;
    while (fecha <= hasta && guardia < 60) {
      const nombre = normalizarDescripcion(serie.descripcion);
      const claveMes = `${serie.tipo}::${nombre}::${fecha.slice(0, 7)}`;

      if (!ocupados.has(claveMes)) {
        ocupados.add(claveMes);
        proyectados.push({
          tipo: serie.tipo,
          descripcion: serie.descripcion,
          monto: serie.monto,
          fecha,
          periodicidad: serie.periodicidad,
          confianza: serie.confianza,
        });
      }

      fecha = avanzar(fecha, serie.periodicidad);
      guardia += 1;
    }
  }

  return proyectados.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * El "próximo ingreso estimado" del panel.
 *
 * Es la línea que la doctrina pone como mensaje central junto al disponible
 * real, porque es lo que convierte un número en una respuesta: no es lo mismo
 * tener 2.800.000 con el sueldo entrando mañana que con el sueldo a 26 días.
 */
export function proximoIngreso(
  series: SerieRecurrente[],
  desde: string,
): MovimientoProyectado | null {
  const ingresos = series.filter((s) => s.tipo === "ingreso" && s.confianza >= CONFIANZA_MINIMA);
  if (ingresos.length === 0) return null;

  // Horizonte generoso: un ingreso bimestral todavía tiene que aparecer.
  const proyecciones = proyectar(ingresos, { desde, hasta: sumarMeses(desde, 3) });

  return proyecciones[0] ?? null;
}

export const _internos = { sumarMeses, sumarDias, detectarPeriodicidad, mediana, diasEntre };
