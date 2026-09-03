import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const dynamic = "force-dynamic";

/**
 * Invitar, cambiar de rol, sacar, y aceptar una invitación.
 *
 * Los permisos NO se comprueban acá: los comprueba cada función de la base
 * (`eos_empresa_administra_v114`). Duplicar la regla en la ruta la volvería
 * dos reglas, y el día que cambie una sin la otra el sistema quedaría
 * diciendo dos cosas sobre quién puede sacar a quién.
 *
 * Acá solo se traducen los errores a castellano.
 */

const ERRORES: Record<string, { estado: number; mensaje: string }> = {
  EOS_EMPRESA_SIN_PERMISO: {
    estado: 403,
    mensaje: "Solo el dueño o un administrador pueden hacer esto.",
  },
  EOS_EMAIL_INVALIDO: { estado: 400, mensaje: "Ese correo no parece válido." },
  EOS_INVITACION_A_SI_MISMO: { estado: 400, mensaje: "Ya estás en esta empresa." },
  EOS_YA_ES_MIEMBRO: { estado: 409, mensaje: "Esa persona ya es parte de la empresa." },
  EOS_INVITACION_NO_VIGENTE: { estado: 409, mensaje: "Esa invitación ya no está disponible." },
  EOS_INVITACION_DE_OTRO: { estado: 403, mensaje: "Esa invitación es para otro correo." },
  EOS_NO_ES_MIEMBRO: { estado: 404, mensaje: "Esa persona no está en la empresa." },
  EOS_NO_SE_SACA_AL_PROPIETARIO: {
    estado: 409,
    mensaje: "No se puede sacar al dueño: la empresa quedaría sin quien la administre.",
  },
  EOS_PROPIETARIO_NO_SE_ASIGNA: { estado: 409, mensaje: "El rol de dueño no se asigna." },
  EOS_PROPIETARIO_NO_CAMBIA_DE_ROL: { estado: 409, mensaje: "Al dueño no se le cambia el rol." },
};

const ROLES = new Set([
  "administrador", "ventas", "compras", "deposito", "caja", "contabilidad", "solo_lectura",
]);

function traducir(mensaje: string) {
  for (const [clave, salida] of Object.entries(ERRORES)) {
    if (mensaje.includes(clave)) return salida;
  }
  return { estado: 503, mensaje: "No pudimos completar la operación." };
}

async function sesion() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** La empresa en la que la persona está trabajando ahora. */
async function empresaActiva(usuarioId: string): Promise<string | null> {
  const { data } = await adminSinTipos()
    .from("eos_empresa_miembros")
    .select("empresa_id")
    .eq("usuario_id", usuarioId)
    .eq("activa", true)
    .maybeSingle();

  return (data?.empresa_id as string | undefined) ?? null;
}

function responder(data: unknown, error: { message?: string } | null) {
  if (error) {
    const { estado, mensaje } = traducir(String(error.message ?? ""));
    if (estado === 503) console.error("Empresa: operación de miembros falló:", error);
    return NextResponse.json({ error: mensaje }, { status: estado, headers: noStore() });
  }
  return NextResponse.json(data, { headers: noStore() });
}

/** Invitar por correo, o aceptar una invitación recibida. */
export async function POST(request: Request) {
  const user = await sesion();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: noStore() });
  }

  const admin = adminSinTipos();

  // Aceptar una invitación no necesita empresa activa: es justamente lo que
  // te mete en una.
  if (typeof cuerpo.aceptar === "string") {
    const { data, error } = await admin.rpc("eos_empresa_aceptar_v114", {
      p_usuario_id: user.id,
      p_invitacion_id: cuerpo.aceptar,
    });
    return responder(data, error);
  }

  const email = String(cuerpo.email ?? "").trim();
  const rol = String(cuerpo.rol ?? "");

  if (!ROLES.has(rol)) {
    return NextResponse.json({ error: "Elegí un rol válido." }, { status: 400, headers: noStore() });
  }

  const empresaId = await empresaActiva(user.id);
  if (!empresaId) {
    return NextResponse.json({ error: "No tenés una empresa activa." }, { status: 409, headers: noStore() });
  }

  const { data, error } = await admin.rpc("eos_empresa_invitar_v114", {
    p_actor: user.id,
    p_empresa_id: empresaId,
    p_email: email,
    p_rol: rol,
  });

  return responder(data, error);
}

/** Cambiarle el rol a alguien del equipo. */
export async function PATCH(request: Request) {
  const user = await sesion();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: noStore() });
  }

  const rol = String(cuerpo.rol ?? "");
  if (!ROLES.has(rol)) {
    return NextResponse.json({ error: "Elegí un rol válido." }, { status: 400, headers: noStore() });
  }

  const empresaId = await empresaActiva(user.id);
  if (!empresaId) {
    return NextResponse.json({ error: "No tenés una empresa activa." }, { status: 409, headers: noStore() });
  }

  const { data, error } = await adminSinTipos().rpc("eos_empresa_cambiar_rol_v114", {
    p_actor: user.id,
    p_empresa_id: empresaId,
    p_usuario_id: String(cuerpo.usuario_id ?? ""),
    p_rol: rol,
  });

  return responder(data, error);
}

/** Sacar a alguien. No borra lo que cargó: ese trabajo es de la empresa. */
export async function DELETE(request: Request) {
  const user = await sesion();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });

  const usuarioId = (new URL(request.url).searchParams.get("usuario_id") ?? "").trim();
  if (!usuarioId) {
    return NextResponse.json({ error: "Falta a quién sacar." }, { status: 400, headers: noStore() });
  }

  const empresaId = await empresaActiva(user.id);
  if (!empresaId) {
    return NextResponse.json({ error: "No tenés una empresa activa." }, { status: 409, headers: noStore() });
  }

  const { data, error } = await adminSinTipos().rpc("eos_empresa_quitar_v114", {
    p_actor: user.id,
    p_empresa_id: empresaId,
    p_usuario_id: usuarioId,
  });

  return responder(data, error);
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
