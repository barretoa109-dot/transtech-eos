import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { generarClave } from "@/lib/developer/claves";

export const dynamic = "force-dynamic";

/**
 * Las claves de API que la persona misma creó para el Developer Platform
 * (ítem 25). Va con el cliente de SESIÓN: la RLS de `eos_api_keys` decide qué
 * fila es de quién, así que ni GET ni POST tienen que filtrar a mano.
 *
 * GET  la lista, sin el valor de la clave —nunca se vuelve a mostrar—, solo
 *      el prefijo para reconocerla.
 * POST crea una, y devuelve el valor completo UNA sola vez. Si la persona lo
 *      pierde, no hay forma de recuperarlo: se crea una nueva y se revoca
 *      esta.
 */

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

export async function GET() {
  const supabase = await createClient();
  const { data: usuario, error: usuarioError } = await supabase.auth.getUser();
  if (usuarioError || !usuario?.user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401, headers: noStore() });
  }

  const { data, error } = await supabase
    .from("eos_api_keys")
    .select("id,nombre,prefijo,creado_en,ultimo_uso_en,revocada_en")
    .order("creado_en", { ascending: false });

  if (error) {
    console.error("Developer Platform: no se pudieron leer las claves:", error);
    return NextResponse.json({ error: "No pudimos leer tus claves." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ claves: data ?? [] }, { headers: noStore() });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: usuario, error: usuarioError } = await supabase.auth.getUser();
  if (usuarioError || !usuario?.user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401, headers: noStore() });
  }

  let cuerpo: { nombre?: unknown };
  try {
    cuerpo = (await request.json()) as typeof cuerpo;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const nombre =
    typeof cuerpo.nombre === "string" && cuerpo.nombre.trim() !== "" ? cuerpo.nombre.trim().slice(0, 80) : "Sin nombre";

  const generada = generarClave();

  const { data, error } = await supabase
    .from("eos_api_keys")
    .insert([{ usuario_id: usuario.user.id, nombre, hash: generada.hash, prefijo: generada.prefijo }])
    .select("id,nombre,prefijo,creado_en")
    .single();

  if (error) {
    console.error("Developer Platform: no se pudo crear la clave:", error);
    return NextResponse.json({ error: "No pudimos crear la clave." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ ...data, clave: generada.clave }, { headers: noStore() });
}
