import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { modulosDelUsuario } from "@/lib/modulos/acceso";
import { diasRestantes, porVencer, type ModuloActivo } from "@/lib/modulos/catalogo";

export const dynamic = "force-dynamic";

/**
 * Qué anexos tiene el usuario y cuáles podría sumar.
 *
 * Devuelve las dos cosas juntas porque la pantalla las necesita juntas: para
 * mostrar "ERP · activo" y "CRM · sumalo" en la misma lista hay que saber qué
 * existe y qué está contratado, y hacerlo en dos llamadas dejaría un parpadeo
 * en el que un módulo activo se ve como disponible.
 *
 * El catálogo sale de `eos_modulos` con RLS: la política solo deja ver los que
 * están `activo` y `es_publico`. Un módulo interno del ecosistema no se filtra
 * acá por una condición del código —que alguien podría olvidar— sino porque la
 * base directamente no lo devuelve.
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

  const [activos, catalogoRes] = await Promise.all([
    modulosDelUsuario(),
    supabase
      .from("eos_modulos")
      .select("codigo,nombre,descripcion,precio_mensual_pyg,precio_anual_pyg,plan_minimo,orden")
      .order("orden", { ascending: true }),
  ]);

  if (catalogoRes.error) {
    console.error("Módulos: no se pudo leer el catálogo:", catalogoRes.error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const activosPorCodigo = new Map(activos.map((m) => [m.codigo, m]));

  const catalogo = ((catalogoRes.data ?? []) as Record<string, unknown>[]).map((m) => {
    const codigo = String(m.codigo);
    const activo = activosPorCodigo.get(codigo) ?? null;

    return {
      codigo,
      nombre: String(m.nombre),
      descripcion: (m.descripcion as string | null) ?? null,
      precio_mensual_pyg: Number(m.precio_mensual_pyg ?? 0),
      precio_anual_pyg: Number(m.precio_anual_pyg ?? 0),
      plan_minimo: (m.plan_minimo as string | null) ?? null,
      contratado: activo !== null,
      ...(activo ? detalleVigencia(activo) : {}),
    };
  });

  // Un módulo interno o de cortesía no está en el catálogo público, pero el
  // usuario que lo tiene sí tiene que verlo: si no, tendría acceso a algo que
  // su propia pantalla de cuenta le dice que no tiene.
  const fueraDelCatalogo = activos
    .filter((m) => !catalogo.some((c) => c.codigo === m.codigo))
    .map((m) => ({
      codigo: m.codigo,
      nombre: m.nombre,
      descripcion: null,
      precio_mensual_pyg: 0,
      precio_anual_pyg: 0,
      plan_minimo: null,
      contratado: true,
      ...detalleVigencia(m),
    }));

  return NextResponse.json(
    { modulos: [...catalogo, ...fueraDelCatalogo] },
    { headers: noStore() },
  );
}

function detalleVigencia(modulo: ModuloActivo) {
  return {
    vencimiento: modulo.vencimiento,
    dias_restantes: diasRestantes(modulo),
    por_vencer: porVencer(modulo),
    origen: modulo.origen,
  };
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
