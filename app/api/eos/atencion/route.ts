import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { hoyEnParaguay } from "@/lib/fecha";
import {
  armarAtencion,
  DIAS_PARA_EVALUAR_DECISION,
  titularDeAtencion,
  type Entradas,
} from "@/lib/eos/atencion";
import { DIAS_ESTANCADA, ultimaActividadDe } from "@/lib/kpi/definiciones/crm";

export const dynamic = "force-dynamic";

/**
 * "EOS necesita de ti: Nada."
 *
 * ============================================================
 * QUÉ CONTESTA
 * ============================================================
 *
 * Una sola pregunta: ¿hay algo que EOS no pueda hacer hasta que la persona
 * intervenga? Casi siempre la respuesta es no, y la pantalla dice "Nada" — que
 * es lo que hace creíble el día que diga "2 decisiones".
 *
 * La regla de qué entra y qué no está en `lib/eos/atencion.ts`: solo lo que
 * BLOQUEA algo, y cada renglón tiene que poder decir qué se destraba al
 * resolverlo. Un pendiente que no completa esa frase no va.
 *
 * ============================================================
 * DE QUIÉN SON LOS DATOS QUE LEE
 * ============================================================
 *
 * Todas las consultas de acá son del usuario de la sesión y de nadie más:
 * `user.id` sale de `supabase.auth.getUser()` y se aplica como filtro en cada
 * una. `adminSinTipos()` usa la clave de servicio y SALTA RLS, así que ese
 * filtro escrito a mano es la única frontera que hay. No se acepta ningún id
 * por parámetro, a propósito.
 */

/** Nueve consultas es el techo: esto se abre al entrar, no cada vez que se habla. */
const TOPE = 50;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const db = adminSinTipos();
  const hoy = hoyEnParaguay();

  /*
   * Todo en paralelo. Son ocho lecturas chicas y ninguna depende de otra: en
   * serie, la pantalla tardaría ocho viajes a Supabase en aparecer.
   *
   * Si alguna falla, se sigue sin ese pedazo. Un centro de atención que no
   * abre porque no pudo contar los productos sin costo es peor que uno que
   * abre sin esa línea.
   */
  const [
    aprobaciones,
    fallidas,
    productos,
    cuentas,
    tarjetas,
    deudas,
    oportunidades,
    actividades,
    porCobrar,
    decisiones,
  ] = await Promise.all([
    db
      .from("eos_action_approvals_v12")
      .select("id", { count: "exact", head: true })
      .eq("usuario_id", user.id)
      .eq("estado", "pendiente"),
    db
      .from("eos_action_commands")
      // La columna es `error_message`: con el nombre en español la consulta
      // fallaba y el `?? []` de abajo lo escondía, así que las órdenes fallidas
      // nunca llegaban a este centro. Solo los últimos 7 días: un error de hace
      // un mes ya no es algo que mirar.
      .select("accion,error_message")
      .eq("usuario_id", user.id)
      .eq("estado", "error")
      .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10),
    db
      .from("eos_erp_productos")
      .select("costo,activo")
      .eq("usuario_id", user.id)
      .eq("activo", true)
      .limit(500),
    db
      .from("eos_finanzas_cuentas")
      .select("nombre,saldo_declarado,saldo_declarado_el")
      .eq("usuario_id", user.id)
      .eq("ambito", "personal")
      .eq("activa", true)
      .limit(TOPE),
    db
      .from("eos_finanzas_tarjetas")
      .select("nombre,emisor,dia_cierre,dia_vencimiento,resumen_al")
      .eq("usuario_id", user.id)
      .eq("ambito", "personal")
      .eq("activa", true)
      .limit(TOPE),
    db
      .from("eos_finanzas_deudas")
      .select("acreedor,cuota_monto,estado,saldo_declarado")
      .eq("usuario_id", user.id)
      .eq("ambito", "personal")
      .limit(TOPE),
    db
      .from("eos_crm_oportunidades")
      .select("id,monto,etapa,creado_en")
      .eq("usuario_id", user.id)
      .not("etapa", "in", "(ganada,perdida)")
      .limit(TOPE),
    // Para saber cuáles de esas oportunidades están estancadas: mismo
    // criterio que `lib/kpi/definiciones/crm.ts` (OPORTUNIDADES_ESTANCADAS).
    db
      .from("eos_crm_actividades")
      .select("oportunidad_id,hecha,fecha")
      .eq("usuario_id", user.id)
      .eq("hecha", true)
      .not("oportunidad_id", "is", null)
      .limit(TOPE * 4),
    db
      .from("eos_erp_ventas")
      .select("fecha,estado,movimiento_id")
      .eq("usuario_id", user.id)
      .is("movimiento_id", null)
      .not("estado", "in", "(anulada,cobrada)")
      .order("fecha")
      .limit(TOPE),
    db
      .from("eos_decisions")
      .select("fecha_decision,fecha_revision")
      .eq("usuario_id", user.id)
      .eq("estado", "activa")
      .eq("resultado_estado", "pendiente")
      .limit(TOPE),
  ]);

  // Una consulta que falla no puede parecer "no hay nada": queda en el log.
  for (const [nombre, r] of Object.entries({ fallidas, decisiones })) {
    if (r.error) console.error(`Atención: falló la consulta de ${nombre}:`, r.error.message);
  }

  const filasProductos = (productos.data ?? []) as { costo: number | null }[];

  const filasDeudas = (deudas.data ?? []) as {
    acreedor: string;
    cuota_monto: number | null;
    estado: string | null;
    saldo_declarado: number | null;
  }[];

  const filasVentas = (porCobrar.data ?? []) as { fecha: string }[];

  const filasOportunidades = (oportunidades.data ?? []) as {
    id: string;
    monto: number | null;
    creado_en: string;
  }[];

  const filasActividades = (actividades.data ?? []) as {
    oportunidad_id: string | null;
    hecha: boolean;
    fecha: string;
  }[];

  /*
   * Mismo criterio que `OPORTUNIDADES_ESTANCADAS`
   * (`lib/kpi/definiciones/crm.ts`): sin actividad hecha desde su creación,
   * o desde la última, hace más de `DIAS_ESTANCADA` días.
   */
  const diasSinActividad = filasOportunidades.map((o) => {
    const ultima = ultimaActividadDe(o.id, filasActividades) ?? o.creado_en;
    return diasDesde(ultima, hoy);
  });
  const estancadas = diasSinActividad.filter((dias) => dias > DIAS_ESTANCADA);

  // Días desde que se decidió, de las que ya es hora de evaluar: pasó su fecha de
  // revisión, o no tiene ninguna y lleva más del plazo por defecto.
  const decisionesVencidas = ((decisiones.data ?? []) as { fecha_decision: string | null; fecha_revision: string | null }[])
    .filter((d) =>
      d.fecha_revision
        ? d.fecha_revision.slice(0, 10) <= hoy
        : d.fecha_decision !== null && diasDesde(d.fecha_decision, hoy) > DIAS_PARA_EVALUAR_DECISION,
    )
    .map((d) => diasDesde(d.fecha_decision ?? d.fecha_revision ?? hoy, hoy));

  const entradas: Entradas = {
    hoy,
    aprobacionesPendientes: aprobaciones.count ?? 0,
    accionesFallidas: ((fallidas.data ?? []) as { accion: string; error_message: string | null }[]).map(
      (f) => ({ accion: f.accion, motivo: f.error_message }),
    ),
    productosSinCosto: filasProductos.filter((p) => p.costo === null || Number(p.costo) === 0).length,
    productosTotales: filasProductos.length,
    cuentas: ((cuentas.data ?? []) as {
      nombre: string;
      saldo_declarado: number | null;
      saldo_declarado_el: string | null;
    }[]).map((c) => ({
      nombre: c.nombre,
      saldo: c.saldo_declarado === null ? null : Number(c.saldo_declarado),
      al: c.saldo_declarado_el,
    })),
    tarjetas: ((tarjetas.data ?? []) as {
      nombre: string | null;
      emisor: string;
      dia_cierre: number | null;
      dia_vencimiento: number | null;
      resumen_al: string | null;
    }[]).map((t) => ({
      nombre: t.nombre || t.emisor,
      cierra: t.dia_cierre,
      vence: t.dia_vencimiento,
      resumenAl: t.resumen_al,
    })),
    /*
     * Solo las que todavía se deben. Una deuda saldada sin cuota declarada no
     * es un pendiente: ya no hay nada que ordenar.
     */
    deudasSinCuota: filasDeudas
      .filter(
        (d) =>
          (d.cuota_monto === null || Number(d.cuota_monto) === 0) &&
          (d.estado ?? "al_dia") !== "saldada" &&
          Number(d.saldo_declarado ?? 0) > 0,
      )
      .map((d) => ({ acreedor: d.acreedor })),
    oportunidadesSinMonto: filasOportunidades.filter(
      (o) => o.monto === null || Number(o.monto) === 0,
    ).length,
    oportunidadesEstancadas:
      estancadas.length > 0
        ? { cantidad: estancadas.length, masDiasSinActividad: Math.max(...estancadas) }
        : null,
    decisionesSinResultado:
      decisionesVencidas.length > 0
        ? { cantidad: decisionesVencidas.length, masDias: Math.max(...decisionesVencidas) }
        : null,
    porCobrarViejo:
      filasVentas.length > 0
        ? {
            cuantas: filasVentas.length,
            // La lista viene ordenada por fecha, así que la primera es la más
            // vieja: es la que le da sentido al aviso.
            masViejaEnDias: diasDesde(filasVentas[0].fecha, hoy),
          }
        : null,
  };

  const pendientes = armarAtencion(entradas);

  return NextResponse.json(
    {
      titular: titularDeAtencion(pendientes),
      pendientes,
      // Para que la pantalla pueda decir "revisado hace un rato" sin volver a
      // preguntar, y para que se note si esto se quedó cacheado.
      calculado_en: new Date().toISOString(),
    },
    { headers: noStore() },
  );
}

/** Sin `new Date` sobre la fecha: en zona PY corre un día. */
function diasDesde(iso: string, hoy: string): number {
  const [a1, m1, d1] = iso.slice(0, 10).split("-").map(Number);
  const [a2, m2, d2] = hoy.slice(0, 10).split("-").map(Number);
  if (!a1 || !a2) return 0;
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
