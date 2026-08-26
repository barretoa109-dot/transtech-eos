import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { normalizarDocumento } from "@/lib/documentos/especificacion";
import { crearExcelDocumento } from "@/lib/documentos/excel";
import { crearPdfDocumento } from "@/lib/documentos/pdf";
import { crearWordDocumento } from "@/lib/documentos/word";
import { esFormato, nombreDeArchivo, FORMATOS } from "@/lib/documentos/guardar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bajar, en el formato que se pida, un documento que EOS ya armó.
 *
 * El archivo se DIBUJA acá, en cada descarga, a partir de la descripción
 * guardada. Por eso el mismo id sirve para las tres extensiones: cambiar
 * `?formato=` no vuelve a molestar a EOS ni gasta un mensaje del plan.
 *
 * Las mismas tres reglas que `/api/informes`, por el mismo motivo — esto
 * devuelve datos de una persona, no una plantilla en blanco:
 *
 *  - **EXIGE SESIÓN.**
 *  - **NO ACEPTA UN `usuario_id` DEL CLIENTE.** El filtro sale de la sesión, y
 *    además la política de RLS lo vuelve a exigir del lado de la base: un
 *    `id` adivinado de otra persona devuelve 404, no su documento.
 *  - **NO SE CACHEA**, ni en el navegador ni en un proxy.
 */

export async function GET(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const { id } = await contexto.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Documento no encontrado." }, { status: 404, headers: noStore() });
  }

  const pedido = (new URL(request.url).searchParams.get("formato") ?? "").toLowerCase();

  const { data, error } = await supabase
    .from("eos_documentos_generados")
    .select("titulo,especificacion,formato")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Documentos: no se pudo leer el documento:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  if (!data) {
    return NextResponse.json({ error: "Documento no encontrado." }, { status: 404, headers: noStore() });
  }

  const fila = data as { titulo: string; especificacion: unknown; formato: string };

  // Si no se pide formato, sale en el que se pidió originalmente.
  const formato = esFormato(pedido) ? pedido : esFormato(fila.formato) ? fila.formato : "excel";

  // Se vuelve a normalizar aunque ya se haya guardado normalizado: la fila es
  // un jsonb y nada impide que mañana alguien la edite desde el panel de la
  // base. El renderizador nunca debería ver algo que no pasó por esta puerta.
  const resultado = normalizarDocumento(fila.especificacion);

  if (!resultado.ok) {
    console.error(`Documentos: la descripción guardada de ${id} ya no es válida:`, resultado.motivo);
    return NextResponse.json(
      { error: "Este documento quedó dañado y hay que volver a pedirlo." },
      { status: 422, headers: noStore() },
    );
  }

  let cuerpo: Buffer;
  try {
    cuerpo =
      formato === "excel"
        ? Buffer.from(await crearExcelDocumento(resultado.documento))
        : formato === "pdf"
          ? await crearPdfDocumento(resultado.documento)
          : await crearWordDocumento(resultado.documento);
  } catch (fallo) {
    console.error(`Documentos: falló la generación del ${formato}:`, fallo);
    return NextResponse.json(
      { error: "No pudimos generar el archivo." },
      { status: 500, headers: noStore() },
    );
  }

  const nombre = nombreDeArchivo(resultado.documento.titulo, formato);

  return new Response(new Uint8Array(cuerpo), {
    status: 200,
    headers: {
      "Content-Type": FORMATOS[formato].tipo,
      "Content-Length": String(cuerpo.length),
      // `filename*` con UTF-8 para que los acentos no lleguen rotos al disco.
      "Content-Disposition": `attachment; filename="${asciiPlano(nombre)}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * El `filename` sin `*` viaja en un header, y un header no puede llevar
 * caracteres fuera de ASCII ni comillas: si se cuela uno, algunos clientes
 * descartan la cabecera entera y el archivo se baja como "download".
 */
function asciiPlano(nombre: string): string {
  return nombre.replace(/[^\u0020-\u007E]/g, "_").replace(/["\\]/g, "_");
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
