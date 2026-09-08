import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { leerTarjetas } from "@/lib/finanzas/leerTarjetas";
import { tarjetasRepetidasEnDeudas } from "@/lib/finanzas/tarjetas";
import { codigoMoneda } from "@/lib/finanzas/monedas";
import { exigirModulo } from "@/lib/modulos/acceso";

export const dynamic = "force-dynamic";

/**
 * Las tarjetas de la persona: el ciclo, lo que debe y lo que viene.
 *
 * ============================================================
 * ESTA RUTA NO PROYECTA NADA POR SU CUENTA
 * ============================================================
 *
 * Todo sale de `leerTarjetas`, el mismo módulo que alimenta el panel, el
 * calendario, el presupuesto y las dos alertas. Si esta pantalla calculara lo
 * suyo, un día mostraría una obligación distinta de la que el calendario pone
 * en la línea de tiempo, y las dos parecerían correctas.
 *
 * ============================================================
 * LO ÚNICO PROPIO ES EL AVISO DE DUPLICADO
 * ============================================================
 *
 * Antes de la v146 una tarjeta se cargaba como deuda de tipo `tarjeta`. Quien
 * ya lo hizo y ahora la carga acá tendría la obligación contada dos veces.
 * `armarPanorama` la descuenta una sola —pasa por `sinDuplicar`—, pero la
 * pantalla igual lo dice: que el sistema lo resuelva no significa que la
 * persona no deba enterarse de que tiene lo mismo cargado dos veces.
 */

/** Hasta dónde se proyectan los vencimientos que ve esta pantalla. */
const HORIZONTE_DIAS = 180;

const MAX_TARJETAS = 10;
const MAX_COMPRAS = 40;
const MAXIMO_RAZONABLE = 999_999_999_999;

export async function GET() {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;
  const hoy = hoyEnParaguay();

  const [politicaRes, deudasRes, lectura] = await Promise.all([
    supabase
      .from("eos_finanzas_politica")
      .select("moneda")
      .eq("usuario_id", usuarioId)
      .maybeSingle(),
    supabase
      .from("eos_finanzas_deudas")
      .select("acreedor,tipo")
      .eq("ambito", "personal")
      .eq("usuario_id", usuarioId)
      .neq("estado", "saldada"),
    leerTarjetas(supabase, usuarioId, { desde: hoy, hasta: sumarDias(hoy, HORIZONTE_DIAS) }),
  ]);

  const principal = codigoMoneda(politicaRes.data?.moneda ?? null, "PYG");

  return NextResponse.json(
    {
      configurado: politicaRes.data !== null,
      moneda: principal,
      tarjetas: lectura.tarjetas,
      proximas: lectura.obligaciones.slice(0, 6),
      repetidas: tarjetasRepetidasEnDeudas(
        lectura.tarjetas,
        (deudasRes.data ?? []) as { acreedor: string; tipo: string }[],
      ),
    },
    { headers: noStore() },
  );
}

/**
 * Reemplaza las tarjetas y sus compras.
 *
 * Mismo criterio que cuentas, fijos y bienes: la persona piensa "estas son mis
 * tarjetas". Las compras se borran por cascada al borrar la tarjeta y se
 * vuelven a insertar con el id nuevo.
 */
export async function PUT(request: Request) {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;

  let body: { tarjetas?: unknown };
  try {
    body = (await request.json()) as { tarjetas?: unknown };
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  if (!Array.isArray(body.tarjetas)) {
    return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: noStore() });
  }

  if (body.tarjetas.length > MAX_TARJETAS) {
    return NextResponse.json(
      { error: `Son demasiadas (máximo ${MAX_TARJETAS}).` },
      { status: 400, headers: noStore() },
    );
  }

  const hoy = hoyEnParaguay();
  const limpias: { fila: Record<string, unknown>; compras: Record<string, unknown>[] }[] = [];

  for (const cruda of body.tarjetas as Record<string, unknown>[]) {
    const emisor = texto(cruda.emisor, 80);
    if (emisor.length < 2) continue;

    const linea = opcional(cruda.linea_total);
    const saldo = opcional(cruda.saldo_utilizado);
    const total = opcional(cruda.pago_total);
    const minimo = opcional(cruda.pago_minimo);

    // El mínimo por encima del total es un error de tipeo, y la base lo
    // rechazaría con un mensaje que nadie entiende. Se descarta el mínimo y la
    // tarjeta se guarda igual: perder la tarjeta entera por un campo sería peor.
    const minimoSano = minimo !== null && total !== null && minimo > total ? null : minimo;

    const fila: Record<string, unknown> = {
      usuario_id: usuarioId,
      ambito: "personal",
      emisor,
      nombre: texto(cruda.nombre, 60) || null,
      moneda: cruda.moneda === "USD" ? "USD" : "PYG",
      linea_total: linea,
      saldo_utilizado: saldo,
      // La base exige fecha si hay saldo, y con razón: un saldo sin fecha no se
      // puede interpretar dos meses después.
      saldo_al: saldo === null ? null : fechaOHoy(cruda.saldo_al, cruda.saldo_anterior, saldo, hoy),
      dia_cierre: dia(cruda.dia_cierre),
      dia_vencimiento: dia(cruda.dia_vencimiento),
      pago_minimo: minimoSano,
      pago_total: total,
      resumen_al: minimoSano === null && total === null ? null : fecha(cruda.resumen_al) ?? hoy,
      activa: true,
    };

    const compras: Record<string, unknown>[] = [];

    for (const c of (Array.isArray(cruda.compras) ? cruda.compras : []) as Record<string, unknown>[]) {
      if (compras.length >= MAX_COMPRAS) break;

      const descripcion = texto(c.descripcion, 100);
      const cuota = opcional(c.monto_cuota);
      const totales = Number(c.cuotas_totales);

      if (descripcion.length < 2 || cuota === null || cuota <= 0) continue;
      if (!Number.isFinite(totales) || totales < 1 || totales > 120) continue;

      const pagadas = Number(c.cuotas_pagadas);

      compras.push({
        usuario_id: usuarioId,
        descripcion,
        moneda: fila.moneda,
        monto_total: opcional(c.monto_total),
        monto_cuota: cuota,
        cuotas_totales: Math.round(totales),
        cuotas_pagadas: Number.isFinite(pagadas)
          ? Math.min(Math.max(0, Math.round(pagadas)), Math.round(totales))
          : 0,
        primera_cuota: fecha(c.primera_cuota) ?? hoy,
      });
    }

    limpias.push({ fila, compras });
  }

  const { error: borradoError } = await supabase
    .from("eos_finanzas_tarjetas")
    .delete()
    .eq("ambito", "personal")
    .eq("usuario_id", usuarioId);

  if (borradoError) {
    console.error("No se pudieron reemplazar las tarjetas:", borradoError);
    return NextResponse.json(
      { error: "No pudimos guardar tus tarjetas." },
      { status: 500, headers: noStore() },
    );
  }

  for (const { fila, compras } of limpias) {
    const { data, error } = await supabase
      .from("eos_finanzas_tarjetas")
      .insert(fila)
      .select("id")
      .single();

    if (error || !data) {
      console.error("No se pudo guardar una tarjeta:", error);
      return NextResponse.json(
        { error: "No pudimos guardar tus tarjetas." },
        { status: 500, headers: noStore() },
      );
    }

    if (compras.length > 0) {
      const { error: errorCompras } = await supabase
        .from("eos_finanzas_tarjeta_compras")
        .insert(compras.map((c) => ({ ...c, tarjeta_id: data.id })));

      if (errorCompras) {
        console.error("No se pudieron guardar las compras:", errorCompras);
        return NextResponse.json(
          { error: "Guardamos la tarjeta pero no sus compras en cuotas." },
          { status: 500, headers: noStore() },
        );
      }
    }
  }

  return NextResponse.json({ ok: true, guardadas: limpias.length }, { headers: noStore() });
}

function texto(valor: unknown, max: number): string {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}

/** Un monto, o `null` cuando la persona no lo sabe. Nunca cero por defecto. */
function opcional(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > MAXIMO_RAZONABLE) return null;
  return Math.round(n * 100) / 100;
}

function dia(valor: unknown): number | null {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 1 || n > 31) return null;
  return Math.round(n);
}

function fecha(valor: unknown): string | null {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
}

/**
 * La fecha del saldo: la que ya tenía si no cambió, hoy si cambió.
 *
 * Refrescarla en cada guardado haría que un saldo de marzo parezca de hoy, y
 * esa fecha es justamente lo que dice cuánto confiar en él.
 */
function fechaOHoy(anterior: unknown, saldoAnterior: unknown, saldo: number, hoy: string): string {
  const previo = Number(saldoAnterior);
  const sigueIgual = Number.isFinite(previo) && Math.abs(previo - saldo) < 0.005;
  const fechaPrevia = fecha(anterior);

  return sigueIgual && fechaPrevia !== null ? fechaPrevia : hoy;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
