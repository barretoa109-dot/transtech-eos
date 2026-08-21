import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Descarga de todos los datos del usuario.
 *
 * La otra mitad del derecho que cubre el borrado: además de poder irse, uno
 * tiene derecho a llevarse lo suyo. Un producto al que le confiás tu vida
 * financiera no debería ser una jaula.
 *
 * Se entrega como archivo y no como JSON en pantalla porque el punto es que
 * el usuario se lo quede, no que lo mire.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json({ error: "Sesión no válida." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("eos_exportar_mis_datos_v56");

  if (error) {
    console.error("No se pudo exportar los datos del usuario:", error);
    return Response.json(
      { error: "No pudimos preparar tu exportación. Probá de nuevo en unos minutos." },
      { status: 500 },
    );
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const cuerpo = JSON.stringify(data, null, 2);

  return new Response(cuerpo, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="eos-mis-datos-${fecha}.json"`,
      // Contiene datos personales: que no quede en ninguna cache intermedia.
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
