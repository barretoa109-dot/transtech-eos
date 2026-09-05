import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { exigirModulo, verificarModulo } from "@/lib/modulos/acceso";
import { leerHechos } from "@/lib/kpi/leer";
import { empresaDe, saldosDeCaja } from "@/lib/empresa/acceso";
import { saldosParaPronostico } from "@/lib/empresa/caja";
import { definicion } from "@/lib/kpi/registro";
import { hoyEnParaguay } from "@/lib/fecha";
import { primerDiaEnRojo, proyectarCaja } from "@/lib/pronostico/caja";
import { escenariosSugeridos } from "@/lib/pronostico/escenario";
import { esProyeccion, fechaProyectada, proyectar } from "@/lib/pronostico/tendencia";
import type { PuntoHistoria } from "@/lib/kpi/historia";

export const dynamic = "force-dynamic";

/**
 * Lo que viene: la caja a 30/60/90 y la proyección de un indicador.
 *
 * Sin parámetros devuelve el pronóstico de caja con sus escenarios. Con
 * `?indicador=ventas_netas&moneda=PYG&dias=30` devuelve la proyección de ese
 * indicador sobre su propia historia.
 *
 * Son dos cosas distintas a propósito y no se mezclan en una sola respuesta:
 * la caja se arma con documentos que ya existen —tiene fecha y monto— y la
 * del indicador es una recta ajustada. Presentarlas juntas, con el mismo
 * aspecto, haría que una estimación estadística se lea como una factura.
 */

const MAX_DIAS_HISTORIA = 180;
const MAX_HORIZONTE = 90;

function sumarDias(fecha: string, n: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  // El pronóstico se arma sobre ventas y compras: es del negocio.
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });
  }

  const { searchParams } = new URL(request.url);
  const indicador = (searchParams.get("indicador") ?? "").trim();
  const hoy = hoyEnParaguay();

  if (indicador) return proyeccionDeIndicador(user.id, indicador, searchParams, hoy);

  // ------------------------------------------------------------------
  // El pronóstico de caja
  // ------------------------------------------------------------------

  const crm = await verificarModulo("crm");
  const admin = adminSinTipos();

  /*
   * El rango que se pide es el mes en curso, pero `leerHechos` NO filtra
   * ventas ni compras por fecha —a propósito, para que la cartera vieja no
   * desaparezca de la lectura— y eso es justamente lo que este pronóstico
   * necesita: una factura emitida en junio que vence en octubre tiene que
   * entrar. Leer por la misma función que el tablero garantiza además que las
   * dos pantallas vean lo mismo.
   */
  const rango = { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  const hechos = await leerHechos(admin, user.id, rango, { erp: true, crm: crm.permitido });

  /*
   * El saldo de caja (v120) es lo que convierte un pronóstico de FLUJO en un
   * pronóstico de SALDO: sin él no se puede decir qué día se cae la caja.
   *
   * `saldosParaPronostico` solo devuelve las monedas donde algo se declaró,
   * así que un cero nunca se confunde con un "no se sabe" — y el pronóstico
   * sigue diciendo "no se conoce el disponible" para las que faltan.
   */
  const empresaId = await empresaDe(admin, user.id);
  const caja = await saldosDeCaja(admin, empresaId, hoy);

  const entrada = {
    ventas: hechos.ventas ?? [],
    compras: hechos.compras ?? [],
    fijos: hechos.fijos ?? [],
    hoy,
    saldos: saldosParaPronostico(caja),
  };

  const proyeccion = proyectarCaja(entrada);

  return NextResponse.json(
    {
      hoy,
      monedas: proyeccion.map((p) => ({
        ...p,
        // Se calcula acá y no en la pantalla: si cada pantalla lo recalcula,
        // un día una va a decir un día distinto que la otra.
        rojo: primerDiaEnRojo(p),
      })),
      escenarios: escenariosSugeridos(entrada),
      caja,
    },
    { headers: noStore() },
  );
}

/**
 * La proyección de un indicador sobre su historia diaria.
 *
 * Cuando no se puede, se devuelve 200 con el motivo y no un error: "hacen
 * falta catorce días y hay nueve" es una respuesta correcta a la pregunta, y
 * mandarla como 4xx haría que la pantalla la trate como una falla.
 */
async function proyeccionDeIndicador(
  usuarioId: string,
  indicador: string,
  params: URLSearchParams,
  hoy: string,
) {
  const def = definicion(indicador);
  if (!def) {
    return NextResponse.json({ error: "Ese indicador no existe." }, { status: 404, headers: noStore() });
  }

  const moneda = (params.get("moneda") ?? "PYG").trim().toUpperCase();

  const pedido = Number(params.get("dias") ?? 30);
  const horizonte = Number.isFinite(pedido)
    ? Math.min(Math.max(Math.trunc(pedido), 1), MAX_HORIZONTE)
    : 30;

  const desde = sumarDias(hoy, -MAX_DIAS_HISTORIA);

  // service_role no pasa por RLS: el filtro por usuario va a mano y es el que
  // no se puede olvidar.
  const { data, error } = await adminSinTipos()
    .from("eos_kpi_historia_v105")
    .select("fecha,valor,confianza,motivo")
    .eq("usuario_id", usuarioId)
    .eq("indicador", indicador)
    .eq("moneda", moneda)
    .gte("fecha", desde)
    .lte("fecha", hoy)
    .order("fecha", { ascending: true });

  if (error) {
    console.error("Pronóstico: no se pudo leer la historia:", error);
    return NextResponse.json(
      { error: "No pudimos leer la historia de este indicador." },
      { status: 503, headers: noStore() },
    );
  }

  const puntos: PuntoHistoria[] = (data ?? []).map((f: Record<string, unknown>) => ({
    fecha: String(f.fecha),
    valor: f.valor === null || f.valor === undefined ? null : Number(f.valor),
    confianza: Number(f.confianza ?? 0),
    motivo: (f.motivo as string | null) ?? null,
  }));

  const resultado = proyectar({
    indicador,
    moneda,
    unidad: def.unidad,
    puntos,
    horizonte,
  });

  return NextResponse.json(
    {
      indicador,
      nombre: def.nombre,
      unidad: def.unidad,
      moneda,
      hasta: fechaProyectada(puntos, horizonte),
      // El día del último dato viaja siempre: una proyección hecha sobre una
      // serie que se cortó hace dos semanas no es la misma que una al día, y
      // desde el número solo no hay forma de notarlo.
      ultimo_dato: puntos.filter((p) => p.valor !== null).at(-1)?.fecha ?? null,
      ...(esProyeccion(resultado) ? { proyeccion: resultado } : { no_se_puede: resultado.no_se_puede, puntos: resultado.puntos }),
    },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
