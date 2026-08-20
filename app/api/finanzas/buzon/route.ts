import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * La dirección de ingesta del usuario.
 *
 * El usuario configura una regla de reenvío en su correo apuntando acá una
 * sola vez, y a partir de ahí los avisos de su banco entran a EOS solos. Es la
 * pieza que convierte el panel de "calculadora" en algo que se alimenta sin
 * que nadie cargue nada.
 *
 * El buzón se crea bajo demanda (la RPC hace el insert si no existía), así que
 * los usuarios que ya se habían registrado antes de esta función también
 * tienen el suyo sin necesidad de migrar datos.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const dominio = process.env.EOS_CORREO_DOMINIO;

  // Sin dominio de recepción configurado no mostramos una dirección que no
  // funciona: prometerle al usuario un buzón muerto es peor que no ofrecerlo.
  if (!dominio) {
    return NextResponse.json({ disponible: false }, { headers: noStore() });
  }

  const { data, error } = await supabase.rpc("eos_finanzas_obtener_buzon_v53");

  if (error) {
    console.error("No se pudo obtener el buzón de ingesta:", error);
    return NextResponse.json(
      { error: "No pudimos preparar tu dirección de ingesta." },
      { status: 500, headers: noStore() },
    );
  }

  const buzon = (Array.isArray(data) ? data[0] : data) as
    | { token: string; activo: boolean; correos_recibidos: number; ultimo_correo_en: string | null }
    | undefined;

  if (!buzon?.token) {
    return NextResponse.json({ disponible: false }, { headers: noStore() });
  }

  return NextResponse.json(
    {
      disponible: true,
      direccion: `eos-${buzon.token}@${dominio}`,
      activo: buzon.activo,
      correos_recibidos: buzon.correos_recibidos,
      ultimo_correo_en: buzon.ultimo_correo_en,
    },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
