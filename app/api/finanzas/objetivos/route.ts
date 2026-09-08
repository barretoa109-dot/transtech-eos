import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay } from "@/lib/fecha";
import { armarFondo, DESTINOS_ESENCIALES, type Fondo } from "@/lib/finanzas/fondoEmergencia";
import { clasificar } from "@/lib/finanzas/destinos";
import { codigoMoneda } from "@/lib/finanzas/monedas";
import { detectarSeries } from "@/lib/finanzas/recurrencia";
import { exigirModulo } from "@/lib/modulos/acceso";
import {
  contrastarConElAhorro,
  evaluarObjetivo,
  type EstadoObjetivo,
  type ObjetivoFinanciero,
} from "@/lib/finanzas/objetivos";

export const dynamic = "force-dynamic";

/**
 * Los objetivos financieros de la persona, convertidos en plata por mes.
 *
 * ============================================================
 * DE DÓNDE SALE EL "CUÁNTO LLEVO"
 * ============================================================
 *
 * De dos lugares, en este orden:
 *
 *   1. Si el objetivo está atado a una cuenta (`cuenta_nombre`), del saldo
 *      declarado de esa cuenta. Se mantiene solo cada vez que la persona
 *      actualiza sus cuentas, que es una pantalla que ya visita.
 *   2. Si no, de `valor_actual`, que es lo que declaró para este objetivo.
 *
 * Lo que NO se hace es deducirlo del saldo total. Tener 30 millones en la
 * cuenta no significa que estén destinados a este objetivo, y contarlos así
 * daría un objetivo cumplido que nadie cumplió.
 *
 * ============================================================
 * SOLO LOS MONETARIOS, Y SOLO LOS PERSONALES
 * ============================================================
 *
 * `eos_goals` guarda también objetivos de porcentaje, numéricos y por hitos
 * —"terminar la mudanza", "cerrar tres clientes"—. Esos son objetivos de
 * gestión y no tienen aporte mensual: mostrarlos acá con una cuota inventada
 * sería peor que no mostrarlos.
 */

/** Meses hacia atrás que se miran para saber cuánto cuesta un mes de vida. */
const MESES_DE_HISTORIA = 6;

/** Cuántas veces tiene que repetirse un ingreso para llamarlo parejo. */
const CONFIANZA_INGRESO_PAREJO = 0.7;

type FilaObjetivo = {
  id: string;
  titulo: string;
  clase: string | null;
  ambito: string | null;
  moneda: string | null;
  cuenta_nombre: string | null;
  meses_cobertura: number | null;
  prioridad: number | null;
  valor_inicial: number | string | null;
  valor_actual: number | string | null;
  valor_objetivo: number | string | null;
  fecha_inicio: string;
  fecha_limite: string | null;
  estado: string;
  tipo_medicion: string;
  ultima_actualizacion_at: string | null;
};

export async function GET() {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;

  const hoy = hoyEnParaguay();
  const [anio, mes] = hoy.split("-").map(Number);
  const inicioDelMes = `${hoy.slice(0, 7)}-01`;
  const desdeHistoria = `${new Date(Date.UTC(anio, mes - 1 - MESES_DE_HISTORIA, 1)).toISOString().slice(0, 7)}-01`;

  const [politicaRes, objetivosRes, cuentasRes, movimientosRes, fijosRes, deudasRes] =
    await Promise.all([
      supabase
        .from("eos_finanzas_politica")
        .select("moneda,porcentaje_ahorro")
        .eq("usuario_id", usuarioId)
        .maybeSingle(),
      supabase
        .from("eos_goals")
        .select(
          "id,titulo,clase,ambito,moneda,cuenta_nombre,meses_cobertura,prioridad,valor_inicial,valor_actual,valor_objetivo,fecha_inicio,fecha_limite,estado,tipo_medicion,ultima_actualizacion_at",
        )
        .eq("usuario_id", usuarioId)
        .eq("ambito", "personal")
        .in("estado", ["borrador", "activo", "pausado", "completado"]),
      supabase
        .from("eos_finanzas_cuentas")
        .select("nombre,moneda,saldo_declarado,saldo_declarado_el")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .eq("activa", true),
      supabase
        .from("eos_movimientos_financieros")
        .select("tipo,monto,fecha,descripcion,categoria")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .gte("fecha", desdeHistoria)
        .order("fecha", { ascending: true }),
      supabase
        .from("eos_finanzas_fijos")
        .select("tipo,descripcion,monto")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .eq("activo", true),
      supabase
        .from("eos_finanzas_deudas")
        .select("acreedor,cuota_monto,estado")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .neq("estado", "saldada"),
    ]);

  const politica = politicaRes.data;
  if (!politica) {
    return NextResponse.json({ configurado: false }, { headers: noStore() });
  }

  const principal = codigoMoneda(politica.moneda, "PYG");

  const cuentas = ((cuentasRes.data ?? []) as Record<string, unknown>[]).map((c) => ({
    nombre: (c.nombre as string) ?? "",
    moneda: codigoMoneda(c.moneda as string | null, principal),
    saldo: c.saldo_declarado === null ? null : num(c.saldo_declarado),
    declarado_el: (c.saldo_declarado_el as string | null) ?? null,
  }));

  const filas = (objetivosRes.data ?? []) as unknown as FilaObjetivo[];

  const financieros = filas.filter(
    (f) => f.tipo_medicion === "monetario" && num(f.valor_objetivo) > 0,
  );

  const estados: EstadoObjetivo[] = financieros.map((f) => {
    const moneda = codigoMoneda(f.moneda, principal);
    const cuenta = f.cuenta_nombre
      ? cuentas.find((c) => c.nombre.toLowerCase() === (f.cuenta_nombre ?? "").toLowerCase())
      : undefined;

    // La cuenta manda solo si tiene saldo declarado. Una cuenta atada pero sin
    // saldo dejaría el objetivo en cero y borraría lo que la persona ya había
    // declarado para él.
    const desdeLaCuenta = cuenta && cuenta.saldo !== null;

    const objetivo: ObjetivoFinanciero = {
      id: f.id,
      titulo: f.titulo,
      clase: f.clase === "fondo_emergencia" ? "fondo_emergencia" : "general",
      moneda,
      prioridad: f.prioridad ?? 3,
      objetivo: num(f.valor_objetivo),
      inicial: num(f.valor_inicial),
      actual: desdeLaCuenta ? (cuenta.saldo as number) : num(f.valor_actual),
      origen: desdeLaCuenta ? "cuenta" : "declarado",
      actual_al: desdeLaCuenta
        ? cuenta.declarado_el
        : ((f.ultima_actualizacion_at ?? "").slice(0, 10) || null),
      desde: f.fecha_inicio,
      hasta: f.fecha_limite,
    };

    return evaluarObjetivo(objetivo, hoy);
  });

  /*
   * El ahorro comprometido, en plata.
   *
   * Sale del ingreso REAL del mes en curso y no de una estimación: es el mismo
   * criterio que usa el panel, y así el contraste habla del mismo dinero que
   * la persona ve en "¿estoy bien?".
   */
  const movimientos = ((movimientosRes.data ?? []) as Record<string, unknown>[]).map((m) => ({
    tipo: m.tipo as "ingreso" | "gasto" | "compromiso",
    monto: num(m.monto),
    fecha: m.fecha as string,
    descripcion: (m.descripcion as string | null) ?? null,
    categoria: (m.categoria as string | null) ?? null,
  }));

  const ingresoDelMes = movimientos
    .filter((m) => m.tipo === "ingreso" && m.fecha >= inicioDelMes && m.fecha <= hoy)
    .reduce((t, m) => t + m.monto, 0);

  const ahorroMensual = (ingresoDelMes * num(politica.porcentaje_ahorro)) / 100;

  const contraste = contrastarConElAhorro(estados, ahorroMensual, principal);

  const fondo = armarElFondo({
    movimientos,
    inicioDelMes,
    fijos: ((fijosRes.data ?? []) as Record<string, unknown>[])
      .filter((f) => f.tipo !== "ingreso")
      .map((f) => ({ descripcion: (f.descripcion as string) ?? "Fijo", monto: num(f.monto) })),
    cuotas: ((deudasRes.data ?? []) as Record<string, unknown>[])
      .filter((d) => num(d.cuota_monto) > 0)
      .map((d) => ({ descripcion: `Cuota — ${d.acreedor as string}`, monto: num(d.cuota_monto) })),
    objetivoDelFondo: estados.find((e) => e.clase === "fondo_emergencia") ?? null,
    mesesElegidos: financieros.find((f) => f.clase === "fondo_emergencia")?.meses_cobertura ?? null,
  });

  return NextResponse.json(
    {
      configurado: true,
      moneda: principal,
      objetivos: estados.filter((e) => e.clase === "general"),
      fondo,
      /*
       * El objetivo que respalda al fondo, aparte de la lista.
       *
       * La pantalla del fondo necesita su id para poder actualizar la
       * cobertura elegida sin crear un segundo fondo. Devolverlo mezclado con
       * los demás lo haría aparecer dos veces en la pantalla de objetivos.
       */
      fondo_objetivo: estados.find((e) => e.clase === "fondo_emergencia") ?? null,
      contraste,
      /*
       * Los objetivos que EOS tiene pero no puede convertir en plata. Se
       * informan en vez de esconderse: quien creó "terminar la mudanza" desde
       * el chat tiene que ver que existe, aunque no tenga aporte mensual.
       */
      no_financieros: filas
        .filter((f) => f.tipo_medicion !== "monetario" || num(f.valor_objetivo) <= 0)
        .filter((f) => f.estado === "activo")
        .map((f) => ({ id: f.id, titulo: f.titulo })),
    },
    { headers: noStore() },
  );
}

/**
 * El fondo de emergencia, con el gasto esencial de esta persona.
 *
 * Vive acá y no en la ruta principal porque necesita clasificar seis meses de
 * gastos, y esa vuelta solo hace falta para esto.
 */
function armarElFondo(datos: {
  movimientos: { tipo: string; monto: number; fecha: string; descripcion: string | null; categoria: string | null }[];
  inicioDelMes: string;
  fijos: { descripcion: string; monto: number }[];
  cuotas: { descripcion: string; monto: number }[];
  objetivoDelFondo: EstadoObjetivo | null;
  mesesElegidos: number | null;
}): Fondo {
  const esenciales = new Set<string>(DESTINOS_ESENCIALES);

  const porMes = new Map<string, { esencial: number; sinReconocer: number }>();

  for (const m of datos.movimientos) {
    // El mes en curso queda afuera: incompleto, tira la mediana para abajo y
    // haría creer que un mes de vida cuesta menos de lo que cuesta.
    if (m.tipo !== "gasto" || m.fecha >= datos.inicioDelMes) continue;

    const clave = m.fecha.slice(0, 7);
    const fila = porMes.get(clave) ?? { esencial: 0, sinReconocer: 0 };
    const destino = clasificar(m.descripcion, m.categoria);

    if (esenciales.has(destino)) fila.esencial += m.monto;
    else if (destino === "otros") fila.sinReconocer += m.monto;

    porMes.set(clave, fila);
  }

  const meses = [...porMes.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

  /*
   * Si el ingreso llega parejo todos los meses.
   *
   * Es el único dato con el que EOS puede sugerir una cobertura sin repetir
   * una recomendación ajena: quien cobra distinto cada mes necesita más
   * colchón que quien tiene sueldo.
   */
  const seriesDeIngreso = detectarSeries(
    datos.movimientos.map((m) => ({
      tipo: m.tipo as "ingreso" | "gasto" | "compromiso",
      monto: m.monto,
      fecha: m.fecha,
      descripcion: m.descripcion,
    })),
  ).filter((s) => s.tipo === "ingreso");

  const ingresoRegular =
    datos.movimientos.filter((m) => m.tipo === "ingreso").length < 3
      ? null
      : seriesDeIngreso.some((s) => s.confianza >= CONFIANZA_INGRESO_PAREJO);

  return armarFondo({
    esencialPorMes: meses.map(([, f]) => f.esencial),
    sinReconocerPorMes: meses.map(([, f]) => f.sinReconocer),
    fijos: datos.fijos,
    cuotas: datos.cuotas,
    fondoActual: datos.objetivoDelFondo?.actual ?? 0,
    mesesElegidos: datos.mesesElegidos,
    ingresoRegular,
  });
}

function num(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

/* ============================================================
 * Crear un objetivo
 * ============================================================
 *
 * Declarar una meta no es cargar transacciones a mano: es la misma categoría
 * que la Constitución Financiera o los gastos fijos. Se dice una vez y EOS
 * trabaja con eso.
 *
 * Son tres campos —qué, cuánto y para cuándo— porque son los tres que hacen
 * falta para poder decir cuánto apartar por mes. Un cuarto campo es un cuarto
 * motivo para abandonar la pantalla.
 */
export async function POST(request: Request) {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const titulo = typeof body.titulo === "string" ? body.titulo.trim() : "";
  const monto = Number(body.valor_objetivo);
  const clase = body.clase === "fondo_emergencia" ? "fondo_emergencia" : "general";

  if (titulo.length < 3) {
    return NextResponse.json(
      { error: "Contame en pocas palabras qué querés lograr." },
      { status: 400, headers: noStore() },
    );
  }

  if (!Number.isFinite(monto) || monto <= 0 || monto > MAXIMO_RAZONABLE) {
    return NextResponse.json(
      { error: "El monto del objetivo no parece un número válido." },
      { status: 400, headers: noStore() },
    );
  }

  const hasta = fechaValida(body.fecha_limite);
  const hoy = hoyEnParaguay();

  if (hasta !== null && hasta < hoy) {
    return NextResponse.json(
      { error: "Esa fecha ya pasó. Poné una hacia adelante o dejala vacía." },
      { status: 400, headers: noStore() },
    );
  }

  const { data, error } = await supabase
    .from("eos_goals")
    .insert({
      usuario_id: usuarioId,
      titulo: titulo.slice(0, 180),
      tipo_medicion: "monetario",
      ambito: "personal",
      clase,
      valor_objetivo: monto,
      // Con cuánto arranca. Es lo que después permite decir si el esfuerzo
      // mensual necesario subió o bajó desde que lo definió.
      valor_inicial: normalizarMonto(body.valor_actual),
      valor_actual: normalizarMonto(body.valor_actual),
      cuenta_nombre: typeof body.cuenta_nombre === "string" ? body.cuenta_nombre.trim().slice(0, 80) || null : null,
      meses_cobertura: clase === "fondo_emergencia" ? normalizarMeses(body.meses_cobertura) : null,
      prioridad: normalizarPrioridad(body.prioridad),
      fecha_inicio: hoy,
      fecha_limite: hasta,
      estado: "activo",
      metadata: { fuente: "personal_objetivos" },
    })
    .select("id")
    .single();

  if (error) {
    // El índice único del fondo: uno solo por persona, y es un invariante real.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya tenés un fondo de emergencia. Editá el que está en vez de crear otro." },
        { status: 409, headers: noStore() },
      );
    }
    console.error("No se pudo crear el objetivo:", error);
    return NextResponse.json(
      { error: "No pudimos guardar tu objetivo." },
      { status: 500, headers: noStore() },
    );
  }

  return NextResponse.json({ ok: true, id: data.id }, { headers: noStore() });
}

/* ============================================================
 * Actualizar uno
 * ============================================================
 *
 * Tres cosas que cambian con el tiempo: cuánto llevás juntado, cuántos meses
 * de cobertura elegiste y si el objetivo sigue vivo. El resto se corrige
 * borrando y creando, que para tres campos es más simple que un formulario de
 * edición completo.
 */
export async function PATCH(request: Request) {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Falta el objetivo." }, { status: 400, headers: noStore() });
  }

  const cambios: Record<string, unknown> = {
    ultima_actualizacion_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (body.valor_actual !== undefined) {
    const monto = normalizarMonto(body.valor_actual);
    if (monto === null) {
      return NextResponse.json(
        { error: "Ese monto no parece un número válido." },
        { status: 400, headers: noStore() },
      );
    }
    cambios.valor_actual = monto;
  }

  if (body.meses_cobertura !== undefined) {
    cambios.meses_cobertura = normalizarMeses(body.meses_cobertura);
  }

  if (body.cuenta_nombre !== undefined) {
    cambios.cuenta_nombre =
      typeof body.cuenta_nombre === "string" && body.cuenta_nombre.trim().length > 0
        ? body.cuenta_nombre.trim().slice(0, 80)
        : null;
  }

  if (typeof body.estado === "string" && ESTADOS.includes(body.estado)) {
    cambios.estado = body.estado;
  }

  const { error } = await supabase
    .from("eos_goals")
    .update(cambios)
    .eq("id", id)
    .eq("ambito", "personal")
    .eq("usuario_id", usuarioId);

  if (error) {
    console.error("No se pudo actualizar el objetivo:", error);
    return NextResponse.json(
      { error: "No pudimos guardar el cambio." },
      { status: 500, headers: noStore() },
    );
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}

const MAXIMO_RAZONABLE = 999_999_999_999;
const ESTADOS = ["activo", "pausado", "completado", "cancelado"];

function normalizarMonto(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return 0;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > MAXIMO_RAZONABLE) return null;
  return Math.round(n * 100) / 100;
}

function normalizarMeses(valor: unknown): number | null {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 1 || n > 24) return null;
  return Math.round(n);
}

function normalizarPrioridad(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
}

/** Una fecha ISO o `null`. Cualquier otra cosa es `null`, no un error silencioso. */
function fechaValida(valor: unknown): string | null {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const [anio, mes, dia] = valor.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
    ? valor
    : null;
}
