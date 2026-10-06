import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { exigirModulo } from "@/lib/modulos/acceso";
import { filtroDeEmpresa, miEmpresa } from "@/lib/empresa/acceso";
import {
  BUCKET_FOTOS_PRODUCTO,
  MAX_BYTES_FOTO_PRODUCTO,
  SEGUNDOS_ENLACE_FOTO_PRODUCTO,
  rutaDeFotoEsDe,
  rutaDeFotoProducto,
  tipoDeFotoProducto,
} from "@/lib/erp/fotos-producto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * La foto de un producto del catálogo (v232).
 *
 * POST la reemplaza y DELETE la saca. En los dos casos el producto se busca
 * primero con la frontera de la empresa: subir un archivo para un producto
 * ajeno no tiene que ser posible aunque se adivine su id.
 *
 * El archivo viejo se borra DESPUÉS de guardar la ruta nueva. Al revés, una
 * falla entre los dos pasos dejaría el producto apuntando a una foto que ya
 * no existe; así, lo peor que puede pasar es un archivo huérfano en el bucket.
 */
export async function POST(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404, headers: noStore() });
  }

  let cuerpo: { tipo?: unknown; base64?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const tipo = tipoDeFotoProducto(cuerpo.tipo);
  const base64 = typeof cuerpo.base64 === "string" ? cuerpo.base64 : "";
  if (!tipo || !base64) {
    return NextResponse.json(
      { error: "La foto tiene que ser JPG, PNG o WebP." },
      { status: 400, headers: noStore() },
    );
  }

  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_BYTES_FOTO_PRODUCTO) {
    return NextResponse.json(
      { error: "La foto es demasiado grande (máximo 2 MB)." },
      { status: 413, headers: noStore() },
    );
  }

  const supabase = await createClient();
  const empresaId = await miEmpresa(supabase);
  if (!empresaId) {
    return NextResponse.json({ error: "No encontramos tu negocio." }, { status: 404, headers: noStore() });
  }

  const producto = await buscar(supabase, id, puerta.usuarioId, empresaId);
  if (!producto) {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404, headers: noStore() });
  }

  const ruta = rutaDeFotoProducto(empresaId, id, randomUUID(), tipo);
  const admin = createAdminClient();

  const subida = await admin.storage
    .from(BUCKET_FOTOS_PRODUCTO)
    .upload(ruta, bytes, { contentType: tipo, upsert: false });

  if (subida.error) {
    console.error("ERP: no se pudo subir la foto del producto:", subida.error);
    return NextResponse.json({ error: "No pudimos guardar la foto." }, { status: 503, headers: noStore() });
  }

  const { error } = await supabase
    .from("eos_erp_productos")
    .update({ foto_ruta: ruta, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId));

  if (error) {
    console.error("ERP: no se pudo anotar la foto del producto:", error);
    await admin.storage.from(BUCKET_FOTOS_PRODUCTO).remove([ruta]);
    return NextResponse.json({ error: "No pudimos guardar la foto." }, { status: 503, headers: noStore() });
  }

  if (rutaDeFotoEsDe(empresaId, producto.foto_ruta)) {
    await admin.storage.from(BUCKET_FOTOS_PRODUCTO).remove([producto.foto_ruta]);
  }

  const firmada = await admin.storage
    .from(BUCKET_FOTOS_PRODUCTO)
    .createSignedUrl(ruta, SEGUNDOS_ENLACE_FOTO_PRODUCTO);

  return NextResponse.json(
    { foto_ruta: ruta, foto_url: firmada.data?.signedUrl ?? null },
    { status: 201, headers: noStore() },
  );
}

export async function DELETE(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404, headers: noStore() });
  }

  const supabase = await createClient();
  const empresaId = await miEmpresa(supabase);
  const producto = empresaId ? await buscar(supabase, id, puerta.usuarioId, empresaId) : null;

  if (!empresaId || !producto) {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404, headers: noStore() });
  }

  const { error } = await supabase
    .from("eos_erp_productos")
    .update({ foto_ruta: null, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId));

  if (error) {
    console.error("ERP: no se pudo sacar la foto del producto:", error);
    return NextResponse.json({ error: "No pudimos sacar la foto." }, { status: 503, headers: noStore() });
  }

  if (rutaDeFotoEsDe(empresaId, producto.foto_ruta)) {
    await createAdminClient().storage.from(BUCKET_FOTOS_PRODUCTO).remove([producto.foto_ruta]);
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}

async function buscar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  usuarioId: string,
  empresaId: string,
): Promise<{ id: string; foto_ruta: string | null } | null> {
  const { data, error } = await supabase
    .from("eos_erp_productos")
    .select("id,foto_ruta")
    .eq("id", id)
    .or(filtroDeEmpresa(usuarioId, empresaId))
    .eq("activo", true)
    .maybeSingle();

  if (error) {
    console.error("ERP: no se pudo buscar el producto para la foto:", error);
    return null;
  }

  return (data as { id: string; foto_ruta: string | null } | null) ?? null;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
