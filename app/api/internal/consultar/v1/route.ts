import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { calcular } from "@/lib/kpi/motor";
import { periodoAnterior } from "@/lib/kpi/periodo";
import { CATALOGO, CON_UMBRALES } from "@/lib/kpi/registro";
import { leerHechos } from "@/lib/kpi/leer";
import { detectarAnomalias } from "@/lib/kpi/anomalias";
import { scorePrincipal, monedaPrincipal } from "@/lib/kpi/twin";
import { ejecutar, HERRAMIENTAS, type Contexto } from "@/lib/eos/tools";
import { hoyEnParaguay } from "@/lib/fecha";
import { paraRegistro } from "@/lib/seguridad/registro";
import type { PuntoHistoria } from "@/lib/kpi/historia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * La puerta por la que el modelo consulta datos del negocio.
 *
 * ============================================================
 * POR QUÉ ES UNA RUTA INTERNA Y NO UNA PÚBLICA
 * ============================================================
 *
 * La llama el runtime del agente en nombre de un usuario, no el navegador de
 * ese usuario. Por eso se autentica con `EOS_WORKER_GATE_SECRET` —el mismo
 * mecanismo que ya usan `worker-authorize` y `action-effects`— y recibe el
 * `usuario_id` en el cuerpo.
 *
 * Eso la hace peligrosa si el secreto se filtra, igual que las otras dos. La
 * mitigación es la misma y hay una más: **acá no se escribe nada**. El peor
 * caso de esta ruta es una lectura indebida; el de una ruta de escritura sería
 * una venta inventada.
 *
 * ============================================================
 * SIRVE A LOS DOS MUNDOS
 * ============================================================
 *
 * Hoy el loop del agente vive en n8n y podría llamar acá. Mañana, cuando se
 * complete la etapa 1 de `docs/salida-de-n8n.md`, el loop en TypeScript va a
 * llamar a `lib/eos/tools.ts` directamente, sin pasar por HTTP.
 *
 * Las dos formas ejecutan EL MISMO registro, así que la respuesta no puede
 * depender de dónde corra el modelo. Eso es lo que hace que la migración de
 * n8n no tenga que reescribir las herramientas.
 *
 * `GET` devuelve el catálogo para que el runtime arme su esquema de
 * function-calling sin tener que hardcodearlo.
 */

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}

function autorizado(request: Request) {
  const esperado = process.env.EOS_WORKER_GATE_SECRET;
  if (!esperado) return { ok: false, sinConfigurar: true };

  const cabecera = request.headers.get("authorization") || "";
  const recibido = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!recibido) return { ok: false, sinConfigurar: false };

  const a = Buffer.from(esperado);
  const b = Buffer.from(recibido);
  if (a.length !== b.length) return { ok: false, sinConfigurar: false };

  return { ok: timingSafeEqual(a, b), sinConfigurar: false };
}

function esUuid(valor: unknown): valor is string {
  return (
    typeof valor === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor)
  );
}

export async function GET(request: Request) {
  const puerta = autorizado(request);
  if (!puerta.ok) {
    return NextResponse.json(
      { error: puerta.sinConfigurar ? "No configurado." : "No autorizado." },
      { status: puerta.sinConfigurar ? 503 : 401, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json({ herramientas: HERRAMIENTAS }, { headers: noStoreHeaders() });
}

export async function POST(request: Request) {
  const puerta = autorizado(request);
  if (!puerta.ok) {
    return NextResponse.json(
      { error: puerta.sinConfigurar ? "No configurado." : "No autorizado." },
      { status: puerta.sinConfigurar ? 503 : 401, headers: noStoreHeaders() },
    );
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStoreHeaders() });
  }

  const usuarioId = cuerpo.usuario_id;
  const herramienta = String(cuerpo.herramienta ?? "").trim();
  const argumentos = (cuerpo.argumentos ?? {}) as Record<string, unknown>;

  if (!esUuid(usuarioId)) {
    return NextResponse.json({ error: "usuario_id inválido." }, { status: 400, headers: noStoreHeaders() });
  }
  if (!herramienta) {
    return NextResponse.json({ error: "Falta la herramienta." }, { status: 400, headers: noStoreHeaders() });
  }

  const admin = adminSinTipos();
  const hoy = hoyEnParaguay();
  const periodo = { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  const anterior = periodoAnterior(periodo);

  /*
   * El módulo NO se verifica con `verificarModulo`, que lee la sesión del
   * navegador y acá no hay ninguna. Se consulta por usuario con la función de
   * la base, que es la misma fuente.
   */
  const [{ data: tieneErp }, { data: tieneCrm }] = await Promise.all([
    admin.rpc("eos_tiene_modulo", { p_usuario_id: usuarioId, p_modulo: "erp" }),
    admin.rpc("eos_tiene_modulo", { p_usuario_id: usuarioId, p_modulo: "crm" }),
  ]);

  const hechos = await leerHechos(
    admin,
    usuarioId,
    { desde: anterior.desde, hasta: periodo.hasta },
    { erp: tieneErp === true, crm: tieneCrm === true },
  );

  const resultados = calcular(CATALOGO, hechos, periodo);

  // La historia solo se lee para la herramienta que la usa: traer 60 días de
  // 24 indicadores en cada consulta del chat sería pagar por lo que casi
  // ninguna pregunta necesita.
  const series = new Map<string, PuntoHistoria[]>();
  if (herramienta === "ver_historia") {
    const desde = new Date(Date.parse(`${hoy}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
    const { data: filas } = await admin
      .from("eos_kpi_historia_v105")
      .select("indicador,moneda,fecha,valor,confianza,motivo")
      .eq("usuario_id", usuarioId)
      .gte("fecha", desde)
      .order("fecha", { ascending: true });

    for (const f of (filas ?? []) as Record<string, unknown>[]) {
      const clave = `${String(f.indicador)}:${String(f.moneda)}`;
      const lista = series.get(clave) ?? [];
      lista.push({
        fecha: String(f.fecha),
        valor: f.valor === null || f.valor === undefined ? null : Number(f.valor),
        confianza: Number(f.confianza ?? 1),
        motivo: (f.motivo as string | null) ?? null,
      });
      series.set(clave, lista);
    }
  }

  const contexto: Contexto = {
    resultados,
    anomalias: detectarAnomalias(resultados.map((r) => ({ resultado: r }))),
    score: scorePrincipal(resultados, CON_UMBRALES),
    hechos,
    periodo,
    anterior,
    series,
    monedaPrincipal: monedaPrincipal(resultados),
  };

  const respuesta = ejecutar(herramienta, argumentos, contexto);

  // Se registra QUÉ se preguntó, nunca la respuesta: el texto lleva cifras del
  // negocio de una persona y los logs no son el lugar. Misma regla que
  // `lib/seguridad/registro.ts` impone en el resto del proyecto.
  console.log("Consulta del chat:", paraRegistro({ herramienta, ok: respuesta.ok }));

  return NextResponse.json(respuesta, {
    status: respuesta.ok ? 200 : 400,
    headers: noStoreHeaders(),
  });
}
