import { NextResponse } from "next/server";

import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { resolverClaveApi } from "@/lib/developer/autenticar";
import { empresaDe, saldosDeCaja } from "@/lib/empresa/acceso";
import { hoyEnParaguay } from "@/lib/fecha";

export const dynamic = "force-dynamic";

/**
 * Developer Platform (ítem 25), primera pieza: el saldo de caja del negocio,
 * por moneda. La misma función que ya usan Contabilidad y Pronóstico
 * (`lib/empresa/acceso.ts::saldosDeCaja`) — nunca un cálculo aparte.
 *
 * Solo lectura. Autenticado con una clave propia (ver
 * `lib/developer/autenticar.ts`), nunca con la sesión del navegador.
 */
export async function GET(request: Request) {
  const admin = adminSinTipos();
  const clave = await resolverClaveApi(admin, request);
  if (!clave) {
    return NextResponse.json({ error: "Clave de API inválida, revocada o ausente." }, { status: 401, headers: noStore() });
  }

  const empresaId = await empresaDe(admin, clave.usuarioId);
  const saldos = await saldosDeCaja(admin, empresaId, hoyEnParaguay());

  return NextResponse.json({ saldos }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
