import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { miEmpresa } from "@/lib/empresa/acceso";
import { saldoDeHoy, type Caja, type MovimientoCaja } from "@/lib/empresa/caja";
import { hoyEnParaguay } from "@/lib/fecha";
import { monedaConocida } from "@/lib/finanzas/monedas";

export const dynamic = "force-dynamic";

/**
 * Las cajas del negocio: dónde tiene la plata y cuánta.
 *
 * ============================================================
 * VA CON EL CLIENTE DE SESIÓN, NO CON `adminSinTipos()`
 * ============================================================
 *
 * Acá la RLS sí está activa, y la policy de la v120 es solo por empresa. Eso
 * significa que la frontera la pone la base y esta ruta no tiene que filtrar
 * nada a mano — que es exactamente donde se cuelan los errores en las rutas
 * que usan `service_role`.
 *
 * `eos_mi_empresa_v109()` resuelve sola quién pregunta, así que tampoco hay
 * forma de pedir la caja de otro por error.
 */

const TIPOS = new Set(["efectivo", "banco", "cooperativa", "financiera", "billetera"]);

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

function textoCorto(valor: unknown, max = 80): string {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}

/** Solo `AAAA-MM-DD`. Cualquier otra cosa se rechaza en vez de adivinarse. */
function fechaValida(valor: unknown): string | null {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
}

/**
 * El monto tal como lo escribe alguien en Paraguay.
 *
 * Se acepta número o texto: el punto es de miles y la coma es decimal, al
 * revés que en inglés. Confundirlos no da un error chico, da uno de mil veces.
 */
function montoValido(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;

  const limpio = valor.trim().replace(/\./g, "").replace(",", ".");
  if (limpio === "") return null;

  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const empresaId = await miEmpresa(supabase);

  if (empresaId === null) {
    return NextResponse.json(
      { error: "Todavía no tenés una empresa activa." },
      { status: 409, headers: noStore() },
    );
  }

  const hoy = hoyEnParaguay();

  const [cajasRes, movRes] = await Promise.all([
    supabase
      .from("eos_empresa_cajas_v120")
      .select("id,nombre,tipo,moneda,saldo_declarado,saldo_declarado_el,activa")
      .order("creado_en", { ascending: true }),
    /*
     * Los cobros y pagos que EOS vio. La dirección sale de qué documento
     * cuelga: una venta cobrada entra, una compra pagada sale. La RLS ya
     * limita esto a la empresa.
     */
    supabase
      .from("eos_erp_cuenta_movimientos_v107")
      .select("fecha,monto,moneda,venta_id")
      .order("fecha", { ascending: true })
      .limit(5000),
  ]);

  if (cajasRes.error) {
    console.error("Cajas: no se pudieron leer:", cajasRes.error);
    return NextResponse.json(
      { error: "No pudimos leer tus cajas." },
      { status: 503, headers: noStore() },
    );
  }

  if (movRes.error) {
    // Sin los movimientos el saldo saldría igual al declarado, o sea viejo.
    // Mejor no responder que responder un saldo que se quedó en el pasado.
    console.error("Cajas: no se pudieron leer los movimientos:", movRes.error);
    return NextResponse.json(
      { error: "No pudimos calcular tus saldos." },
      { status: 503, headers: noStore() },
    );
  }

  const cajas: Caja[] = (cajasRes.data ?? []).map((c: Record<string, unknown>) => ({
    id: String(c.id),
    nombre: String(c.nombre),
    tipo: String(c.tipo),
    moneda: monedaConocida(c.moneda as string | null),
    saldo_declarado: c.saldo_declarado === null ? null : Number(c.saldo_declarado),
    saldo_declarado_el: (c.saldo_declarado_el as string | null) ?? null,
    activa: c.activa === true,
  }));

  const movimientos: MovimientoCaja[] = (movRes.data ?? []).map((m: Record<string, unknown>) => ({
    fecha: String(m.fecha),
    moneda: monedaConocida(m.moneda as string | null),
    monto: (m.venta_id ? 1 : -1) * Number(m.monto ?? 0),
  }));

  return NextResponse.json(
    { hoy, cajas, saldos: saldoDeHoy(cajas, movimientos, hoy) },
    { headers: noStore() },
  );
}

export async function POST(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const empresaId = await miEmpresa(supabase);

  if (empresaId === null) {
    return NextResponse.json(
      { error: "Todavía no tenés una empresa activa." },
      { status: 409, headers: noStore() },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const nombre = textoCorto(body?.nombre);
  const tipo = textoCorto(body?.tipo) || "efectivo";

  if (!nombre) {
    return NextResponse.json(
      { error: "Poné un nombre para reconocerla." },
      { status: 400, headers: noStore() },
    );
  }
  if (!TIPOS.has(tipo)) {
    return NextResponse.json({ error: "Ese tipo no existe." }, { status: 400, headers: noStore() });
  }

  const saldo = montoValido(body?.saldo_declarado);
  const fecha = fechaValida(body?.saldo_declarado_el);
  const hoy = hoyEnParaguay();

  /*
   * O van los dos o no va ninguno. Un saldo sin fecha no se puede arrastrar y
   * envejece sin avisar; la base lo rechaza igual, pero acá el mensaje puede
   * decir qué falta en vez de devolver un error de constraint.
   */
  if (saldo !== null && fecha === null) {
    return NextResponse.json(
      { error: "Falta desde cuándo vale ese saldo." },
      { status: 400, headers: noStore() },
    );
  }
  if (fecha !== null && fecha > hoy) {
    return NextResponse.json(
      { error: "La fecha del saldo no puede ser futura." },
      { status: 400, headers: noStore() },
    );
  }

  const { data, error } = await supabase
    .from("eos_empresa_cajas_v120")
    .insert({
      empresa_id: empresaId,
      nombre,
      tipo,
      moneda: monedaConocida(textoCorto(body?.moneda, 3) || null),
      saldo_declarado: saldo,
      saldo_declarado_el: saldo === null ? null : fecha,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Cajas: no se pudo crear:", error);
    return NextResponse.json(
      { error: "No pudimos crear la caja." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json({ id: data.id }, { headers: noStore() });
}

/** Actualizar el saldo declarado, o cerrar la caja. */
export async function PATCH(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = textoCorto(body?.id, 40);

  if (!id) {
    return NextResponse.json({ error: "Falta la caja." }, { status: 400, headers: noStore() });
  }

  const cambios: Record<string, unknown> = {};

  if ("activa" in (body ?? {})) cambios.activa = body?.activa === true;

  if ("saldo_declarado" in (body ?? {})) {
    const saldo = montoValido(body?.saldo_declarado);
    const fecha = fechaValida(body?.saldo_declarado_el) ?? hoyEnParaguay();

    if (saldo === null) {
      return NextResponse.json(
        { error: "Ese monto no se entiende." },
        { status: 400, headers: noStore() },
      );
    }
    if (fecha > hoyEnParaguay()) {
      return NextResponse.json(
        { error: "La fecha del saldo no puede ser futura." },
        { status: 400, headers: noStore() },
      );
    }

    cambios.saldo_declarado = saldo;
    cambios.saldo_declarado_el = fecha;
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No hay nada que cambiar." }, { status: 400, headers: noStore() });
  }

  // Sin filtro por empresa a mano: la RLS ya impide tocar la de otro.
  const { error } = await supabase.from("eos_empresa_cajas_v120").update(cambios).eq("id", id);

  if (error) {
    console.error("Cajas: no se pudo actualizar:", error);
    return NextResponse.json(
      { error: "No pudimos guardar el cambio." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}
