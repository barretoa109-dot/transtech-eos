import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { administrarCanal, conectarCanal, validarAjustes, validarConexion } from "@/lib/whatsapp-crm/canal";

export const dynamic = "force-dynamic";

/**
 * Conectar y administrar el WhatsApp Business de la empresa.
 *
 * POST   conecta (o reconecta) un número con su token de Meta.
 * PATCH  { accion: "pausar" | "reanudar" | "desconectar" | "configurar", ... }
 *
 * ============================================================
 * LO QUE ESTA RUTA NUNCA HACE
 * ============================================================
 *
 * Devolver el token de Meta ni el secreto de la app: entran por acá una vez, van a
 * Vault y no salen más. La respuesta de conectar trae solo lo que la persona
 * necesita para terminar la configuración en Meta (el token de verificación del
 * webhook, que no es un secreto fuerte).
 *
 * La lógica vive en `lib/whatsapp-crm/canal.ts`, donde se prueba; acá solo se
 * autentica y se traduce a HTTP. Todo lleva el `usuario_id` de la sesión: no se
 * acepta ningún dueño por parámetro.
 */

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

async function cuerpoJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const validacion = validarConexion(await cuerpoJson(request));
  if (!validacion.ok) {
    return NextResponse.json({ error: validacion.error, campo: validacion.campo }, { status: 400, headers: noStore });
  }

  const r = await conectarCanal(adminSinTipos(), puerta.usuarioId, validacion.datos);

  if (!r.ok) {
    return NextResponse.json({ error: r.error, campo: r.campo }, { status: r.estado, headers: noStore });
  }

  return NextResponse.json(
    {
      canal: {
        id: r.canal.id,
        telefono: r.canal.telefono,
        nombre: r.canal.nombre,
        estado: r.canal.estado,
      },
      // Lo que hay que pegar en Meta para recibir los mensajes de los clientes.
      webhook: { verify_token: r.canal.verify_token },
    },
    { status: 201, headers: noStore },
  );
}

export async function PATCH(request: Request) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const cuerpo = (await cuerpoJson(request)) as Record<string, unknown> | null;
  const canalId = typeof cuerpo?.canal_id === "string" ? cuerpo.canal_id : "";

  if (!/^[0-9a-f-]{36}$/i.test(canalId)) {
    return NextResponse.json({ error: "Canal no encontrado." }, { status: 404, headers: noStore });
  }

  const accion = cuerpo?.accion;
  const admin = adminSinTipos();

  if (accion === "pausar" || accion === "reanudar" || accion === "desconectar") {
    const r = await administrarCanal(admin, puerta.usuarioId, canalId, { accion });
    return r.ok
      ? NextResponse.json({ canal: r.canal }, { headers: noStore })
      : NextResponse.json({ error: r.error }, { status: r.estado, headers: noStore });
  }

  if (accion === "configurar") {
    const ajustes = validarAjustes(cuerpo);
    if (!ajustes.ok) {
      return NextResponse.json({ error: ajustes.error, campo: ajustes.campo }, { status: 400, headers: noStore });
    }

    const r = await administrarCanal(admin, puerta.usuarioId, canalId, { accion: "configurar", ajustes: ajustes.datos });
    return r.ok
      ? NextResponse.json({ canal: r.canal }, { headers: noStore })
      : NextResponse.json({ error: r.error }, { status: r.estado, headers: noStore });
  }

  return NextResponse.json({ error: "Acción no reconocida." }, { status: 400, headers: noStore });
}
