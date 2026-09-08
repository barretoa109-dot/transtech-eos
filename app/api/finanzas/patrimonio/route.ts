import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay } from "@/lib/fecha";
import { armarPatrimonio, type Patrimonio } from "@/lib/finanzas/patrimonio";
import { codigoMoneda } from "@/lib/finanzas/monedas";
import { exigirModulo } from "@/lib/modulos/acceso";

export const dynamic = "force-dynamic";

/**
 * Patrimonio personal: lo que tiene menos lo que debe.
 *
 * ============================================================
 * TRES FUENTES, TODAS DECLARADAS
 * ============================================================
 *
 *   · Cuentas   — `eos_finanzas_cuentas`, el saldo que declaró y cuándo.
 *   · Bienes    — `eos_finanzas_activos` (v145): la casa, el auto, una
 *                 inversión. Lo que tiene y no es plata.
 *   · Deudas    — `eos_finanzas_deudas`, el saldo declarado de cada una.
 *
 * EOS no ve saldos bancarios ni tasa inmuebles. Cada línea es lo que la
 * persona dijo el día que lo dijo, y la fecha viaja con el número.
 *
 * ============================================================
 * POR QUÉ HACE FALTA SABER SI SE LE PREGUNTÓ POR LAS DEUDAS
 * ============================================================
 *
 * Una lista de deudas vacía es ambigua: puede querer decir "no debo nada" o
 * "todavía no lo cargué". Del primer caso sale un patrimonio; del segundo, un
 * número inflado con nombre de neto.
 *
 * El onboarding tiene un paso de deudas. Si la persona ya lo pasó, el vacío
 * significa cero. Si no, `armarPatrimonio` devuelve `neto: null` y dice por
 * qué, que es lo único honesto que se puede hacer con esa duda.
 */

/** Los pasos del onboarding, en orden. Después de `deudas` ya se preguntó. */
const PASOS = [
  "bienvenida",
  "cuentas",
  "ingresos",
  "gastos_fijos",
  "deudas",
  "preocupaciones",
  "correo",
  "cierre",
  "completado",
];

const MAX_BIENES = 30;
const MAXIMO_RAZONABLE = 999_999_999_999_999;
const TIPOS = ["inmueble", "vehiculo", "inversion", "participacion", "otro"];

export async function GET() {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;
  const hoy = hoyEnParaguay();

  const [politicaRes, cuentasRes, bienesRes, deudasRes, onboardingRes] = await Promise.all([
    supabase
      .from("eos_finanzas_politica")
      .select("moneda")
      .eq("usuario_id", usuarioId)
      .maybeSingle(),
    supabase
      .from("eos_finanzas_cuentas")
      .select("nombre,tipo,moneda,saldo_declarado,saldo_declarado_el")
      .eq("ambito", "personal")
      .eq("usuario_id", usuarioId)
      .eq("activa", true),
    supabase
      .from("eos_finanzas_activos")
      .select("id,nombre,tipo,moneda,valor_declarado,valor_declarado_el,notas")
      .eq("ambito", "personal")
      .eq("usuario_id", usuarioId)
      .eq("activo", true)
      .order("valor_declarado", { ascending: false }),
    supabase
      .from("eos_finanzas_deudas")
      .select("acreedor,tipo,moneda,saldo_declarado,saldo_declarado_el")
      .eq("ambito", "personal")
      .eq("usuario_id", usuarioId)
      .neq("estado", "saldada"),
    supabase.from("eos_onboarding").select("paso").eq("usuario_id", usuarioId).maybeSingle(),
  ]);

  const politica = politicaRes.data;
  if (!politica) {
    return NextResponse.json({ configurado: false }, { headers: noStore() });
  }

  const principal = codigoMoneda(politica.moneda, "PYG");

  const cuentas = filas(cuentasRes.data).map((c) => ({
    nombre: (c.nombre as string) ?? "",
    tipo: (c.tipo as string) ?? "banco",
    moneda: codigoMoneda(c.moneda as string | null, principal),
    saldo: c.saldo_declarado === null ? null : num(c.saldo_declarado),
    declarado_el: (c.saldo_declarado_el as string | null) ?? null,
  }));

  const bienes = filas(bienesRes.data).map((b) => ({
    id: b.id as string,
    nombre: (b.nombre as string) ?? "",
    tipo: (b.tipo as string) ?? "otro",
    moneda: codigoMoneda(b.moneda as string | null, principal),
    valor: num(b.valor_declarado),
    declarado_el: (b.valor_declarado_el as string | null) ?? null,
    notas: (b.notas as string | null) ?? null,
  }));

  const deudas = filas(deudasRes.data).map((d) => ({
    acreedor: (d.acreedor as string) ?? "",
    tipo: (d.tipo as string) ?? "otro",
    moneda: codigoMoneda(d.moneda as string | null, principal),
    saldo: num(d.saldo_declarado),
    declarado_el: (d.saldo_declarado_el as string | null) ?? null,
  }));

  const paso = (onboardingRes.data?.paso as string | null) ?? null;
  const indice = paso === null ? -1 : PASOS.indexOf(paso);
  const pasivosConfirmados = indice > PASOS.indexOf("deudas");

  // Una moneda a la vez, sin convertir ni sumar entre ellas. La principal va
  // primera aunque no tenga nada, porque es la que la persona espera ver.
  const monedas = [
    principal,
    ...new Set([...cuentas, ...bienes, ...deudas].map((x) => x.moneda).filter((m) => m !== principal)),
  ];

  const patrimonios: Patrimonio[] = monedas.map((moneda) =>
    armarPatrimonio({
      moneda,
      hoy,
      cuentas: cuentas.filter((c) => c.moneda === moneda),
      bienes: bienes.filter((b) => b.moneda === moneda),
      deudas: deudas.filter((d) => d.moneda === moneda),
      pasivosConfirmados,
    }),
  );

  return NextResponse.json(
    { configurado: true, moneda: principal, patrimonios, bienes },
    { headers: noStore() },
  );
}

/**
 * Reemplaza la lista de bienes.
 *
 * Mismo criterio que las cuentas y los fijos: la persona piensa "estas son mis
 * cosas", no "quiero editar la número 3". El borrado va acotado al ámbito
 * personal, para no llevarse por delante los del negocio.
 */
export async function PUT(request: Request) {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;

  let body: { bienes?: unknown };
  try {
    body = (await request.json()) as { bienes?: unknown };
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  if (!Array.isArray(body.bienes)) {
    return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: noStore() });
  }

  if (body.bienes.length > MAX_BIENES) {
    return NextResponse.json(
      { error: `Son demasiados (máximo ${MAX_BIENES}).` },
      { status: 400, headers: noStore() },
    );
  }

  const hoy = hoyEnParaguay();
  const limpios = [];

  for (const crudo of body.bienes as Record<string, unknown>[]) {
    const nombre = typeof crudo.nombre === "string" ? crudo.nombre.trim() : "";
    const tipo = typeof crudo.tipo === "string" && TIPOS.includes(crudo.tipo) ? crudo.tipo : null;
    const valor = Number(crudo.valor_declarado);

    // Los renglones vacíos se saltean, como en cuentas y fijos: la pantalla
    // los permite y no tiene sentido devolver un error por una fila que la
    // persona no llenó.
    if (!tipo || nombre.length < 2) continue;
    if (!Number.isFinite(valor) || valor < 0 || valor > MAXIMO_RAZONABLE) continue;

    limpios.push({
      usuario_id: usuarioId,
      ambito: "personal",
      nombre: nombre.slice(0, 80),
      tipo,
      moneda: crudo.moneda === "USD" ? "USD" : "PYG",
      valor_declarado: Math.round(valor * 100) / 100,
      /*
       * La fecha de hoy solo cuando el valor cambió.
       *
       * Guardar la lista sin tocar nada no vuelve nuevo un valor de marzo, y
       * si la refrescara, el patrimonio parecería recién actualizado cuando no
       * lo está. Esa fecha es justamente lo que dice cuánto confiar en él.
       */
      valor_declarado_el: fechaDelValor(crudo, valor, hoy),
      notas: typeof crudo.notas === "string" ? crudo.notas.trim().slice(0, 200) || null : null,
      activo: true,
    });
  }

  const { error: borradoError } = await supabase
    .from("eos_finanzas_activos")
    .delete()
    .eq("ambito", "personal")
    .eq("usuario_id", usuarioId);

  if (borradoError) {
    console.error("No se pudieron reemplazar los bienes:", borradoError);
    return NextResponse.json(
      { error: "No pudimos guardar tus bienes." },
      { status: 500, headers: noStore() },
    );
  }

  if (limpios.length > 0) {
    const { error } = await supabase.from("eos_finanzas_activos").insert(limpios);

    if (error) {
      console.error("No se pudieron guardar los bienes:", error);
      return NextResponse.json(
        { error: "No pudimos guardar tus bienes." },
        { status: 500, headers: noStore() },
      );
    }
  }

  return NextResponse.json({ ok: true, guardados: limpios.length }, { headers: noStore() });
}

/** La fecha del valor: la que ya tenía si no cambió, hoy si cambió. */
function fechaDelValor(crudo: Record<string, unknown>, valor: number, hoy: string): string {
  const anterior = Number(crudo.valor_anterior);
  const fecha = crudo.valor_declarado_el;

  const sigueIgual = Number.isFinite(anterior) && Math.abs(anterior - valor) < 0.005;
  const fechaValida = typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha);

  return sigueIgual && fechaValida ? fecha : hoy;
}

function filas(data: unknown): Record<string, unknown>[] {
  return (data ?? []) as Record<string, unknown>[];
}

function num(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
