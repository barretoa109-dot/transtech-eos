import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { FORMATOS } from "@/lib/documentos/guardar";
import { renderizarDocumento } from "@/lib/documentos/renderizar";

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
  // Bajar el archivo es la parte que se contrata; armarlo ya lo hizo EOS.
  const puerta = await exigirModulo("documentos");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const user = { id: puerta.usuarioId };

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

  const renderizado = await renderizarDocumento(fila.especificacion, fila.formato, pedido);

  if (!renderizado.ok) {
    console.error(`Documentos: no se pudo entregar ${id} (${renderizado.status}):`, renderizado.error);
    return NextResponse.json({ error: renderizado.error }, { status: renderizado.status, headers: noStore() });
  }

  const { cuerpo, nombre } = renderizado;

  return new Response(new Uint8Array(cuerpo), {
    status: 200,
    headers: {
      "Content-Type": FORMATOS[renderizado.formato].tipo,
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
