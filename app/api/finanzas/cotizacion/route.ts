import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { monedaConocida } from "@/lib/finanzas/monedas";

export const dynamic = "force-dynamic";

/**
 * La última cotización conocida de un par de monedas, con su origen y su
 * fecha -- nunca un total convertido. Ver `lib/finanzas/cotizacion.ts`.
 *
 * `disponible: false` cuando todavía no hay ninguna fila (el cron no corrió,
 * o `GOOGLE_SHEET_COTIZACION_URL` no está cargada): la pantalla que la pide
 * simplemente no muestra el equivalente, no inventa un cero.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const params = new URL(request.url).searchParams;
  const desde = monedaConocida(params.get("desde"), "USD");
  const hasta = monedaConocida(params.get("hasta"), "PYG");

  if (desde === hasta) {
    return NextResponse.json({ disponible: false }, { headers: noStore() });
  }

  const { data, error } = await supabase
    .from("eos_cotizaciones")
    .select("moneda_desde,moneda_hasta,valor,origen,obtenida_en")
    .eq("moneda_desde", desde)
    .eq("moneda_hasta", hasta)
    .maybeSingle();

  if (error) {
    console.error("Cotización: no se pudo leer:", error);
    return NextResponse.json({ disponible: false }, { headers: noStore() });
  }

  if (!data) {
    return NextResponse.json({ disponible: false }, { headers: noStore() });
  }

  return NextResponse.json(
    { disponible: true, ...data, valor: Number(data.valor) },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
