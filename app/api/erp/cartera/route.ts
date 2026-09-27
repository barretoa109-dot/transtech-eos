import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { hoyEnParaguay } from "@/lib/fecha";
import { monedaConocida } from "@/lib/finanzas/monedas";
import { leerCartera, type CarteraLeida } from "@/lib/erp/cartera-leer";
import {
  antiguedad,
  diasPromedioDeCobro,
  estaPendiente,
  saldoDe,
  vencidos,
  type CobroConDocumento,
} from "@/lib/erp/cartera";

export const dynamic = "force-dynamic";

/**
 * El estado de cuenta: qué te deben, desde cuándo, y cuánto tardan en pagarte.
 *
 * `?tipo=cobrar` (ventas, por defecto) o `?tipo=pagar` (compras). Los dos lados
 * usan exactamente la misma aritmética —`lib/erp/cartera.ts`— porque una cuenta
 * por pagar es una por cobrar mirada desde el otro lado, y tener dos
 * implementaciones sería garantizar que un día no coincidan.
 */

export async function GET(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { searchParams } = new URL(request.url);
  const tipo = searchParams.get("tipo") === "pagar" ? "pagar" : "cobrar";
  const esVenta = tipo === "cobrar";

  const hoy = hoyEnParaguay();
  const columna = esVenta ? "venta_id" : "compra_id";

  // La lectura vive en `lib/erp/cartera-leer.ts`: el chat y el Informe de
  // impacto leen la misma, así "cuánto me deben" da igual en todos lados.
  let cartera: CarteraLeida;
  try {
    cartera = await leerCartera(adminSinTipos(), puerta.usuarioId, tipo);
  } catch (error) {
    // Sin las cobranzas los saldos saldrían iguales al total, o sea mal. Es
    // mejor no responder que responder una cartera inflada.
    console.error("ERP: no se pudo leer la cartera:", error);
    return NextResponse.json(
      { error: "No pudimos leer tu estado de cuenta." },
      { status: 503, headers: noStore() },
    );
  }

  const { documentos, cobranzas } = cartera;

  const pendientes = documentos.filter(estaPendiente);
  const monedas = [...new Set(pendientes.map((d) => d.moneda))].sort();

  // El DSO necesita cruzar cada cobro con la fecha de SU documento, que es
  // dato que solo se tiene acá: la tabla de cobranzas no la guarda (sería
  // duplicarla y dejar que se desincronice).
  const fechaDeDocumento = new Map(documentos.map((d) => [d.id, d.fecha]));
  const cobros: CobroConDocumento[] = cobranzas.flatMap((c) => {
    const docId = c[columna] as string | null;
    const fechaDoc = docId ? fechaDeDocumento.get(docId) : undefined;
    if (!fechaDoc) return [];
    return [
      {
        fechaDocumento: fechaDoc,
        fechaCobro: String(c.fecha),
        monto: Number(c.monto ?? 0),
        moneda: monedaConocida(c.moneda as string | null),
      },
    ];
  });

  return NextResponse.json(
    {
      tipo,
      hoy,
      monedas: monedas.map((moneda) => ({
        ...antiguedad(pendientes, moneda, hoy),
        dias_promedio: diasPromedioDeCobro(cobros, moneda),
      })),
      // Los vencidos van con su saldo ya calculado: la pantalla no tiene que
      // volver a restar, que es donde se cuelan las diferencias.
      vencidos: vencidos(pendientes, hoy)
        .slice(0, 50)
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
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
