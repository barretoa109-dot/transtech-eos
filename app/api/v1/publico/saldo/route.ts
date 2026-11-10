import { NextResponse } from "next/server";

import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { resolverClaveApi } from "@/lib/developer/autenticar";
import { empresaDe, saldosDeCaja } from "@/lib/empresa/acceso";
import { hoyEnParaguay } from "@/lib/fecha";
import { consumirCupo, respuestaSinCupo, secretoDelEntorno } from "@/lib/seguridad/limite";

export const dynamic = "force-dynamic";

/**
 * Developer Platform (ítem 25), primera pieza: el saldo de caja del negocio,
 * por moneda. La misma función que ya usan Contabilidad y Pronóstico
 * (`lib/empresa/acceso.ts::saldosDeCaja`) — nunca un cálculo aparte.
 *
 * Solo lectura. Autenticado con una clave propia (ver
 * `lib/developer/autenticar.ts`), nunca con la sesión del navegador.
 *
 * T-12 del plan maestro de auditoría (07/11/2026): esta ruta pública no
 * tenía cuota, a diferencia de todas las demás rutas sin sesión del
 * proyecto (webhooks, soporte). Una clave filtrada —o un integrador con un
 * bug— podía pegarle sin límite. Mismo mecanismo que ya usan ellas
 * (`lib/seguridad/limite.ts`): por IP, no por clave, para frenar también un
 * ataque que todavía no mandó ninguna clave válida.
 */
export async function GET(request: Request) {
  const admin = adminSinTipos();

  const cupo = await consumirCupo(admin, {
    ruta: "/api/v1/publico/saldo",
    cabeceras: request.headers,
    ventanaSegundos: 60,
    maximo: 60,
    secreto: secretoDelEntorno(),
  });

  if (!cupo.permitido) {
    return respuestaSinCupo(cupo, "Demasiadas solicitudes en poco tiempo.");
  }

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
