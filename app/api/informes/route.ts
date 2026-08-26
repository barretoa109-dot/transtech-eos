import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay } from "@/lib/fecha";
import { conciliar } from "@/lib/finanzas/conciliacion";
import { armarInforme, type DeudaInforme, type MovimientoInforme } from "@/lib/informes/armar";
import { crearExcelInforme } from "@/lib/informes/excel";
import { crearPdfInforme } from "@/lib/informes/pdf";
import { crearWordInforme } from "@/lib/informes/word";
import { esClavePeriodo, resolverPeriodo, type ClavePeriodo } from "@/lib/informes/periodo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El informe que pidió el usuario, con SUS datos.
 *
 * Esto es lo que `app/descargar` nunca fue: aquella ruta entrega una plantilla
 * vacía para que alguien la llene a mano, y por eso puede ser pública. Ésta
 * entrega el balance real, así que:
 *
 *  - **EXIGE SESIÓN.** Sin `getUser()` válido no sale nada. Es la diferencia
 *    entre servir un formulario y servir la plata de una persona.
 *  - **NO ACEPTA UN `usuario_id` DEL CLIENTE.** El id sale de la sesión y de
 *    ningún otro lado. Un parámetro de usuario en una ruta que devuelve
 *    finanzas es una fuga esperando que alguien cambie un número en la URL.
 *  - **NO SE CACHEA.** Ni en el navegador ni en un proxy: dos personas en la
 *    misma oficina no pueden recibir el balance de la otra.
 *
 * El formato no cambia el contenido: los tres salen del mismo `armarInforme`.
 * Ver `lib/informes/armar.ts` para por qué eso importa.
 */

const FORMATOS = {
  excel: {
    extension: "xlsx",
    tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pdf: { extension: "pdf", tipo: "application/pdf" },
  word: {
    extension: "docx",
    tipo: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
} as const;

type Formato = keyof typeof FORMATOS;

/** Tope de filas por informe: un año de movimientos no puede colgar la ruta. */
const MAX_MOVIMIENTOS = 5_000;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const { searchParams } = new URL(request.url);

  const formato = (searchParams.get("formato") ?? "excel").toLowerCase();
  if (!(formato in FORMATOS)) {
    return NextResponse.json(
      { error: "Formato no soportado. Usá excel, pdf o word." },
      { status: 400, headers: noStore() },
    );
  }

  const pedido = (searchParams.get("periodo") ?? "mes").toLowerCase();
  const clave: ClavePeriodo = esClavePeriodo(pedido) ? pedido : "mes";

  const hoy = hoyEnParaguay();
  const periodo = resolverPeriodo(clave, hoy, {
    desde: searchParams.get("desde") ?? undefined,
    hasta: searchParams.get("hasta") ?? undefined,
  });

  const [politicaRes, movimientosRes, conciliacionesRes, deudasRes] = await Promise.all([
    supabase
      .from("eos_finanzas_politica")
      .select("moneda,saldo_inicial,saldo_inicial_fecha")
      .eq("usuario_id", user.id)
      .maybeSingle(),
    supabase
      .from("eos_movimientos_financieros")
      .select("tipo,monto,fecha,descripcion,categoria")
      .eq("usuario_id", user.id)
      .gte("fecha", periodo.desde)
      .lte("fecha", periodo.hasta)
      .order("fecha", { ascending: true })
      .limit(MAX_MOVIMIENTOS),
    supabase
      .from("eos_finanzas_conciliaciones")
      .select("fecha,saldo_declarado")
      .eq("usuario_id", user.id)
      .order("fecha", { ascending: true }),
    supabase
      .from("eos_finanzas_deudas")
      .select("acreedor,tipo,moneda,saldo_declarado,saldo_declarado_el,cuota_monto,estado")
      .eq("usuario_id", user.id)
      .neq("estado", "saldada"),
  ]);

  // Sin Constitución Financiera no se arma un balance: no hay moneda definida
  // ni punto de partida, y un informe con supuestos inventados es justamente
  // lo que no queremos que alguien lleve a su contador.
  if (!politicaRes.data) {
    return NextResponse.json(
      { error: "Todavía no configuraste tus finanzas. EOS necesita eso para armar un balance." },
      { status: 409, headers: noStore() },
    );
  }

  if (movimientosRes.error) {
    console.error("Informe: no se pudieron leer los movimientos:", movimientosRes.error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const politica = politicaRes.data as {
    moneda: string | null;
    saldo_inicial: number | string | null;
    saldo_inicial_fecha: string;
  };

  const movimientos = ((movimientosRes.data ?? []) as Record<string, unknown>[]).map<MovimientoInforme>(
    (m) => ({
      tipo: m.tipo as MovimientoInforme["tipo"],
      monto: num(m.monto),
      fecha: String(m.fecha).slice(0, 10),
      descripcion: (m.descripcion as string | null) ?? null,
      categoria: (m.categoria as string | null) ?? null,
    }),
  );

  // Cuánto se le escapa al usuario sin que EOS lo vea. Solo se puede saber si
  // ya conció al menos dos veces; si no, `ritmo_diario` es null y el informe
  // usa la advertencia genérica.
  const estado = conciliar({
    saldoInicial: num(politica.saldo_inicial),
    saldoInicialFecha: politica.saldo_inicial_fecha,
    conciliaciones: ((conciliacionesRes.data ?? []) as Record<string, unknown>[]).map((c) => ({
      fecha: c.fecha as string,
      saldo_declarado: num(c.saldo_declarado),
    })),
    movimientos,
    hoy,
  });

  const dias = diasEntre(periodo.desde, periodo.hasta) + 1;
  const invisibleDelPeriodo =
    estado.ritmo_diario !== null ? Math.max(0, estado.ritmo_diario * dias) : 0;

  const informe = armarInforme({
    periodo,
    moneda: politica.moneda ?? "PYG",
    hoy,
    movimientos,
    deudas: ((deudasRes.data ?? []) as unknown as DeudaInforme[]).map((d) => ({
      ...d,
      saldo_declarado: num(d.saldo_declarado),
      cuota_monto: d.cuota_monto === null ? null : num(d.cuota_monto),
    })),
    gastoInvisible: invisibleDelPeriodo,
  });

  const { extension, tipo } = FORMATOS[formato as Formato];

  let cuerpo: Buffer;
  try {
    cuerpo =
      formato === "excel"
        ? Buffer.from(await crearExcelInforme(informe))
        : formato === "pdf"
          ? await crearPdfInforme(informe)
          : await crearWordInforme(informe);
  } catch (error) {
    console.error(`Informe: falló la generación del ${formato}:`, error);
    return NextResponse.json(
      { error: "No pudimos generar el archivo." },
      { status: 500, headers: noStore() },
    );
  }

  const nombre = nombreArchivo(informe.titulo, periodo.desde, periodo.hasta, extension);

  return new Response(new Uint8Array(cuerpo), {
    status: 200,
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(cuerpo.length),
      // `filename*` con UTF-8 para que los acentos no lleguen rotos al disco.
      "Content-Disposition": `attachment; filename="${asciiPlano(nombre)}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** "balance-de-la-semana-2026-08-17-a-2026-08-23.xlsx" */
function nombreArchivo(titulo: string, desde: string, hasta: string, extension: string): string {
  const base = titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "balance"}-${desde}-a-${hasta}.${extension}`;
}

/**
 * El `filename` sin `*` viaja en un header, y un header no puede llevar
 * caracteres fuera de ASCII ni comillas: si se cuela uno, algunos clientes
 * descartan la cabecera entera y el archivo se baja como "download".
 */
function asciiPlano(nombre: string): string {
  return nombre.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
}

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function num(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
