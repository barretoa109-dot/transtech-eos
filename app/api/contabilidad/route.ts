import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { exigirModulo, verificarModulo } from "@/lib/modulos/acceso";
import { leerHechos } from "@/lib/kpi/leer";
import { hoyEnParaguay } from "@/lib/fecha";
import { monedaConocida } from "@/lib/finanzas/monedas";
import { valorInventario } from "@/lib/erp/kardex";
import { estadoDeResultados, margenOperativo } from "@/lib/contabilidad/resultado";
import { leerCapitalDeTrabajo, posicion, type CuotaDeuda } from "@/lib/contabilidad/posicion";
import { empresaDe, saldosDeCaja } from "@/lib/empresa/acceso";
import type { DocumentoCartera } from "@/lib/erp/cartera";

export const dynamic = "force-dynamic";

/**
 * El resultado del período y la posición del negocio.
 *
 * NO es contabilidad. `docs/erp-profesional-arquitectura.md` deja el libro
 * mayor fuera del alcance y prohíbe inventar equivalencias tributarias, así
 * que acá no hay asientos, ni plan de cuentas, ni impuestos. Lo que hay es lo
 * que se puede afirmar con los documentos que el negocio ya cargó, y cada
 * respuesta viaja con la lista de lo que le falta para ser un balance.
 *
 * `?desde=&hasta=` acota el período; sin eso, el mes en curso.
 */

export async function GET(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });
  }

  const { searchParams } = new URL(request.url);
  const hoy = hoyEnParaguay();
  const periodo = {
    desde: fechaValida(searchParams.get("desde")) ?? `${hoy.slice(0, 7)}-01`,
    hasta: fechaValida(searchParams.get("hasta")) ?? hoy,
  };

  if (periodo.desde > periodo.hasta) {
    return NextResponse.json(
      { error: "El período empieza después de terminar." },
      { status: 400, headers: noStore() },
    );
  }

  const crm = await verificarModulo("crm");
  const admin = adminSinTipos();

  // Las ventas y compras se leen sin filtro de fecha (así lo hace
  // `leerHechos`), que es lo que necesita la posición: la cartera vieja
  // sigue siendo activo aunque el período sea el mes en curso.
  const hechos = await leerHechos(admin, user.id, periodo, { erp: true, crm: crm.permitido });

  // Las deudas son declaradas por la persona y viven del lado personal:
  // service_role no pasa por RLS, así que el filtro va a mano.
  const { data: filasDeuda, error } = await admin
    .from("eos_finanzas_deudas")
    .select("moneda,cuota_monto,cuotas_totales,cuotas_pagadas,estado")
    .eq("usuario_id", user.id)
    .neq("estado", "saldada");

  if (error) {
    console.error("Contabilidad: no se pudieron leer las deudas:", error);
    // Se sigue sin ellas: un pasivo incompleto declarado como incompleto es
    // mejor que no responder nada. La posición lo va a decir.
  }

  const deudas: CuotaDeuda[] = (filasDeuda ?? [])
    .filter((d: Record<string, unknown>) => Number(d.cuota_monto ?? 0) > 0)
    .map((d: Record<string, unknown>) => {
      const totales = d.cuotas_totales === null ? null : Number(d.cuotas_totales);
      const pagadas = Number(d.cuotas_pagadas ?? 0);
      return {
        moneda: monedaConocida(d.moneda as string | null),
        cuota: Number(d.cuota_monto),
        restantes: totales === null ? null : Math.max(0, totales - pagadas),
      };
    });

  const comoDoc = (v: {
    id: string;
    fecha: string;
    vence_el: string | null;
    moneda: string | null;
    total: number;
    cobrado: number;
  }): DocumentoCartera => ({
    id: v.id,
    fecha: v.fecha,
    vence_el: v.vence_el,
    moneda: monedaConocida(v.moneda),
    total: v.total,
    cobrado: v.cobrado,
    contacto_id: null,
    contacto_nombre: null,
  });

  /*
   * La caja del negocio (v120). Sin ella la posición sale como salía antes:
   * un piso, declarado como tal. Con ella, la liquidez pasa a ser el número y
   * la prueba ácida existe por primera vez.
   */
  const empresaId = await empresaDe(admin, user.id);
  const caja = await saldosDeCaja(admin, empresaId, hoy);

  const resultados = estadoDeResultados(hechos, periodo);

  const posiciones = posicion({
    ventasPendientes: (hechos.ventas ?? []).filter((v) => v.estado === "emitida").map(comoDoc),
    comprasPendientes: (hechos.compras ?? []).filter((c) => c.estado === "registrada").map(comoDoc),
    inventario: valorInventario(
      (hechos.productos ?? []).map((p) => ({
        id: p.id,
        nombre: p.nombre,
        moneda: monedaConocida(p.moneda),
        activo: p.activo,
        controla_stock: p.controla_stock,
        stock_actual: p.stock_actual,
        costo_promedio: p.costo_promedio,
      })),
    ).map((v) => ({ moneda: v.moneda, valor: v.valor })),
    deudas,
    caja: caja.filter((s) => s.cajas > 0).map((s) => ({ moneda: s.moneda, saldo: s.saldo })),
  });

  return NextResponse.json(
    {
      periodo,
      resultados: resultados.map((r) => ({ ...r, margen_operativo: margenOperativo(r) })),
      posiciones: posiciones.map((p) => ({ ...p, lectura: leerCapitalDeTrabajo(p) })),
      // Los avisos de la caja viajan aparte: hablan de la CALIDAD del saldo
      // —cuántos días tiene, cuántas cajas quedaron sin cargar— y no de la
      // posición en sí.
      caja,
      // Si la lectura de deudas falló, el pasivo está corto y hay que decirlo
      // acá: la posición no puede saber que la consulta se cayó.
      ...(error ? { aviso: "No se pudieron leer las deudas: el pasivo puede estar incompleto." } : {}),
    },
    { headers: noStore() },
  );
}

/** Solo `AAAA-MM-DD`. Cualquier otra cosa se ignora y se usa el defecto. */
function fechaValida(valor: string | null): string | null {
  if (valor === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
