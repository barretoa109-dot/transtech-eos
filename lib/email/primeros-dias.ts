import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { rubroDe } from "../eos/rubros.ts";
import { formatearMonto } from "../finanzas/formato.ts";
import { hoyEnParaguay } from "../fecha.ts";
import { escaparHtml, envolverEmailDeMarca, primerNombre } from "./marca.ts";
import { urlDeBaja } from "./motivacionales.ts";

/**
 * Los correos de la primera semana (inicio-04 del tablero de lanzamiento).
 *
 * El 29/09/2026, de 6 cuentas reales, 1 usaba EOS. Las otras se quedaron en
 * el primer día sin saber qué escribirle. La bienvenida sale una vez y el
 * motivacional habla de hábitos en general; ninguno mira qué hizo ESTA
 * persona. Estos tres sí:
 *
 *   día 1  qué pedirle a EOS, con un ejemplo de su rubro.
 *   día 3  SOLO si todavía no anotó nada: una sola frase para arrancar.
 *   día 7  lo que EOS hizo por ella esa semana, o qué la frenó.
 *
 * Reglas:
 *  - Solo cuentas reales, solo durante su primera semana (con unos días de
 *    margen por si el cron falló).
 *  - Es la misma familia que el motivacional: la misma baja de un clic los
 *    corta a los dos, y el motivacional no sale durante esta semana.
 *  - Se reclama antes de mandar (v216): nunca dos veces el mismo.
 *  - Nada de números inventados: el día 7 cuenta acciones que quedaron hechas.
 *  - Las respuestas van a soporte (`replyTo`): el "¿qué te frenó?" del día 7
 *    le llega a una persona.
 */

export type Paso = "dia1" | "dia3" | "dia7";

const TABLA = "eos_correos_primeros_dias_v216";
/** Hasta cuántos días después se sigue intentando cada paso, si el cron falló. */
const VENTANA: Record<Paso, [number, number]> = { dia1: [1, 2], dia3: [3, 5], dia7: [7, 9] };
export const RESPONDER_A = "soporte@transtech.com.py";

/** El paso que le toca hoy a una cuenta, o null. */
export function pasoDelDia(dias: number, anotoAlgo: boolean, yaRecibidos: ReadonlySet<Paso>): Paso | null {
  for (const paso of ["dia1", "dia3", "dia7"] as const) {
    const [desde, hasta] = VENTANA[paso];
    if (dias < desde || dias > hasta || yaRecibidos.has(paso)) continue;
    if (paso === "dia3" && anotoAlgo) continue;
    return paso;
  }
  return null;
}

export type DatosDeCuenta = {
  nombre: string | null;
  rubro: string | null;
  whatsappVinculado: boolean;
  /** Acciones que quedaron hechas, por verbo (REGISTRAR_VENTA: 4, ...). */
  acciones: Record<string, number>;
  /** Total vendido, en guaraníes, sin lo anulado. */
  vendido: number;
};

const EJEMPLO_GENERAL = "Vendí 2 unidades a 80 mil cada una";

function ejemploDeVenta(rubro: string | null): string {
  return rubroDe(rubro)?.venta ?? EJEMPLO_GENERAL;
}

const NOMBRES: Record<string, [string, string]> = {
  REGISTRAR_VENTA: ["venta", "ventas"],
  REGISTRAR_COMPRA: ["compra o gasto", "compras y gastos"],
  CREAR_PRODUCTO: ["carga de productos", "cargas de productos"],
  REGISTRAR_COBRO: ["cobro", "cobros"],
  CREAR_CONTACTO: ["contacto", "contactos"],
  CREAR_TAREA: ["recordatorio", "recordatorios"],
};

export function redactarPrimerosDias(
  paso: Paso,
  datos: DatosDeCuenta,
  urls: { chat: string; perfil: string; baja: string },
): { asunto: string; html: string; texto: string } {
  const nombre = primerNombre(datos.nombre);
  const saludo = nombre ? `Hola ${nombre},` : "Hola,";
  const ejemplo = ejemploDeVenta(datos.rubro);

  let titulo: string;
  let asunto: string;
  let parrafos: string[];
  let ctaTexto = "Abrir el chat";
  let ctaUrl = urls.chat;

  if (paso === "dia1") {
    asunto = "Tres cosas para pedirle hoy a EOS";
    titulo = "Tres cosas para pedirle hoy";
    parrafos = [
      saludo,
      `Contale una venta como se la contarías a alguien de confianza: «${ejemplo}». La anota con tu stock y tu caja.`,
      "Preguntale «¿quién me debe?» y te da la lista, de lo más atrasado a lo más nuevo, con el mensaje de cobro ya escrito.",
      "Al cerrar el día, preguntale «¿cuánto vendí hoy?».",
      ...(datos.whatsappVinculado
        ? []
        : [
            "Todo eso también funciona desde tu WhatsApp, como si le escribieras a una persona. Se conecta en tu perfil, en un minuto.",
          ]),
    ];
    if (!datos.whatsappVinculado) {
      ctaTexto = "Conectar mi WhatsApp";
      ctaUrl = urls.perfil;
    }
  } else if (paso === "dia3") {
    asunto = "¿Te ayudo a arrancar?";
    titulo = "Una sola frase alcanza";
    parrafos = [
      saludo,
      "Todavía no me contaste nada de tu negocio, y está bien: el primer paso es el que más cuesta.",
      `Probá con una sola frase, la última venta que hiciste: «${ejemplo}». No hace falta cargar productos antes ni llenar nada.`,
      "Si algo no te quedó claro, respondé este correo. Lo lee una persona.",
    ];
  } else {
    const hechas = Object.entries(datos.acciones).filter(([, n]) => n > 0);
    const total = hechas.reduce((t, [, n]) => t + n, 0);
    if (total === 0) {
      asunto = "¿Qué te frenó?";
      titulo = "¿Qué te frenó?";
      parrafos = [
        saludo,
        "Pasó una semana desde que creaste tu cuenta y todavía no anotamos nada juntos.",
        "Queremos saber qué te faltó: respondé este correo con una línea, aunque sea «no tuve tiempo». Lo lee una persona y nos ayuda a mejorar EOS.",
        `Y si querés darle otra oportunidad, empezá por acá: «${ejemplo}».`,
      ];
    } else {
      const detalle = hechas
        .sort((a, b) => b[1] - a[1])
        .map(([verbo, n]) => {
          const [uno, varios] = NOMBRES[verbo] ?? ["cosa", "cosas"];
          return `${n} ${n === 1 ? uno : varios}`;
        })
        .join(", ");
      asunto = "Tu primera semana con EOS";
      titulo = "Tu primera semana";
      parrafos = [
        saludo,
        `En tu primera semana anotamos ${total === 1 ? "1 cosa" : `${total} cosas`}: ${detalle}.`,
        ...(datos.vendido > 0 ? [`Entre todas las ventas, ${formatearMonto(datos.vendido, "PYG")}.`] : []),
        "Desde el lunes te llega un resumen de la semana. Mientras más le contás, mejor te lo arma.",
        "Si algo no anduvo como esperabas, respondé este correo: lo lee una persona.",
      ];
    }
  }

  const html = envolverEmailDeMarca({
    titulo,
    parrafos: parrafos.map(escaparHtml),
    ctaTexto,
    ctaUrl,
    pieHtml: `<p style="margin:24px 0 0;color:#94a3b8;line-height:1.6;font-size:12px;">Te escribimos porque creaste tu cuenta en EOS hace pocos días. Si no querés recibir estos correos, <a href="${urls.baja}" style="color:#94a3b8;">darte de baja</a> lleva un clic.</p>`,
  });

  const texto = [...parrafos.flatMap((p) => [p, ""]), `${ctaTexto}: ${ctaUrl}`, "", `Darte de baja: ${urls.baja}`].join("\n");

  return { asunto, html, texto };
}

export type CorreoPrimerosDias = { para: string; asunto: string; html: string; texto: string; urlBaja: string; replyTo: string };
export type ResumenPrimerosDias = { enviados: number; fallidos: number; porPaso: Record<Paso, number> };

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/** Idempotente: se llama todos los días desde el cron del briefing. */
export async function enviarPrimerosDias(
  admin: ClienteSinTipos,
  opciones: {
    appUrl: string;
    secreto: string;
    enviar: (correo: CorreoPrimerosDias) => Promise<void>;
    ahora?: Date;
  },
): Promise<ResumenPrimerosDias> {
  const { appUrl, secreto, enviar, ahora = new Date() } = opciones;
  const hoy = hoyEnParaguay(ahora);
  const resumen: ResumenPrimerosDias = { enviados: 0, fallidos: 0, porPaso: { dia1: 0, dia3: 0, dia7: 0 } };

  // mensajes.created_at y usuarios.created_at son timestamp sin zona, en UTC.
  const desde = new Date(ahora.getTime() - 11 * 86_400_000).toISOString().replace("Z", "");
  const { data: usuarios, error } = await admin
    .from("usuarios")
    .select("id,nombre,email,created_at")
    .not("email", "is", null)
    .gte("created_at", desde)
    .limit(1000);
  if (error) throw new Error(`No se pudieron leer las cuentas nuevas: ${error.message ?? "desconocido"}`);

  const candidatas = (usuarios ?? []) as { id: string; nombre: string | null; email: string | null; created_at: string }[];
  if (candidatas.length === 0) return resumen;
  const ids = candidatas.map((u) => u.id);

  const [tipos, bajas, recibidos] = await Promise.all([
    admin.from("eos_cuentas_v172").select("usuario_id,tipo").in("usuario_id", ids),
    admin.from("eos_followup_preferences").select("usuario_id").in("usuario_id", ids).eq("correos_motivacionales", false),
    admin.from(TABLA).select("usuario_id,paso").in("usuario_id", ids),
  ]);
  // Sin saber quién se dio de baja o qué recibió, no se manda a nadie.
  const falla = tipos.error ?? bajas.error ?? recibidos.error;
  if (falla) throw new Error(`No se pudo leer el estado de los envíos: ${falla.message ?? "desconocido"}`);

  const reales = new Set(((tipos.data ?? []) as { usuario_id: string; tipo: string }[]).filter((t) => t.tipo === "real").map((t) => t.usuario_id));
  const deBaja = new Set(((bajas.data ?? []) as { usuario_id: string }[]).map((b) => b.usuario_id));
  const yaRecibio = new Map<string, Set<Paso>>();
  for (const r of (recibidos.data ?? []) as { usuario_id: string; paso: Paso }[]) {
    if (!yaRecibio.has(r.usuario_id)) yaRecibio.set(r.usuario_id, new Set());
    yaRecibio.get(r.usuario_id)!.add(r.paso);
  }

  for (const u of candidatas) {
    if (!u.email || !reales.has(u.id) || deBaja.has(u.id)) continue;

    const alta = hoyEnParaguay(new Date(`${u.created_at.replace(" ", "T").replace(/Z?$/, "")}Z`));
    const dias = diasEntre(alta, hoy);

    const { data: acciones } = await admin
      .from("eos_action_commands")
      .select("accion")
      .eq("usuario_id", u.id)
      .eq("estado", "completada")
      .limit(1000);
    const porVerbo: Record<string, number> = {};
    for (const a of (acciones ?? []) as { accion: string }[]) porVerbo[a.accion] = (porVerbo[a.accion] ?? 0) + 1;
    const anotoAlgo = Object.values(porVerbo).some((n) => n > 0);

    const paso = pasoDelDia(dias, anotoAlgo, yaRecibio.get(u.id) ?? new Set());
    if (!paso) continue;

    // Reclamo: si otra corrida ya lo tomó (23505), no se manda.
    const { error: errReclamo } = await admin.from(TABLA).insert({ usuario_id: u.id, paso });
    if (errReclamo) {
      if ((errReclamo as { code?: string }).code !== "23505") console.error("Primeros días: no se pudo reclamar:", errReclamo);
      continue;
    }

    const [ventas, vinculo, rubro] = await Promise.all([
      admin.from("eos_erp_ventas").select("total").eq("usuario_id", u.id).neq("estado", "anulada").eq("moneda", "PYG").limit(5000),
      admin.from("eos_whatsapp_vinculos_v162").select("verificado_at").eq("usuario_id", u.id).not("verificado_at", "is", null).maybeSingle(),
      admin.auth.admin
        .getUserById(u.id)
        .then((r: { data?: { user?: { user_metadata?: Record<string, unknown> } } }) => r.data?.user?.user_metadata?.rubro)
        .catch(() => null),
    ]);

    const datos: DatosDeCuenta = {
      nombre: u.nombre,
      rubro: typeof rubro === "string" ? rubro : null,
      whatsappVinculado: Boolean(vinculo.data),
      acciones: porVerbo,
      vendido: ((ventas.data ?? []) as { total: number | string }[]).reduce((t, v) => t + (Number(v.total) || 0), 0),
    };
    const urlBaja = urlDeBaja(appUrl, u.id, secreto);
    const { asunto, html, texto } = redactarPrimerosDias(paso, datos, {
      chat: `${appUrl}/eos/chat`,
      perfil: `${appUrl}/eos/chat?vista=perfil`,
      baja: urlBaja,
    });

    try {
      await enviar({ para: u.email, asunto, html, texto, urlBaja, replyTo: RESPONDER_A });
      resumen.enviados += 1;
      resumen.porPaso[paso] += 1;
    } catch (e) {
      resumen.fallidos += 1;
      console.error(`Primeros días: falló el envío (${paso}) a ${u.id}:`, e instanceof Error ? e.message : e);
      await admin.from(TABLA).delete().eq("usuario_id", u.id).eq("paso", paso);
    }
  }

  return resumen;
}
