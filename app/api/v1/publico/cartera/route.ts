import { NextResponse } from "next/server";

import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { resolverClaveApi } from "@/lib/developer/autenticar";
import { hoyEnParaguay } from "@/lib/fecha";
import { monedaConocida } from "@/lib/finanzas/monedas";
import { leerCartera } from "@/lib/erp/cartera-leer";
import { antiguedad, estaPendiente, saldoDe, vencidos } from "@/lib/erp/cartera";

export const dynamic = "force-dynamic";

/**
 * Developer Platform (ítem 25), primera pieza: lo que te deben los clientes
 * o lo que le debés a tus proveedores — exactamente lo mismo que ya muestra
 * la pantalla de Cartera (`app/api/erp/cartera/route.ts`), por la misma
 * aritmética (`lib/erp/cartera.ts`). Dos números distintos para lo mismo
 * harían que nadie le crea a ninguno de los dos.
 *
 * `?tipo=cobrar` (ventas, por defecto) o `?tipo=pagar` (compras). Solo
 * lectura.
 */
export async function GET(request: Request) {
  const admin = adminSinTipos();
  const clave = await resolverClaveApi(admin, request);
  if (!clave) {
    return NextResponse.json({ error: "Clave de API inválida, revocada o ausente." }, { status: 401, headers: noStore() });
  }

  const { searchParams } = new URL(request.url);
  const tipo = searchParams.get("tipo") === "pagar" ? "pagar" : "cobrar";
  const hoy = hoyEnParaguay();

  let cartera;
  try {
    cartera = await leerCartera(admin, clave.usuarioId, tipo);
  } catch (error) {
    console.error("Developer Platform: no se pudo leer la cartera:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const pendientes = cartera.documentos.filter(estaPendiente);
  const monedas = [...new Set(pendientes.map((d) => monedaConocida(d.moneda)))].sort();

  return NextResponse.json(
    {
      tipo,
      hoy,
      monedas: monedas.map((moneda) => antiguedad(pendientes, moneda, hoy)),
      vencidos: vencidos(pendientes, hoy)
        .slice(0, 100)
        .map((d) => ({
          id: d.id,
          fecha: d.fecha,
          vence_el: d.vence_el,
          moneda: d.moneda,
          saldo: saldoDe(d),
          contacto_nombre: d.contacto_nombre,
        })),
    },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
