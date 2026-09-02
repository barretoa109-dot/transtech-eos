import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { verificarModulo } from "@/lib/modulos/acceso";
import { calcular, insumosFaltantes } from "@/lib/kpi/motor";
import { periodoAnterior } from "@/lib/kpi/periodo";
import { CATALOGO, definicionesDe, resolver } from "@/lib/kpi/registro";
import { leerHechos } from "@/lib/kpi/leer";
import { hoyEnParaguay } from "@/lib/fecha";
import type { DefinicionKPI, Familia } from "@/lib/kpi/tipos";

export const dynamic = "force-dynamic";

/**
 * Una ruta, no cuatro cáscaras.
 *
 * `eos-kpis`, `eos-tendencias`, `eos-recomendaciones` y `eos-seguimientos`
 * son cuatro `select * … limit N` sobre tablas que llenaba n8n, sin ninguna
 * lógica. Acá el cálculo lo hace el motor (`lib/kpi/motor.ts`) sobre datos
 * leídos una sola vez por pedido; agregar un indicador nuevo es agregar una
 * definición al registro (`lib/kpi/registro.ts`), no una ruta.
 *
 * `?id=roi,margen_bruto` pide indicadores puntuales; `?familia=ventas` pide
 * una familia entera; sin ninguno de los dos, el catálogo completo.
 *
 * Erp y CRM son módulos contratables — quien no los tiene igual ve sus
 * indicadores de finanzas (que no son un anexo), y el motor no rompe con lo
 * que falta: `insumosFaltantes` dice cuáles quedaron afuera y por qué, para
 * que la pantalla pueda ofrecer el módulo en vez de mostrar un error.
 */

const FAMILIAS: Familia[] = ["finanzas", "ventas", "crm", "cartera", "inventario", "compras"];

function esFamilia(valor: string | null): valor is Familia {
  return valor !== null && (FAMILIAS as string[]).includes(valor);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });
  }

  const { searchParams } = new URL(request.url);
  const idsPedidos = (searchParams.get("id") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const familiaPedida = searchParams.get("familia");

  const definiciones: DefinicionKPI[] = idsPedidos.length > 0
    ? resolver(idsPedidos)
    : esFamilia(familiaPedida)
      ? definicionesDe(familiaPedida)
      : CATALOGO;

  const [erp, crm] = await Promise.all([verificarModulo("erp"), verificarModulo("crm")]);

  const admin = adminSinTipos();
  const hoy = hoyEnParaguay();
  const periodo = { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  // El rango de consulta cubre el período pedido Y el anterior de igual
  // largo, en una sola vuelta a la base: el motor va a pedirle el cálculo a
  // cada definición para los dos períodos, sobre los mismos datos.
  const rango = { desde: periodoAnterior(periodo).desde, hasta: periodo.hasta };

  const hechos = await leerHechos(admin, user.id, rango, {
    erp: erp.permitido,
    crm: crm.permitido,
  });

  const resultados = calcular(definiciones, hechos, periodo);
  const faltan = insumosFaltantes(definiciones, hechos);

  return NextResponse.json({ resultados, periodo, faltan }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
