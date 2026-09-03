import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const dynamic = "force-dynamic";

/**
 * Mi empresa: quiénes somos y quién falta.
 *
 * No exige ningún módulo. Pertenecer a una empresa es del nivel de la cuenta,
 * no del anexo de ERP: alguien invitado como "solo lectura" para ver el
 * embudo tiene que poder aceptar y elegir empresa aunque no tenga contratado
 * el módulo de negocio.
 *
 * `PATCH` cambia la empresa activa, que es en cuál está trabajando la
 * persona. Se cambia a mano y nunca sola: que alguien entre y vea de golpe
 * los datos de otro negocio, sin haber tocado nada, es la clase de sorpresa
 * que hace desconfiar del sistema entero.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });
  }

  const admin = adminSinTipos();

  const { data: membresias, error } = await admin
    .from("eos_empresa_miembros")
    .select("empresa_id,rol,activa,creado_en,empresa:eos_empresas(id,nombre)")
    .eq("usuario_id", user.id);

  if (error) {
    console.error("Empresa: no se pudieron leer las membresías:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const activa = (membresias ?? []).find((m: Record<string, unknown>) => m.activa === true);
  const empresaActiva = (activa?.empresa_id as string | undefined) ?? null;

  // Los compañeros y las invitaciones pendientes solo se leen de la empresa
  // ACTIVA: mostrar los de todas mezclaría gente de negocios distintos en una
  // misma lista.
  const [miembrosRes, invitacionesRes, mias] = await Promise.all([
    empresaActiva
      ? admin
          .from("eos_empresa_miembros")
          .select("usuario_id,rol,creado_en")
          .eq("empresa_id", empresaActiva)
      : Promise.resolve({ data: [], error: null }),
    empresaActiva
      ? admin
          .from("eos_empresa_invitaciones_v114")
          .select("id,email,rol,creado_en")
          .eq("empresa_id", empresaActiva)
          .eq("estado", "pendiente")
      : Promise.resolve({ data: [], error: null }),
    // Las que me invitaron a mí, para poder aceptarlas.
    admin
      .from("eos_empresa_invitaciones_v114")
      .select("id,rol,creado_en,empresa:eos_empresas(id,nombre)")
      .eq("email", (user.email ?? "").toLowerCase())
      .eq("estado", "pendiente"),
  ]);

  /*
   * El correo de cada compañero se resuelve con el cliente admin porque
   * `auth.users` no es legible desde el navegador. Va solo el correo, que es
   * lo que identifica a una persona en el equipo — nada más de su cuenta.
   */
  const ids = (miembrosRes.data ?? []).map((m: Record<string, unknown>) => m.usuario_id as string);
  const correos = new Map<string, string>();

  for (const id of ids) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) correos.set(id, data.user.email);
  }

  return NextResponse.json(
    {
      empresas: (membresias ?? []).map((m: Record<string, unknown>) => ({
        id: m.empresa_id,
        nombre: (m.empresa as { nombre?: string } | null)?.nombre ?? "Mi negocio",
        rol: m.rol,
        activa: m.activa === true,
      })),
      miembros: (miembrosRes.data ?? []).map((m: Record<string, unknown>) => ({
        usuario_id: m.usuario_id,
        email: correos.get(m.usuario_id as string) ?? null,
        rol: m.rol,
        soy_yo: m.usuario_id === user.id,
      })),
      invitaciones_enviadas: invitacionesRes.data ?? [],
      invitaciones_recibidas: (mias.data ?? []).map((i: Record<string, unknown>) => ({
        id: i.id,
        rol: i.rol,
        empresa: (i.empresa as { nombre?: string } | null)?.nombre ?? "una empresa",
      })),
      puedo_administrar: activa?.rol === "propietario" || activa?.rol === "administrador",
    },
    { headers: noStore() },
  );
}

/** Cambiar en qué empresa estoy trabajando. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: noStore() });
  }

  const empresaId = typeof cuerpo.empresa_id === "string" ? cuerpo.empresa_id : "";
  if (!empresaId) {
    return NextResponse.json({ error: "Falta la empresa." }, { status: 400, headers: noStore() });
  }

  const { data, error } = await adminSinTipos().rpc("eos_empresa_activar_v114", {
    p_usuario_id: user.id,
    p_empresa_id: empresaId,
  });

  if (error) {
    if (String(error.message ?? "").includes("EOS_NO_ES_MIEMBRO")) {
      return NextResponse.json(
        { error: "No pertenecés a esa empresa." },
        { status: 403, headers: noStore() },
      );
    }
    console.error("Empresa: no se pudo cambiar la activa:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json(data, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
