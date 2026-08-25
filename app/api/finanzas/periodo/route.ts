import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { registrarAuditoria } from "@/lib/auditoria/registrar";
import { hoyEnParaguay } from "@/lib/fecha";
import {
  aCSV,
  resumirEnPalabras,
  resumirPeriodo,
  type MovimientoDelPeriodo,
} from "@/lib/finanzas/periodoFiscal";

export const dynamic = "force-dynamic";

/**
 * El período, listo para llevarle al contador.
 *
 * Es lo que la hoja de ruta llama "trámites preparados automáticamente",
 * hasta donde se puede llegar con honestidad: EOS junta, ordena y avisa qué
 * falta. **No calcula el impuesto ni presenta la declaración** — lo primero es
 * criterio contable sobre el negocio del usuario y lo segundo exige su clave
 * fiscal, que este sistema no debe manejar.
 *
 * `?formato=csv` devuelve el archivo que un contador abre sin preguntar nada.
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

  const url = new URL(request.url);
  const hoy = hoyEnParaguay();

  // Por defecto, el mes en curso: es el período que alguien mira cuando entra
  // sin pedir nada en particular.
  const desde = fecha(url.searchParams.get("desde")) ?? `${hoy.slice(0, 7)}-01`;
  const hasta = fecha(url.searchParams.get("hasta")) ?? hoy;

  if (desde > hasta) {
    return NextResponse.json(
      { error: "El período empieza después de terminar." },
      { status: 400, headers: noStore() },
    );
  }

  const { data, error } = await supabase
    .from("eos_movimientos_financieros")
    .select("tipo,monto,moneda,fecha,descripcion,categoria,origen,documento_id")
    .eq("usuario_id", user.id)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: true });

  if (error) {
    console.error("No se pudo leer el período:", error);
    return NextResponse.json(
      { error: "No pudimos armar el resumen del período." },
      { status: 500, headers: noStore() },
    );
  }

  const movimientos = ((data ?? []) as Record<string, unknown>[]).map<MovimientoDelPeriodo>((m) => ({
    tipo: m.tipo as MovimientoDelPeriodo["tipo"],
    monto: Number(m.monto) || 0,
    moneda: (m.moneda as string) ?? "PYG",
    fecha: m.fecha as string,
    descripcion: (m.descripcion as string | null) ?? null,
    categoria: (m.categoria as string | null) ?? null,
    origen: (m.origen as string) ?? "manual",
    documento_id: (m.documento_id as string | null) ?? null,
  }));

  const resumen = resumirPeriodo(movimientos, { desde, hasta });

  if (url.searchParams.get("formato") === "csv") {
    // Descargar el período completo es sacar datos financieros del sistema:
    // queda asentado igual que la exportación de la cuenta.
    await registrarAuditoria(createAdminClient() as never, {
      usuarioId: user.id,
      evento: "datos_exportados",
      origen: "panel",
      resumen: `Descargaste el período ${desde} a ${hasta} para tu contador.`,
      detalle: { desde, hasta, movimientos: resumen.movimientos.length },
    });

    // El BOM va adelante del contenido: sin él, Excel abre el archivo en la
    // codificación del sistema y "Combustible" llega como "Combustible".
    return new Response(`﻿${aCSV(resumen)}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="eos-periodo-${desde}-a-${hasta}.csv"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  }

  return NextResponse.json(
    {
      resumen,
      en_palabras: resumirEnPalabras(resumen, movimientos[0]?.moneda ?? "PYG"),
      // Que EOS no declare por vos no es una limitación técnica que vayamos a
      // resolver: es una decisión. La interfaz tiene que poder decirlo.
      eos_no_declara: true,
    },
    { headers: noStore() },
  );
}

function fecha(valor: string | null): string | null {
  return valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
