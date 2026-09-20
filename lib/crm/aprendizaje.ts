import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * EOS aprende de cómo terminan las oportunidades.
 *
 * ============================================================
 * QUÉ ES "APRENDER" ACÁ
 * ============================================================
 *
 * Cada vez que una oportunidad se GANA o se PIERDE, se recalculan unos pocos patrones
 * sobre los últimos seis meses de cierres de esa persona y se guardan como aprendizajes
 * (`eos_learnings`). Los aprendizajes activos entran al prompt del chat, así que la
 * próxima vez que EOS hable de una oportunidad, de una proyección o de qué hacer con un
 * cliente, lo hace sabiendo cómo le fue a ESTA persona y no un promedio genérico.
 *
 * ============================================================
 * LAS REGLAS QUE EVITAN INVENTAR
 * ============================================================
 *
 *   · Con menos de tres cierres no se afirma nada: una tasa de cierre de "100 %" sobre
 *     una venta ganada es una anécdota, no un patrón.
 *   · Un patrón necesita un mínimo de casos propios (el ciclo, dos ganadas; el motivo de
 *     pérdida, que se repita; el origen, dos cierres de cada lado y una diferencia clara).
 *   · Cada aprendizaje dice CUÁNTOS casos lo sostienen. La confianza sube con ellos y
 *     nunca llega a 1.
 *   · Un aprendizaje que la persona DESCARTÓ no se vuelve a activar por más que los
 *     números lo sigan diciendo: descartar es una decisión suya.
 *   · Un patrón que ya no se cumple se retira (queda "descartado", con el motivo).
 *
 * La parte de cálculo es pura y se prueba sola; `registrarAprendizajeComercial` es la
 * que lee y escribe.
 */

export type CierreCRM = {
  etapa: "ganada" | "perdida";
  monto: number;
  creado_en: string;
  cerrada_en: string | null;
  motivo_perdida: string | null;
  /** De dónde vino el cliente: "whatsapp", "manual"… Null si no se sabe. */
  origen: string | null;
};

export type Aprendizaje = {
  clave: string;
  patron: string;
  recomendacion: string;
  evidence_count: number;
  positive_count: number;
  negative_count: number;
  confianza: number;
  tendencia: "positiva" | "neutral" | "negativa" | "mixta";
};

export const MIN_CIERRES = 3;
export const VENTANA_DIAS = 180;
const MS_DIA = 86_400_000;

/** Las claves que este módulo administra: solo estas se retiran cuando dejan de cumplirse. */
export const CLAVES = ["crm:cierres:tasa", "crm:cierres:ciclo", "crm:cierres:motivo", "crm:cierres:origen"] as const;

const confianzaDe = (casos: number) => Math.round(Math.min(0.9, 0.3 + 0.1 * casos) * 100) / 100;
const pct = (parte: number, total: number) => Math.round((parte / total) * 100);

function diasEntre(desde: string, hasta: string): number | null {
  const a = Date.parse(desde);
  const b = Date.parse(hasta);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / MS_DIA);
}

const normalizarMotivo = (m: string | null) =>
  String(m ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

export function calcularAprendizajes(cierres: CierreCRM[]): Aprendizaje[] {
  const ganadas = cierres.filter((c) => c.etapa === "ganada");
  const perdidas = cierres.filter((c) => c.etapa === "perdida");
  const total = ganadas.length + perdidas.length;

  // Sin un mínimo de cierres no se afirma nada de nada.
  if (total < MIN_CIERRES) return [];

  const salida: Aprendizaje[] = [];

  // ------------------------------------------------------------------ tasa de cierre
  const tasa = pct(ganadas.length, total);
  salida.push({
    clave: "crm:cierres:tasa",
    patron: `De ${total} oportunidades cerradas en los últimos meses, ${ganadas.length} se ganaron (${tasa} %).`,
    recomendacion:
      `Tu tasa de cierre es del ${tasa} % (${ganadas.length} de ${total}). ` +
      "Usala como referencia para estimar cuánto va a entrar de lo que hoy hay en el embudo, en vez de contarlo todo.",
    evidence_count: total,
    positive_count: ganadas.length,
    negative_count: perdidas.length,
    confianza: confianzaDe(total),
    tendencia: tasa >= 60 ? "positiva" : tasa <= 30 ? "negativa" : "mixta",
  });

  // ------------------------------------------------------------------------- ciclo
  const ciclos = ganadas
    .map((c) => (c.cerrada_en ? diasEntre(c.creado_en, c.cerrada_en) : null))
    .filter((d): d is number => d !== null);

  if (ciclos.length >= 2) {
    const promedio = Math.round(ciclos.reduce((a, b) => a + b, 0) / ciclos.length);
    salida.push({
      clave: "crm:cierres:ciclo",
      patron: `Las oportunidades ganadas tardaron ${promedio} ${promedio === 1 ? "día" : "días"} en cerrarse (${ciclos.length} casos).`,
      recomendacion:
        `Tus ventas se cierran, en promedio, en ${promedio} ${promedio === 1 ? "día" : "días"}. ` +
        "Una oportunidad que ya lleva bastante más que eso abierta merece un seguimiento: o se retoma o se da por perdida.",
      evidence_count: ciclos.length,
      positive_count: ciclos.length,
      negative_count: 0,
      confianza: confianzaDe(ciclos.length),
      tendencia: "neutral",
    });
  }

  // ------------------------------------------------------------- motivo de pérdida
  const motivos = new Map<string, number>();
  for (const p of perdidas) {
    const m = normalizarMotivo(p.motivo_perdida);
    if (m) motivos.set(m, (motivos.get(m) ?? 0) + 1);
  }
  const conMotivo = [...motivos.values()].reduce((a, b) => a + b, 0);
  const [motivoTop, veces] = [...motivos.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

  // Que se REPITA (al menos dos veces) y pese algo (al menos un tercio de las que tienen motivo).
  if (veces >= 2 && veces / conMotivo >= 1 / 3) {
    salida.push({
      clave: "crm:cierres:motivo",
      patron: `El motivo que más se repite al perder una oportunidad es «${motivoTop}» (${veces} de ${conMotivo}).`,
      recomendacion:
        `Lo que más te está costando cerrar es «${motivoTop}» (${veces} de ${conMotivo} pérdidas con motivo). ` +
        "Conviene tenerlo resuelto antes de presentar una propuesta.",
      evidence_count: conMotivo,
      positive_count: 0,
      negative_count: veces,
      confianza: confianzaDe(conMotivo),
      tendencia: "negativa",
    });
  }

  // ------------------------------------------------------------------------ origen
  const deWhatsapp = cierres.filter((c) => c.origen === "whatsapp");
  const deOtros = cierres.filter((c) => c.origen !== null && c.origen !== "whatsapp");

  if (deWhatsapp.length >= 2 && deOtros.length >= 2) {
    const a = pct(deWhatsapp.filter((c) => c.etapa === "ganada").length, deWhatsapp.length);
    const b = pct(deOtros.filter((c) => c.etapa === "ganada").length, deOtros.length);

    // Una diferencia chica con pocos casos es ruido: se exige que se note.
    if (Math.abs(a - b) >= 20) {
      const mejor = a > b;
      const casos = deWhatsapp.length + deOtros.length;

      salida.push({
        clave: "crm:cierres:origen",
        patron: `Los clientes que llegaron por WhatsApp se ganaron el ${a} % de las veces; los demás, el ${b} %.`,
        recomendacion: mejor
          ? `WhatsApp es el canal que mejor te convierte (${a} % contra ${b} %): vale la pena contestar rápido ahí.`
          : `Los clientes que llegan por WhatsApp te cierran menos (${a} % contra ${b} %): conviene calificarlos antes de invertirles tiempo.`,
        evidence_count: casos,
        positive_count: deWhatsapp.filter((c) => c.etapa === "ganada").length + deOtros.filter((c) => c.etapa === "ganada").length,
        negative_count: deWhatsapp.filter((c) => c.etapa === "perdida").length + deOtros.filter((c) => c.etapa === "perdida").length,
        confianza: confianzaDe(casos),
        tendencia: mejor ? "positiva" : "negativa",
      });
    }
  }

  return salida;
}

// ---------------------------------------------------------------------- guardarlos

type FilaAprendizaje = { id: string; clave: string; estado: string };

/**
 * Recalcula y guarda los aprendizajes comerciales de UNA persona. Se llama cuando una
 * oportunidad se cierra. Todo lleva `usuario_id`: se usa la clave de servicio y ese
 * filtro escrito a mano es la única frontera.
 */
export async function registrarAprendizajeComercial(
  admin: ClienteSinTipos,
  usuarioId: string,
  ahora: Date = new Date(),
): Promise<{ guardados: number; retirados: number }> {
  const desde = new Date(ahora.getTime() - VENTANA_DIAS * MS_DIA).toISOString();

  const { data: filas, error } = await admin
    .from("eos_crm_oportunidades")
    .select("etapa, monto, creado_en, cerrada_en, motivo_perdida, contacto:eos_crm_contactos(origen)")
    .eq("usuario_id", usuarioId)
    .in("etapa", ["ganada", "perdida"])
    .gte("cerrada_en", desde)
    .limit(500);

  if (error) {
    // Sin la columna `origen` (o sin la tabla) no hay aprendizaje que calcular todavía.
    console.error("CRM: no se pudieron leer los cierres para aprender:", error);
    return { guardados: 0, retirados: 0 };
  }

  const cierres: CierreCRM[] = ((filas ?? []) as unknown as Record<string, unknown>[]).map((f) => {
    const contacto = f.contacto as { origen?: string | null } | { origen?: string | null }[] | null;
    const origen = Array.isArray(contacto) ? contacto[0]?.origen : contacto?.origen;

    return {
      etapa: f.etapa as "ganada" | "perdida",
      monto: Number(f.monto ?? 0),
      creado_en: String(f.creado_en),
      cerrada_en: (f.cerrada_en as string | null) ?? null,
      motivo_perdida: (f.motivo_perdida as string | null) ?? null,
      origen: origen ?? null,
    };
  });

  const vigentes = calcularAprendizajes(cierres);

  const { data: existentesData } = await admin
    .from("eos_learnings")
    .select("id, clave, estado")
    .eq("usuario_id", usuarioId)
    .in("clave", [...CLAVES]);

  const existentes = new Map(((existentesData ?? []) as FilaAprendizaje[]).map((e) => [e.clave, e]));
  const iso = ahora.toISOString();

  let guardados = 0;
  let retirados = 0;

  for (const a of vigentes) {
    const previo = existentes.get(a.clave);

    // La persona lo descartó: es una decisión suya y no se revierte por más que los números sigan.
    if (previo?.estado === "descartado") continue;

    const contenido = {
      categoria: "general",
      patron: a.patron,
      recomendacion: a.recomendacion,
      tendencia: a.tendencia,
      confianza: a.confianza,
      evidence_count: a.evidence_count,
      positive_count: a.positive_count,
      negative_count: a.negative_count,
      estado: "activo",
      fuente: "crm",
      last_observed_at: iso,
      generated_at: iso,
      updated_at: iso,
      metadata: { origen: "crm_cierres", ventana_dias: VENTANA_DIAS },
    };

    if (previo) {
      const { error: e } = await admin.from("eos_learnings").update(contenido).eq("id", previo.id).eq("usuario_id", usuarioId);
      if (e) console.error("CRM: no se pudo actualizar un aprendizaje:", e);
      else guardados += 1;
    } else {
      const { error: e } = await admin.from("eos_learnings").insert({
        usuario_id: usuarioId,
        clave: a.clave,
        first_observed_at: iso,
        model_version: "crm-cierres-v1",
        prompt_version: "crm-cierres-v1",
        ...contenido,
      });
      if (e) console.error("CRM: no se pudo guardar un aprendizaje:", e);
      else guardados += 1;
    }
  }

  // Un patrón que ya no se cumple se retira, con el motivo escrito.
  const vigentesClaves = new Set(vigentes.map((v) => v.clave));
  for (const [clave, previo] of existentes) {
    if (vigentesClaves.has(clave) || previo.estado === "descartado") continue;

    const { error: e } = await admin
      .from("eos_learnings")
      .update({
        estado: "descartado",
        descartado_en: iso,
        descartado_motivo: "Con los cierres recientes este patrón ya no se cumple.",
        updated_at: iso,
      })
      .eq("id", previo.id)
      .eq("usuario_id", usuarioId);

    if (!e) retirados += 1;
  }

  return { guardados, retirados };
}
