import { NextResponse } from "next/server";

import { esAgente, tieneInterruptor } from "@/lib/agentes/agentes";
import { VERSIONES } from "@/lib/agentes/versiones.generado";
import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El tablero de los agentes para el dueño: prender y apagar sin deploy,
 * aprobar la versión que está corriendo, cambiar el tope semanal y cerrar
 * escalamientos.
 *
 * Entra por sesión y por ADMIN_EMAILS, como /admin/salud y /admin/pagos; a
 * cualquier otro le contesta 404.
 *
 * "Aprobar" aprueba la versión que tiene ESTE despliegue (`VERSIONES`, el hash
 * de agentes/ con el que se compiló). Es lo que pide la regla 7: el dueño
 * aprueba lo que va a correr, no lo que alguien escribió en una rama.
 */

function correosAdministradores() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function administrador(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase() || "";
  if (error || !user || !email || !correosAdministradores().includes(email)) return null;
  return email;
}

const noEncontrado = () => NextResponse.json({ error: "No encontrado." }, { status: 404 });
const SIN_CACHE = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function GET() {
  if (!(await administrador())) return noEncontrado();

  const { data, error } = await adminSinTipos().rpc("eos_agentes_panel_v267");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ...(data as object), versiones_desplegadas: VERSIONES }, { headers: SIN_CACHE });
}

export async function POST(request: Request) {
  const quien = await administrador();
  if (!quien) return noEncontrado();

  const cuerpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const accion = cuerpo.accion;
  const admin = adminSinTipos();
  let resultado: { error: { message: string } | null };

  if (accion === "prender" || accion === "apagar") {
    if (!tieneInterruptor(cuerpo.agente)) return NextResponse.json({ error: "Agente desconocido." }, { status: 400 });
    resultado = await admin.rpc("eos_agentes_cambiar_v267", {
      p_agente: cuerpo.agente,
      p_activo: accion === "prender",
      p_quien: quien,
    });
  } else if (accion === "aprobar") {
    if (!esAgente(cuerpo.agente)) return NextResponse.json({ error: "Agente desconocido." }, { status: 400 });
    resultado = await admin.rpc("eos_agentes_aprobar_v267", {
      p_agente: cuerpo.agente,
      p_version: VERSIONES[cuerpo.agente],
      p_quien: quien,
    });
  } else if (accion === "tope") {
    const tope = Number(cuerpo.tope);
    if (!Number.isInteger(tope) || tope < 0 || tope > 50) {
      return NextResponse.json({ error: "El tope es un número entre 0 y 50." }, { status: 400 });
    }
    resultado = await admin.rpc("eos_agentes_tope_v267", { p_tope: tope, p_quien: quien });
  } else if (accion === "tope_sistema") {
    const tope = Number(cuerpo.tope);
    if (!Number.isInteger(tope) || tope < 0 || tope > 50) {
      return NextResponse.json({ error: "El tope es un número entre 0 y 50." }, { status: 400 });
    }
    resultado = await admin.rpc("eos_agentes_tope_sistema_v268", { p_tope: tope, p_quien: quien });
  } else if (accion === "resolver") {
    if (typeof cuerpo.id !== "string") return NextResponse.json({ error: "Falta el caso." }, { status: 400 });
    resultado = await admin.rpc("eos_agentes_resolver_v267", {
      p_escalamiento: cuerpo.id,
      p_respuesta: typeof cuerpo.respuesta === "string" ? cuerpo.respuesta : "",
      p_quien: quien,
    });
  } else {
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  }

  if (resultado.error) return NextResponse.json({ error: resultado.error.message }, { status: 400 });
  return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
}
