import { NextResponse } from "next/server";

import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { resolverClaveApi } from "@/lib/developer/autenticar";
import { empresaDe, filtroDeEmpresa } from "@/lib/empresa/acceso";
import { esFechaISOValida, hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { consumirCupo, respuestaSinCupo, secretoDelEntorno } from "@/lib/seguridad/limite";

export const dynamic = "force-dynamic";

const MAX_LIMITE = 500;
const DIAS_DEFECTO = 30;

/**
 * Developer Platform (ítem 25), primera pieza: las ventas del período, para
 * que un contador u otro sistema las pueda leer sin entrar al panel.
 *
 * `?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` (por defecto, los últimos 30 días) y
 * `?limite=` (por defecto 100, máximo 500). Solo lectura, misma tabla y
 * mismas columnas de resumen que ya muestra la pantalla de Ventas — nunca un
 * número recalculado aparte.
 *
 * T-12: cuota por IP, igual que `/saldo` — ver el comentario ahí.
 */
export async function GET(request: Request) {
  const admin = adminSinTipos();

  const cupo = await consumirCupo(admin, {
    ruta: "/api/v1/publico/ventas",
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

  const hoy = hoyEnParaguay();
  const { searchParams } = new URL(request.url);

  const hastaParam = searchParams.get("hasta");
  const hasta = esFechaISOValida(hastaParam) ? hastaParam : hoy;

  const desdeParam = searchParams.get("desde");
  const desde = esFechaISOValida(desdeParam) ? desdeParam : sumarDias(hasta, -DIAS_DEFECTO);

  const limite = Math.min(Number(searchParams.get("limite") ?? 100) || 100, MAX_LIMITE);

  const empresaId = await empresaDe(admin, clave.usuarioId);

  const { data, error } = await admin
    .from("eos_erp_ventas")
    .select(
      "id,fecha,moneda,subtotal,iva_total,total,condicion,estado,vence_el,contacto:eos_crm_contactos(nombre)",
    )
    .or(filtroDeEmpresa(clave.usuarioId, empresaId))
    .neq("estado", "anulada")
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: false })
    .limit(limite);

  if (error) {
    console.error("Developer Platform: no se pudieron leer las ventas:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ horizonte: { desde, hasta }, ventas: data ?? [] }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
