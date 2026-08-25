import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { registrarAuditoria, resumirMovimiento } from "@/lib/auditoria/registrar";
import { hoyEnParaguay } from "@/lib/fecha";
import { confirmar, interpretar } from "@/lib/finanzas/gastoRapido";

export const dynamic = "force-dynamic";

/**
 * El efectivo, en una línea.
 *
 * La única entrada manual que la doctrina permite: "entrada mínima por
 * excepción, nunca como flujo principal". Todo el diseño de esta ruta apunta a
 * que cueste lo mínimo posible.
 *
 * **No pide confirmación a propósito.** Un paso de "¿es correcto?" duplica la
 * fricción de la única vía que existe para tapar el punto ciego del efectivo, y
 * una vía que no se usa es igual a no tenerla. A cambio, la respuesta devuelve
 * lo que EOS entendió —"Salió ₲ 50.000 — nafta"— para que un error de lectura
 * se vea en el momento, cuando el usuario todavía se acuerda de cuánto gastó.
 *
 * Queda asentado en la bitácora inmutable como cualquier otro movimiento, con
 * su origen: es el único que dice "lo cargó el usuario a mano".
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let body: { texto?: unknown };
  try {
    body = (await request.json()) as { texto?: unknown };
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const texto = typeof body.texto === "string" ? body.texto : "";
  const gasto = interpretar(texto, hoyEnParaguay());

  // Sin importe no se guarda nada. Mejor pedir de nuevo que inventar un
  // movimiento que después contamina el disponible real.
  if (!gasto) {
    return NextResponse.json(
      {
        error: "No encontré un importe ahí. Probá algo como “gasté 50 mil en nafta”.",
        entendido: null,
      },
      { status: 400, headers: noStore() },
    );
  }

  const { data, error } = await supabase
    .from("eos_movimientos_financieros")
    .insert({
      usuario_id: user.id,
      tipo: gasto.tipo,
      monto: gasto.monto,
      moneda: gasto.moneda,
      descripcion: gasto.descripcion,
      fecha: gasto.fecha,
      origen: "chat",
      metadata: { texto_original: texto.slice(0, 200), confianza: gasto.confianza },
    })
    .select("id")
    .single();

  if (error) {
    console.error("No se pudo guardar el movimiento rápido:", error);
    return NextResponse.json(
      { error: "No pudimos guardarlo. Probá de nuevo." },
      { status: 500, headers: noStore() },
    );
  }

  await registrarAuditoria(createAdminClient() as never, {
    usuarioId: user.id,
    evento: "movimiento_confirmado",
    origen: "chat",
    resumen: resumirMovimiento({
      tipo: gasto.tipo,
      monto: gasto.monto,
      moneda: gasto.moneda,
      descripcion: gasto.descripcion,
      fuente: "cargado por vos en una línea",
    }),
    referencia: (data?.id as string) ?? null,
    detalle: {
      tipo: gasto.tipo,
      monto: gasto.monto,
      moneda: gasto.moneda,
      fecha: gasto.fecha,
      confianza: gasto.confianza,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      id: data?.id ?? null,
      // Lo que EOS entendió, en palabras. Es el mecanismo de corrección, no
      // una cortesía: sin confirmación previa, esto es la única defensa contra
      // una lectura equivocada.
      entendido: confirmar(gasto),
      movimiento: gasto,
    },
    { status: 201, headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
