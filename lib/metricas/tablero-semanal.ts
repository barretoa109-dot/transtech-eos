/**
 * El tablero de los viernes (metricas-01 del tablero de lanzamiento).
 *
 * Un correo interno, los viernes a la mañana, con los números que dicen si EOS
 * va bien: cuántas cuentas lo usan de verdad, cuántas nuevas llegan a su
 * primer valor en 24 horas, cuántas pagan, cuántas siguen a los 30 días,
 * cuánto falla y cuánto tarda. Cada número contra el de la semana anterior.
 *
 * Los números salen de `eos_tablero_semanal_v213` (v213): siempre la misma
 * cuenta, sin armarla a mano. Solo cuentas reales y solo conteos: el correo no
 * lleva nombres ni correos de nadie.
 *
 * Dos números del tablero todavía no existen y se dicen así, en vez de
 * esconderse: las descargas (no hay apps publicadas) y la pregunta de la
 * ausencia (no está construida).
 */

export type Semana = {
  desde: string;
  hasta: string;
  reales: number;
  nuevas: number;
  cohorte_24h: number;
  activadas_24h: number;
  activas: number;
  acciones_ok: number;
  acciones_error: number;
  pagando: number;
  base_30d: number;
  retenidas_30d: number;
  mensajes: number;
  mensajes_whatsapp: number;
  latencia_p50_ms: number | null;
  latencia_p90_ms: number | null;
};

type ClienteRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const entero = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const talVez = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : entero(v));

export function leerFila(data: unknown): Semana {
  const f = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  return {
    desde: String(f.desde ?? ""),
    hasta: String(f.hasta ?? ""),
    reales: entero(f.reales),
    nuevas: entero(f.nuevas),
    cohorte_24h: entero(f.cohorte_24h),
    activadas_24h: entero(f.activadas_24h),
    activas: entero(f.activas),
    acciones_ok: entero(f.acciones_ok),
    acciones_error: entero(f.acciones_error),
    pagando: entero(f.pagando),
    base_30d: entero(f.base_30d),
    retenidas_30d: entero(f.retenidas_30d),
    mensajes: entero(f.mensajes),
    mensajes_whatsapp: entero(f.mensajes_whatsapp),
    latencia_p50_ms: talVez(f.latencia_p50_ms),
    latencia_p90_ms: talVez(f.latencia_p90_ms),
  };
}

export async function leerSemana(admin: ClienteRpc, hasta: Date): Promise<Semana> {
  const { data, error } = await admin.rpc("eos_tablero_semanal_v213", { p_hasta: hasta.toISOString() });
  if (error) throw new Error(error.message);
  return leerFila(data);
}

/** Porcentaje entero, o null si no hay base: "0 de 0" no es un 0 %. */
export function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 100) : null;
}

const segundos = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);

export type Fila = { nombre: string; valor: string; antes: string; meta: string; alerta: boolean };

/**
 * Las filas del tablero, en el orden del tablero de lanzamiento. `alerta`
 * marca lo que está del lado malo de su meta: es lo primero que se mira.
 */
export function filasDelTablero(actual: Semana, anterior: Semana): Fila[] {
  const errorPct = (s: Semana) => porcentaje(s.acciones_error, s.acciones_ok + s.acciones_error);
  const activadasPct = (s: Semana) => porcentaje(s.activadas_24h, s.cohorte_24h);
  const retencionPct = (s: Semana) => porcentaje(s.retenidas_30d, s.base_30d);
  const porActiva = (s: Semana) => (s.activas > 0 ? (s.acciones_ok / s.activas).toFixed(1).replace(".", ",") : "—");
  const pct = (n: number | null) => (n === null ? "—" : `${n} %`);
  const deCuantas = (p: number | null, parte: number, total: number) =>
    total > 0 ? `${pct(p)} (${parte} de ${total})` : "sin cuentas para medir";

  const err = errorPct(actual);
  const act = activadasPct(actual);
  const ret = retencionPct(actual);

  return [
    { nombre: "Descargas de la app", valor: "—", antes: "—", meta: "se mide cuando estén las apps", alerta: false },
    {
      nombre: "Cuentas nuevas",
      valor: String(actual.nuevas),
      antes: String(anterior.nuevas),
      meta: "crecer semana a semana",
      alerta: false,
    },
    {
      nombre: "Activadas en 24 horas",
      valor: deCuantas(act, actual.activadas_24h, actual.cohorte_24h),
      antes: pct(activadasPct(anterior)),
      meta: "la mayoría",
      alerta: act !== null && act < 50,
    },
    {
      nombre: "Activas en la semana",
      valor: String(actual.activas),
      antes: String(anterior.activas),
      meta: "crecer semana a semana",
      alerta: actual.activas < anterior.activas,
    },
    {
      nombre: "Acciones por cuenta activa",
      valor: porActiva(actual),
      antes: porActiva(anterior),
      meta: "la estrella polar",
      alerta: false,
    },
    {
      nombre: "Cuentas que pagan",
      valor: String(actual.pagando),
      antes: String(anterior.pagando),
      meta: "30 a los 90 días del lanzamiento",
      alerta: actual.pagando < anterior.pagando,
    },
    {
      nombre: "Siguen a los 30 días",
      valor: deCuantas(ret, actual.retenidas_30d, actual.base_30d),
      antes: pct(retencionPct(anterior)),
      meta: "60 % o más",
      alerta: ret !== null && ret < 60,
    },
    {
      nombre: "Error del circuito",
      valor: `${pct(err)} (${actual.acciones_error} de ${actual.acciones_ok + actual.acciones_error})`,
      antes: pct(errorPct(anterior)),
      meta: "menos de 2 %",
      alerta: err !== null && err >= 2,
    },
    {
      nombre: "Respuesta del servidor (mediana)",
      valor: segundos(actual.latencia_p50_ms),
      antes: segundos(anterior.latencia_p50_ms),
      meta: "menos de 8 s de punta a punta",
      alerta: actual.latencia_p50_ms !== null && actual.latencia_p50_ms >= 8000,
    },
    {
      nombre: "Mensajes (por WhatsApp)",
      valor: `${actual.mensajes} (${actual.mensajes_whatsapp})`,
      antes: `${anterior.mensajes} (${anterior.mensajes_whatsapp})`,
      meta: "",
      alerta: false,
    },
    {
      nombre: "Pregunta de la ausencia",
      valor: "—",
      antes: "—",
      meta: "todavía no está construida",
      alerta: false,
    },
  ];
}

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function redactarTablero(actual: Semana, anterior: Semana, fecha: string) {
  const filas = filasDelTablero(actual, anterior);
  const alertas = filas.filter((f) => f.alerta);
  const asunto = `EOS · tablero del viernes ${fecha}${alertas.length ? ` · ${alertas.length} para mirar` : ""}`;

  const texto = [
    `Tablero de la semana (${actual.reales} cuentas reales)`,
    "",
    ...filas.map(
      (f) => `${f.alerta ? "!! " : ""}${f.nombre}: ${f.valor} (semana anterior: ${f.antes})${f.meta ? ` · meta: ${f.meta}` : ""}`,
    ),
    "",
    "Solo cuentas reales. Los números salen de eos_tablero_semanal_v213.",
  ].join("\n");

  const celda = "padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top";
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">
<p style="margin:0 0 12px"><strong>Tablero de la semana</strong> · ${actual.reales} cuentas reales</p>
<table style="border-collapse:collapse;width:100%;max-width:640px">
<tr><th style="${celda};text-align:left;color:#64748b;font-weight:500">Número</th><th style="${celda};text-align:left;color:#64748b;font-weight:500">Esta semana</th><th style="${celda};text-align:left;color:#64748b;font-weight:500">Anterior</th><th style="${celda};text-align:left;color:#64748b;font-weight:500">Meta</th></tr>
${filas
  .map(
    (f) =>
      `<tr><td style="${celda}">${f.alerta ? '<span style="color:#b45309">●</span> ' : ""}${escapar(f.nombre)}</td><td style="${celda};font-weight:600">${escapar(f.valor)}</td><td style="${celda};color:#64748b">${escapar(f.antes)}</td><td style="${celda};color:#64748b">${escapar(f.meta)}</td></tr>`,
  )
  .join("\n")}
</table>
<p style="margin:14px 0 0;font-size:12px;color:#64748b">Solo cuentas reales, sin QA. Los números salen de eos_tablero_semanal_v213. El punto naranja marca lo que está del lado malo de su meta.</p>
</div>`;

  return { asunto, texto, html };
}

/** El viernes se decide con la fecha de Paraguay, no con la del servidor. */
export function esViernes(hoyPY: string): boolean {
  const [a, m, d] = hoyPY.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay() === 5;
}

type Envio = (correo: { para: string[]; asunto: string; html: string; texto: string }) => Promise<void>;

/**
 * Manda el tablero si hoy es viernes en Paraguay. Devuelve si lo mandó.
 * Corre desde el cron diario; si el cron se repite el mismo viernes, sale dos
 * veces, y se acepta: es un correo interno y una tabla de envíos para esto
 * sería más de lo que protege.
 */
export async function enviarTableroDeLosViernes(
  admin: ClienteRpc,
  opciones: { hoyPY: string; ahora?: Date; destinos: string[]; enviar: Envio },
): Promise<boolean> {
  if (!esViernes(opciones.hoyPY)) return false;
  if (opciones.destinos.length === 0) {
    console.error("Tablero: falta ADMIN_EMAILS; no se manda.");
    return false;
  }
  const ahora = opciones.ahora ?? new Date();
  const hace7 = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [actual, anterior] = await Promise.all([leerSemana(admin, ahora), leerSemana(admin, hace7)]);
  const { asunto, html, texto } = redactarTablero(actual, anterior, opciones.hoyPY);
  await opciones.enviar({ para: opciones.destinos, asunto, html, texto });
  return true;
}
