import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  BUCKET_FOTOS_CHAT,
  MAX_BYTES_FOTO,
  rutaDeFoto,
  tipoDeFotoAceptado,
} from "@/lib/eos/fotos-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Guardar UNA foto del chat, para poder mostrarla en la burbuja.
 *
 * Una por pedido y no las diez juntas: el cuerpo de una función tiene tope, y
 * diez fotos en base64 lo rozan. Una sola, ya achicada, pesa 200 a 400 KB.
 *
 * La ruta la arma el servidor con el usuario de la sesión. El navegador no
 * elige dónde se guarda, así que no puede escribir en la carpeta de otro.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let cuerpo: { nombre?: unknown; tipo?: unknown; base64?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const tipo = typeof cuerpo.tipo === "string" ? cuerpo.tipo.toLowerCase() : "";
  const nombre = typeof cuerpo.nombre === "string" ? cuerpo.nombre.slice(0, 200) : "imagen";
  const base64 = typeof cuerpo.base64 === "string" ? cuerpo.base64 : "";

  if (!tipoDeFotoAceptado(tipo) || !base64) {
    return NextResponse.json({ error: "Solo se guardan imágenes." }, { status: 400, headers: noStore() });
  }

  const bytes = Buffer.from(base64, "base64");

  if (bytes.length === 0 || bytes.length > MAX_BYTES_FOTO) {
    return NextResponse.json({ error: "La imagen es demasiado grande." }, { status: 413, headers: noStore() });
  }

  const ruta = rutaDeFoto(user.id, randomUUID(), tipo);

  const { error } = await createAdminClient()
    .storage.from(BUCKET_FOTOS_CHAT)
    .upload(ruta, bytes, { contentType: tipo, upsert: false });

  if (error) {
    console.error("Fotos del chat: no se pudo guardar la imagen:", error);
    return NextResponse.json({ error: "No pudimos guardar la imagen." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ ruta, nombre, tipo }, { status: 201, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
