import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const dynamic = "force-dynamic";

/**
 * Qué funciones muestra el menú de un negocio (v232).
 *
 * Una granja que vende por lote no necesita un catálogo con fotos; una tienda
 * sí. Apagar una función la saca del menú de ESE negocio y nada más: no borra
 * productos ni contactos, no cambia lo que se cobra y se vuelve a prender
 * cuando se quiera.
 *
 * Solo la cambian el propietario o un administrador, igual que el resto de la
 * configuración de la empresa.
 */
const FUNCIONES = ["catalogo", "clientes"] as const;

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });
  }

  let cuerpo: { empresa_id?: unknown; funciones_ocultas?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: noStore() });
  }

  const empresaId = typeof cuerpo.empresa_id === "string" ? cuerpo.empresa_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(empresaId) || !Array.isArray(cuerpo.funciones_ocultas)) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: noStore() });
  }

  const ocultas = [...new Set(cuerpo.funciones_ocultas)].filter((f): f is (typeof FUNCIONES)[number] =>
    (FUNCIONES as readonly unknown[]).includes(f),
  );

  const admin = adminSinTipos();

  const { data: membresia, error: errorMembresia } = await admin
    .from("eos_empresa_miembros")
    .select("rol")
    .eq("empresa_id", empresaId)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (errorMembresia) {
    console.error("Empresa: no se pudo leer la membresía:", errorMembresia);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const rol = (membresia as { rol?: string } | null)?.rol;
  if (rol !== "propietario" && rol !== "administrador") {
    return NextResponse.json(
      { error: "Solo el dueño o un administrador cambian esto." },
      { status: 403, headers: noStore() },
    );
  }

  const { error } = await admin
    .from("eos_empresas")
    .update({ funciones_ocultas: ocultas, actualizado_en: new Date().toISOString() })
    .eq("id", empresaId);

  if (error) {
    console.error("Empresa: no se pudieron guardar las funciones:", error);
    return NextResponse.json({ error: "No pudimos guardar el cambio." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ ok: true, funciones_ocultas: ocultas }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
