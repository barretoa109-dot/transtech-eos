import { createClient } from "@/lib/supabase/server";
import { convieneConciliar } from "@/lib/finanzas/conciliacion";
import { confirmadosPorLaRealidad, type Fijo } from "@/lib/finanzas/fijos";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { armarPanorama, type EgresoPanorama } from "@/lib/finanzas/panorama";
import { noCuadran, trazarPanel } from "@/lib/finanzas/trazabilidad";
import {
  agruparPorMoneda,
  codigoMoneda,
  ordenarMonedas,
  puntosDePartida,
  volumenPorMoneda,
  type PuntoDePartida,
} from "@/lib/finanzas/monedas";
import type { Deuda } from "@/lib/finanzas/deudas";
import type { MovimientoProyectado } from "@/lib/finanzas/recurrencia";
import { NextResponse } from "next/server";
import { exigirModulo } from "@/lib/modulos/acceso";

export const dynamic = "force-dynamic";

/**
 * Hasta dónde se arma la línea de tiempo antes de recortarla.
 *
 * El panel solo mira hasta el próximo ingreso, pero cuál es ese ingreso recién
 * se sabe DESPUÉS de proyectar. Así que se proyecta largo una vez y se corta
 * después, en vez de adivinar el horizonte y tener que volver a empezar.
 */
const HORIZONTE_ARMADO_DIAS = 90;

/** Sin un ingreso detectado, el ciclo por defecto de un mes. */
const CICLO_POR_DEFECTO_DIAS = 30;

type Movimiento = {
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number | string | null;
  moneda: string | null;
  fecha: string;
  descripcion: string | null;
};

type ConciliacionFila = {
  fecha: string;
  saldo_declarado: number | string | null;
};

type Politica = {
  moneda: string;
  saldo_inicial: number | string | null;
  saldo_inicial_fecha: string;
  reserva_minima: number | string | null;
  porcentaje_ahorro: number | string | null;
  umbral_autorizacion: number | string | null;
};

type CuentaFila = {
  nombre: string;
  tipo: string;
  moneda: string | null;
  saldo_declarado: number | string | null;
  saldo_declarado_el: string | null;
};

/**
 * Estado financiero para el panel "¿Estoy bien?".
 *
 * Sigue la doctrina EOS Finanzas del usuario: la métrica central NO es el
 * saldo sino el DISPONIBLE REAL, es decir lo que queda después de honrar
 * compromisos futuros, la reserva mínima y el ahorro comprometido.
 *
 * El armado de la línea de tiempo vive en `lib/finanzas/panorama.ts` y es el
 * MISMO que usa la alerta de riesgo. Antes cada uno sumaba lo suyo y el panel
 * no contaba las cuotas de las deudas: el usuario veía "estás bien" en una
 * pantalla y "el 28 no te alcanza" en la otra, sobre la misma plata.
 *
 * ============================================================
 * UNA LÍNEA DE TIEMPO POR MONEDA
 * ============================================================
 *
 * Antes se sumaba todo junto: los dólares y los guaraníes caían en el mismo
 * total, y el panel mostraba un número que no existe en ninguna moneda. Ahora
 * cada moneda se calcula entera y por separado —su saldo, sus compromisos, su
 * disponible real— y ninguna se convierte a otra. El porqué de no convertir
 * está en el comentario de cabecera de `lib/finanzas/monedas.ts`.
 *
 * La respuesta mantiene en la raíz los campos de la moneda PRINCIPAL, tal como
 * estaban: la alerta de riesgo, el briefing y el panel viejo los leen de ahí.
 * Las demás monedas viven en `monedas[]`.
 */
export async function GET() {
  // El panel es una función que se contrata. `exigirModulo` también resuelve la
  // sesión, así que esto reemplaza al `getUser()` que había acá y no se suma a
  // él: dos validaciones de token por request son dos viajes al servidor de
  // auth, y esta ruta es de las que se piden apenas abre la pantalla.
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const user = { id: puerta.usuarioId };

  const [politicaRes, movimientosRes, objetivosRes, conciliacionesRes, fijosRes, deudasRes, cuentasRes] =
    await Promise.all([
      supabase
        .from("eos_finanzas_politica")
        .select("moneda,saldo_inicial,saldo_inicial_fecha,reserva_minima,porcentaje_ahorro,umbral_autorizacion")
        .eq("usuario_id", user.id)
        .maybeSingle(),
      supabase
        .from("eos_movimientos_financieros")
        .select("tipo,monto,moneda,fecha,descripcion")
        .eq("usuario_id", user.id)
        .order("fecha", { ascending: true }),
      supabase.from("eos_goals").select("estado,progreso").eq("usuario_id", user.id),
      supabase
        .from("eos_finanzas_conciliaciones")
        .select("fecha,saldo_declarado")
        .eq("usuario_id", user.id)
        .order("fecha", { ascending: true }),
      supabase
        .from("eos_finanzas_fijos")
        .select("tipo,descripcion,monto,moneda,dia_del_mes")
        .eq("usuario_id", user.id)
        .eq("activo", true),
      supabase
        .from("eos_finanzas_deudas")
        .select(
          "acreedor,tipo,moneda,saldo_declarado,saldo_declarado_el,cuota_monto,cuota_dia,cuotas_totales,cuotas_pagadas,vence_el,estado,preocupa",
        )
        .eq("usuario_id", user.id)
        .neq("estado", "saldada"),
      supabase
        .from("eos_finanzas_cuentas")
        .select("nombre,tipo,moneda,saldo_declarado,saldo_declarado_el")
        .eq("usuario_id", user.id)
        .eq("activa", true),
    ]);

  if (politicaRes.error && politicaRes.error.code !== "PGRST116") {
    console.error("No se pudo leer la política financiera:", politicaRes.error);
  }

  const politica = (politicaRes.data ?? null) as Politica | null;

  // Sin Constitución Financiera todavía no hay nada que calcular: EOS no
  // inventa un estado, informa que falta configurarse.
  if (!politica) {
    return NextResponse.json({ configurado: false }, { headers: noStore() });
  }

  const principal = codigoMoneda(politica.moneda, "PYG");

  const movimientos = ((movimientosRes.data ?? []) as Movimiento[]).map((m) => ({
    tipo: m.tipo,
    fecha: m.fecha,
    descripcion: m.descripcion,
    monto: num(m.monto),
    moneda: codigoMoneda(m.moneda, principal),
  }));

  // El día del usuario, no el del servidor. `toISOString()` es UTC: a las
  // 23:00 de Paraguay ya sería mañana, y un compromiso que vence mañana
  // dejaría de contarse como futuro.
  const hoyISO = hoyEnParaguay();

  const fijos = (
    (fijosRes.data ?? []) as {
      tipo: string;
      descripcion: string;
      monto: number | string;
      moneda: string | null;
      dia_del_mes: number;
    }[]
  ).map((f) => ({
    tipo: (f.tipo === "ingreso" ? "ingreso" : "gasto") as Fijo["tipo"],
    descripcion: f.descripcion,
    monto: num(f.monto),
    dia_del_mes: f.dia_del_mes,
    moneda: codigoMoneda(f.moneda, principal),
  }));

  const deudas = ((deudasRes.data ?? []) as unknown as Deuda[]).map((d) => ({
    ...d,
    moneda: codigoMoneda(d.moneda, principal),
    saldo_declarado: num(d.saldo_declarado),
    cuota_monto: d.cuota_monto === null ? null : num(d.cuota_monto),
  }));

  const cuentas = ((cuentasRes.data ?? []) as CuentaFila[]).map((c) => ({
    nombre: c.nombre,
    tipo: c.tipo,
    moneda: codigoMoneda(c.moneda, principal),
    saldo_declarado: c.saldo_declarado === null ? null : num(c.saldo_declarado),
    saldo_declarado_el: c.saldo_declarado_el,
  }));

  /*
   * Las conciliaciones son SOLO de la moneda principal.
   *
   * Conciliar es "decime tu saldo real para que aprenda cuánto se te va sin que
   * yo lo vea", y el gasto invisible —efectivo, billetera— ocurre en la moneda
   * con la que se vive. El punto de partida de las otras monedas sale de las
   * cuentas declaradas, que sí tienen moneda. Ver la migración v65.
   */
  const conciliaciones = ((conciliacionesRes.data ?? []) as ConciliacionFila[]).map((c) => ({
    fecha: c.fecha,
    saldo_declarado: num(c.saldo_declarado),
  }));

  // Qué monedas tiene realmente el usuario: las de sus movimientos, las de sus
  // deudas y las de las cuentas que declaró. La principal está siempre.
  const volumenes = volumenPorMoneda(movimientos, principal);
  for (const d of deudas) {
    if (!volumenes.has(d.moneda)) volumenes.set(d.moneda, 0);
  }
  for (const c of cuentas) {
    if (!volumenes.has(c.moneda)) volumenes.set(c.moneda, 0);
  }

  const monedas = ordenarMonedas(volumenes, principal);

  const primerMovimiento = new Map<string, string>();
  for (const m of movimientos) {
    const actual = primerMovimiento.get(m.moneda);
    if (!actual || m.fecha < actual) primerMovimiento.set(m.moneda, m.fecha);
  }

  const partidas = puntosDePartida({
    principal,
    saldoInicial: num(politica.saldo_inicial),
    saldoInicialFecha: politica.saldo_inicial_fecha,
    cuentas,
    primerMovimiento,
    monedas,
  });

  const movimientosPorMoneda = agruparPorMoneda(movimientos, principal);
  const fijosPorMoneda = agruparPorMoneda(fijos, principal);
  const deudasPorMoneda = agruparPorMoneda(deudas, principal);

  const objetivos = (objetivosRes.data ?? []) as { estado: string | null; progreso: number | null }[];
  const objetivosActivos = objetivos.filter((o) => o.estado === "activo");
  const objetivosEnRitmo =
    objetivosActivos.length === 0 || objetivosActivos.every((o) => (o.progreso ?? 0) > 0);

  const bloques = monedas.map((moneda) =>
    armarBloque({
      moneda,
      principal,
      hoyISO,
      partida: partidas.get(moneda)!,
      // La reserva mínima y el porcentaje de ahorro son de la Constitución, que
      // está escrita en la moneda principal. Aplicarlos a los dólares sería
      // reservar el mismo número en otra moneda, que puede ser diez veces más.
      reservaMinima: moneda === principal ? num(politica.reserva_minima) : 0,
      porcentajeAhorro: moneda === principal ? num(politica.porcentaje_ahorro) : 0,
      movimientos: movimientosPorMoneda.get(moneda) ?? [],
      fijos: fijosPorMoneda.get(moneda) ?? [],
      deudas: deudasPorMoneda.get(moneda) ?? [],
      conciliaciones: moneda === principal ? conciliaciones : [],
      cuentas: cuentas.filter((c) => c.moneda === moneda),
      objetivosEnRitmo: moneda === principal ? objetivosEnRitmo : true,
    }),
  );

  const bloquePrincipal = bloques[0];

  // El estado global es el PEOR de todas las monedas. Si los guaraníes están
  // bien pero la cuenta en dólares no cubre su cuota, el panel no puede decir
  // "todo bajo control".
  const estado: Estado = bloques.some((b) => b.estado === "accion")
    ? "accion"
    : bloques.some((b) => b.estado === "atencion")
      ? "atencion"
      : "seguro";

  return NextResponse.json(
    {
      configurado: true,
      sin_datos: movimientos.length === 0,
      moneda: principal,
      estado,
      // ---- La moneda principal, en la raíz, como siempre ----
      disponible_real: bloquePrincipal.disponible_real,
      saldo_estimado: bloquePrincipal.saldo_estimado,
      ingresos: bloquePrincipal.ingresos,
      gastos: bloquePrincipal.gastos,
      reserva_minima: bloquePrincipal.reserva_minima,
      ahorro_comprometido: bloquePrincipal.ahorro_comprometido,
      compromisos: bloquePrincipal.compromisos,
      reserva_protegida: bloquePrincipal.reserva_protegida,
      objetivos_en_ritmo: objetivosEnRitmo,
      objetivos_activos: objetivosActivos.length,
      movimientos_registrados: movimientos.length,
      prevision: bloquePrincipal.prevision,
      conciliacion: bloquePrincipal.conciliacion,
      // ---- Todas las monedas, incluida la principal ----
      monedas: bloques,
    },
    { headers: noStore() },
  );
}

type Estado = "seguro" | "atencion" | "accion";

/**
 * Todo el panel, para UNA moneda.
 *
 * Es el mismo cálculo que había antes en el cuerpo de la ruta; lo único que
 * cambió es que ahora se lo llama una vez por moneda en vez de una vez con
 * todo mezclado.
 */
function armarBloque(datos: {
  moneda: string;
  principal: string;
  hoyISO: string;
  partida: PuntoDePartida;
  reservaMinima: number;
  porcentajeAhorro: number;
  movimientos: { tipo: "ingreso" | "gasto" | "compromiso"; monto: number; fecha: string; descripcion: string | null }[];
  fijos: Fijo[];
  deudas: Deuda[];
  conciliaciones: { fecha: string; saldo_declarado: number }[];
  cuentas: { nombre: string; tipo: string; saldo_declarado: number | null; saldo_declarado_el: string | null }[];
  objetivosEnRitmo: boolean;
}) {
  const { hoyISO, movimientos } = datos;

  const panorama = armarPanorama({
    hoy: hoyISO,
    hasta: sumarDias(hoyISO, HORIZONTE_ARMADO_DIAS),
    saldoInicial: datos.partida.base,
    saldoInicialFecha: datos.partida.desde,
    reservaMinima: datos.reservaMinima,
    movimientos,
    conciliaciones: datos.conciliaciones,
    fijos: datos.fijos,
    deudas: datos.deudas,
  });

  const ingresos = panorama.aplicado.ingresos;
  const gastos = panorama.aplicado.gastos;
  const estadoConciliacion = panorama.conciliacion;

  // El próximo ingreso es el más cercano de los dos mundos: el que ya está
  // cargado a futuro y el que EOS proyecta. Mirar solo las proyecciones diría
  // "cobrás el 25 de septiembre" a alguien que tiene el sueldo de septiembre
  // ya anotado — y un ingreso que EOS no ve es plata que el usuario cree que
  // EOS está contando.
  const ingresoAnotado = movimientos
    .filter((m) => m.tipo === "ingreso" && m.fecha > hoyISO)
    .map<MovimientoProyectado>((m) => ({
      tipo: "ingreso",
      descripcion: m.descripcion ?? "Ingreso",
      monto: m.monto,
      fecha: m.fecha,
      periodicidad: "mensual",
      confianza: 1,
    }))[0];

  const ingresoEstimado = primeroPorFecha(ingresoAnotado, panorama.ingresos[0]);

  // El horizonte natural del disponible real es "hasta que vuelva a entrar
  // plata": ese es el tramo que el usuario tiene que atravesar con lo que
  // tiene hoy. Sin un ingreso detectado, 30 días es el ciclo por defecto.
  const horizonte = ingresoEstimado
    ? ingresoEstimado.fecha
    : sumarDias(hoyISO, CICLO_POR_DEFECTO_DIAS);

  const egresos = panorama.egresos.filter((e) => e.fecha <= horizonte);
  const porFuente = (fuente: EgresoPanorama["fuente"]) => egresos.filter((e) => e.fuente === fuente);

  const anotados = porFuente("anotado");
  const previsibles = porFuente("previsible");
  const cuotas = porFuente("cuota");

  const totalCompromisos = sumar(anotados);
  const totalPrevisible = sumar(previsibles);
  const totalCuotas = sumar(cuotas);

  const saldoEstimado = panorama.saldoActual;
  const reserva = panorama.reservaMinima;
  const ahorroComprometido = (ingresos * datos.porcentajeAhorro) / 100;

  // Todo lo que ya tiene dueño antes de que el usuario decida nada.
  const comprometido = totalCompromisos + totalPrevisible + totalCuotas;

  // El ingreso estimado NO se suma: no se gasta plata que todavía no entró.
  // Se informa aparte, porque no es lo mismo tener el sueldo mañana que a 26 días.
  const disponibleReal = saldoEstimado - comprometido - reserva - ahorroComprometido;

  const compromisosCubiertos = saldoEstimado - reserva >= comprometido;
  const reservaProtegida = saldoEstimado >= reserva;

  /*
   * De dónde sale cada número, armado con los MISMOS arrays que se acaban de
   * sumar. No se vuelve a filtrar nada: si el detalle se recalculara aparte,
   * un día no cuadraría con el total, y un detalle que no cuadra es peor que
   * no tener detalle. Ver `lib/finanzas/trazabilidad.ts`.
   */
  const trazas = trazarPanel({
    aplicado: panorama.aplicado,
    anotados,
    previsibles,
    cuotas,
    horizonte,
    saldoBase: panorama.conciliacion.base,
    gastoInvisible: panorama.conciliacion.gasto_invisible,
    saldoEstimado,
    totalCompromisos,
    totalPrevisible,
    totalCuotas,
    reserva,
    ahorroComprometido,
    disponibleReal,
  });

  // Que una traza no cuadre significa que la aritmética de acá arriba cambió y
  // el desglose quedó viejo. No se le oculta al usuario —el número que ve sigue
  // siendo el mismo—, pero tiene que quedar en el log para que alguien lo mire.
  const descuadradas = noCuadran(trazas);
  if (descuadradas.length > 0) {
    console.error(
      "Panel: hay cifras cuyo detalle no suma su total:",
      descuadradas.map((t) => `${t.cifra} (muestra ${t.total})`).join(", "),
    );
  }

  let estado: Estado = "seguro";
  if (!reservaProtegida || disponibleReal < 0) {
    estado = "accion";
  } else if (!compromisosCubiertos || !datos.objetivosEnRitmo) {
    estado = "atencion";
  }

  return {
    moneda: datos.moneda,
    principal: datos.moneda === datos.principal,
    estado,
    sin_datos: movimientos.length === 0,
    disponible_real: redondear(disponibleReal),
    saldo_estimado: redondear(saldoEstimado),
    ingresos: redondear(ingresos),
    gastos: redondear(gastos),
    reserva_minima: redondear(reserva),
    ahorro_comprometido: redondear(ahorroComprometido),
    movimientos_registrados: movimientos.length,
    /*
     * El camino de cada cifra hasta lo que la compone.
     *
     * Va en la MISMA respuesta y no en un endpoint aparte a propósito: pedirlo
     * después obligaría a recalcular el panel entero para contestar "¿de dónde
     * sale este número?", y entre las dos corridas el saldo puede haber
     * cambiado. El detalle tiene que ser el de ESTE número, no el de uno
     * parecido calculado medio segundo más tarde.
     */
    trazas,
    /*
     * De dónde salió el saldo del que se parte.
     *
     * Va en la respuesta porque el panel tiene que poder decirlo: "según lo que
     * declaraste el 20 de agosto" y "desde tu primer movimiento" son dos
     * niveles de certeza muy distintos, y mostrar los dos como el mismo número
     * pelado es lo que hace que alguien confíe de más en el segundo.
     */
    punto_de_partida: {
      base: redondear(datos.partida.base),
      desde: datos.partida.desde,
      origen: datos.partida.origen,
    },
    cuentas: datos.cuentas.map((c) => ({
      nombre: c.nombre,
      tipo: c.tipo,
      saldo_declarado: c.saldo_declarado === null ? null : redondear(c.saldo_declarado),
      saldo_declarado_el: c.saldo_declarado_el,
    })),
    compromisos: {
      total: redondear(totalCompromisos),
      cantidad: anotados.length,
      cubiertos: compromisosCubiertos,
      proximo: anotados[0] ? { fecha: anotados[0].fecha, descripcion: anotados[0].descripcion } : null,
    },
    reserva_protegida: reservaProtegida,
    prevision: {
      // La línea que la doctrina pone al lado del disponible real, porque es
      // la que convierte un número en una respuesta.
      proximo_ingreso: ingresoEstimado
        ? {
            fecha: ingresoEstimado.fecha,
            monto: redondear(ingresoEstimado.monto),
            descripcion: ingresoEstimado.descripcion,
            confianza: ingresoEstimado.confianza,
          }
        : null,
      gastos_previsibles: {
        total: redondear(totalPrevisible),
        cantidad: previsibles.length,
        hasta: horizonte,
        detalle: previsibles.slice(0, 6).map((p) => ({
          fecha: p.fecha,
          descripcion: p.descripcion,
          monto: redondear(p.monto),
          periodicidad: p.periodicidad,
        })),
      },
      // Las cuotas van en su propia línea y no mezcladas con los gastos
      // previsibles: una cuota no es una deducción de EOS, es un compromiso
      // que el usuario ya firmó con un tercero y tiene fecha cierta.
      cuotas: {
        total: redondear(totalCuotas),
        cantidad: cuotas.length,
        detalle: cuotas.slice(0, 6).map((c) => ({
          fecha: c.fecha,
          descripcion: c.descripcion,
          monto: redondear(c.monto),
        })),
      },
      series_detectadas: panorama.detectadas.length,
      fijos_declarados: datos.fijos.length,
      // Declaraciones que la realidad ya confirmó por correo: la semilla
      // cumplió su función y se retiró sola.
      fijos_confirmados: confirmadosPorLaRealidad(panorama.detectadas, datos.fijos),
    },
    conciliacion: {
      confianza: estadoConciliacion.confianza,
      veces: estadoConciliacion.conciliaciones,
      dias_desde_ultima: estadoConciliacion.dias_desde_ultima,
      gasto_invisible: redondear(estadoConciliacion.gasto_invisible),
      // Ya aprendió el ritmo: puede descontar solo y no molestar más.
      aprendido: estadoConciliacion.ritmo_diario !== null,
      conviene_preguntar: convieneConciliar(estadoConciliacion),
    },
  };
}

/** El que ocurre antes. Cualquiera de los dos puede faltar. */
function primeroPorFecha(
  a: MovimientoProyectado | undefined,
  b: MovimientoProyectado | undefined,
): MovimientoProyectado | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.fecha <= b.fecha ? a : b;
}

function num(value: number | string | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sumar(items: { monto: number }[]) {
  return items.reduce((total, item) => total + item.monto, 0);
}

function redondear(value: number) {
  return Math.round(value * 100) / 100;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
