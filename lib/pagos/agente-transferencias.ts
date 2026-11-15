import { hoyEnParaguay } from "../fecha.ts";
import { avisarNativo } from "../push/nativo.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { evaluarComprobante, leerComprobante, type LecturaComprobante, type Veredicto } from "./comprobante-ia.ts";
import { CUENTA } from "./cuenta.ts";

/**
 * El agente que acompaña cada pago por transferencia, las 24 horas.
 *
 * Tres momentos:
 *
 *   1. Apenas la persona sube el comprobante (`revisarComprobanteSubido`): lo
 *      lee, lo compara con el pedido, deja escrito lo que encontró y le avisa
 *      al dueño al teléfono y por correo.
 *   2. Si el dueño aprueba o rechaza desde el panel, ahí termina.
 *   3. Si el dueño no contestó en un rato (`autoaprobarSiCorresponde`) y el
 *      comprobante coincide en todo, el agente activa lo que la persona pidió
 *      y le avisa al dueño que lo hizo, para que mire el banco.
 *
 * ============================================================
 * POR QUÉ EL PASO 3 TIENE TOPES
 * ============================================================
 *
 * El agente ve una captura, no la cuenta del banco: una captura editada pasa
 * la revisión. Activar solo con eso es aceptar que alguna vez se va a activar
 * un plan que nadie pagó. Los topes hacen que eso cueste poco y no se repita:
 *
 *   · solo si el veredicto es "coincide" (cuenta, monto, fecha y número de
 *     operación a la vista y correctos);
 *   · solo hasta un monto máximo;
 *   · una sola vez por cuenta cada 25 días: el segundo pago seguido de la
 *     misma persona lo mira el dueño;
 *   · nunca con un número de operación que ya se usó en otro pedido;
 *   · y el dueño se entera en el momento, con el nombre de la persona.
 *
 * Arranca APAGADO (`PAGOS_AGENTE_AUTOAPRUEBA=1` lo enciende). Sin eso el
 * agente lee y avisa, y activa siempre el dueño.
 */

export const CORREO_DEL_AGENTE = "agente-ia@transtech.com.py";

/** Lo que se guarda en `solicitudes_pago.metadata.revision_ia`. */
export type RevisionIa = {
  veredicto: Veredicto["resultado"];
  motivos: string[];
  lectura: LecturaComprobante | null;
  revisado_at: string;
};

export type ConfigDelAgente = {
  autoaprueba: boolean;
  /** Minutos que se le dan al dueño para contestar antes de activar. */
  esperaMin: number;
  montoMax: number;
};

export function configDelAgente(env: Record<string, string | undefined> = process.env): ConfigDelAgente {
  const numero = (valor: string | undefined, defecto: number) => {
    const n = Number((valor ?? "").trim());
    return Number.isFinite(n) && n >= 0 && (valor ?? "").trim() !== "" ? n : defecto;
  };

  return {
    autoaprueba: env.PAGOS_AGENTE_AUTOAPRUEBA === "1",
    esperaMin: numero(env.PAGOS_AGENTE_ESPERA_MIN, 15),
    // El tope de un EOS armado a medida (ver eos_plan_armado).
    montoMax: numero(env.PAGOS_AGENTE_MONTO_MAX, 500_000),
  };
}

/** Cuántos días tienen que pasar para que el agente le active a la misma cuenta otra vez por su cuenta. */
export const DIAS_ENTRE_AUTOAPROBACIONES = 25;

export type CasoParaAutoaprobar = {
  estado: string;
  monto: number;
  revision: RevisionIa | null | undefined;
  /** Minutos desde que se subió el comprobante. */
  minutosDesdeSubida: number;
  operacionRepetida: boolean;
  autoaprobadoHaceMenosDe25Dias: boolean;
};

/** ¿Puede el agente activar este pago sin el dueño? Pura: las reglas, a la vista. */
export function puedeAutoaprobar(caso: CasoParaAutoaprobar, config: ConfigDelAgente): { ok: boolean; motivo: string } {
  if (!config.autoaprueba) return { ok: false, motivo: "la aprobación automática está apagada" };
  if (caso.estado !== "en_revision") return { ok: false, motivo: "el pedido ya no está en revisión" };
  if (!caso.revision) return { ok: false, motivo: "el comprobante todavía no se revisó" };
  if (caso.revision.veredicto !== "coincide") return { ok: false, motivo: "el comprobante no coincide en todo" };
  if (caso.minutosDesdeSubida < config.esperaMin) return { ok: false, motivo: "todavía es el turno del dueño" };
  if (caso.monto > config.montoMax) return { ok: false, motivo: "el monto supera el tope del agente" };
  if (caso.operacionRepetida) return { ok: false, motivo: "ese número de operación ya se usó en otro pedido" };
  if (caso.autoaprobadoHaceMenosDe25Dias) {
    return { ok: false, motivo: "a esta cuenta ya se le activó sin el dueño hace poco" };
  }
  return { ok: true, motivo: "coincide y el dueño no contestó a tiempo" };
}

/* ------------------------------------------------------------------ */
/* Avisar al dueño                                                     */
/* ------------------------------------------------------------------ */

export type EnviarCorreo = (args: { para: string; asunto: string; texto: string }) => Promise<void>;

function correosDelDueno(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ADMIN_EMAILS || "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Le avisa a quienes administran EOS: al teléfono (si tienen la app) y por
 * correo, los dos. Es plata: mejor dos avisos que ninguno. Nunca lanza.
 *
 * El push no lleva el monto ni el nombre completo en el título: se lee con el
 * teléfono bloqueado. El detalle va en el cuerpo y en el correo.
 */
export async function avisarAlDueno(
  admin: ClienteSinTipos,
  aviso: { titulo: string; cuerpo: string; detalle: string },
  opciones: { enviarCorreo?: EnviarCorreo; baseUrl?: string; env?: Record<string, string | undefined> } = {},
): Promise<{ push: number; correos: number }> {
  let push = 0;
  let correos = 0;
  const enlace = `${opciones.baseUrl ?? "https://www.transtech.com.py"}/admin/pagos`;

  for (const correo of correosDelDueno(opciones.env)) {
    try {
      const { data } = await admin.from("usuarios").select("id").eq("email", correo).maybeSingle();
      const id = (data as { id?: string } | null)?.id;
      if (id) {
        const r = await avisarNativo(admin, id, { titulo: aviso.titulo, cuerpo: aviso.cuerpo, url: "/admin/pagos" });
        push += r.enviados;
      }
    } catch (error) {
      console.error("Pagos: no se pudo avisar por push al dueño:", error);
    }

    if (opciones.enviarCorreo) {
      try {
        await opciones.enviarCorreo({ para: correo, asunto: aviso.titulo, texto: `${aviso.detalle}\n\n${enlace}` });
        correos += 1;
      } catch (error) {
        console.error("Pagos: no se pudo avisar por correo al dueño:", error);
      }
    }
  }

  return { push, correos };
}

/* ------------------------------------------------------------------ */
/* 1. Recién subido: leer, comparar, anotar y avisar                   */
/* ------------------------------------------------------------------ */

type Solicitud = {
  id: string;
  usuario_id: string;
  estado: string;
  monto: number | string;
  plan_codigo: string | null;
  referencia_interna: string | null;
  metadata: Record<string, unknown> | null;
};

const CAMPOS = "id,usuario_id,estado,monto,plan_codigo,referencia_interna,metadata";

function guaranies(monto: number): string {
  return `Gs. ${Math.round(monto).toLocaleString("es-PY")}`;
}

async function nombreDe(admin: ClienteSinTipos, usuarioId: string): Promise<string> {
  const { data } = await admin.from("usuarios").select("nombre,email").eq("id", usuarioId).maybeSingle();
  const fila = data as { nombre?: string | null; email?: string | null } | null;
  return (fila?.nombre ?? "").trim() || (fila?.email ?? "").trim() || "Un usuario";
}

const TEXTO_DEL_VEREDICTO: Record<Veredicto["resultado"], string> = {
  coincide: "El comprobante coincide con el pedido (cuenta, monto y fecha).",
  dudoso: "El comprobante necesita que lo mires:",
  no_coincide: "El comprobante NO coincide con el pedido:",
};

export type Dependencias = {
  enviarCorreo?: EnviarCorreo;
  baseUrl?: string;
  env?: Record<string, string | undefined>;
  ahora?: Date;
  /** Se inyecta en las pruebas. */
  leer?: typeof leerComprobante;
};

export async function revisarComprobanteSubido(
  admin: ClienteSinTipos,
  solicitudId: string,
  deps: Dependencias = {},
): Promise<RevisionIa | null> {
  const ahora = deps.ahora ?? new Date();

  const { data, error } = await admin.from("solicitudes_pago").select(CAMPOS).eq("id", solicitudId).maybeSingle();
  const solicitud = data as Solicitud | null;
  if (error || !solicitud || solicitud.estado !== "en_revision") return null;

  const comprobante = (solicitud.metadata?.comprobante ?? null) as { ruta?: string; tipo?: string } | null;
  let lectura: LecturaComprobante | null = null;

  if (comprobante?.ruta && (comprobante.tipo ?? "").startsWith("image/")) {
    try {
      const { data: archivo } = await admin.storage.from("comprobantes-pago").download(comprobante.ruta);
      if (archivo) {
        const base64 = Buffer.from(await (archivo as Blob).arrayBuffer()).toString("base64");
        lectura = await (deps.leer ?? leerComprobante)({ mime: comprobante.tipo as string, base64 }, { env: deps.env });
      }
    } catch (error) {
      console.error("Pagos: no se pudo bajar el comprobante para revisarlo:", error);
    }
  }

  const monto = Number(solicitud.monto);
  const veredicto: Veredicto =
    comprobante?.tipo === "application/pdf"
      ? { resultado: "dudoso", motivos: ["El comprobante es un PDF: el agente solo lee imágenes."] }
      : evaluarComprobante(lectura, {
          monto,
          cuenta: CUENTA.numero,
          titular: CUENTA.titular,
          ruc: CUENTA.ruc,
          hoy: hoyEnParaguay(ahora),
        });

  const revision: RevisionIa = {
    veredicto: veredicto.resultado,
    motivos: veredicto.motivos,
    lectura,
    revisado_at: ahora.toISOString(),
  };

  // Se vuelve a leer la fila justo antes de escribir y se condiciona al
  // estado: si el dueño ya la procesó mientras el agente leía, no se pisa nada.
  const { data: fresca } = await admin.from("solicitudes_pago").select("metadata,estado").eq("id", solicitudId).maybeSingle();
  const filaFresca = fresca as { metadata?: Record<string, unknown> | null; estado?: string } | null;
  if (filaFresca?.estado === "en_revision") {
    await admin
      .from("solicitudes_pago")
      .update({ metadata: { ...(filaFresca.metadata ?? {}), revision_ia: revision } })
      .eq("id", solicitudId)
      .eq("estado", "en_revision");
  }

  const nombre = await nombreDe(admin, solicitud.usuario_id);
  const config = configDelAgente(deps.env);
  const queSigue =
    veredicto.resultado === "coincide" && config.autoaprueba
      ? `Si no lo aprobás o rechazás en ${config.esperaMin} minutos, EOS lo activa.`
      : "Queda esperando que lo apruebes o lo rechaces.";

  await avisarAlDueno(
    admin,
    {
      titulo: "EOS · llegó un comprobante de pago",
      cuerpo: `${nombre} subió un comprobante. ${veredicto.resultado === "coincide" ? "Coincide con el pedido." : "Necesita que lo mires."} ${queSigue}`,
      detalle: [
        `${nombre} subió el comprobante de una transferencia de ${guaranies(monto)} (${solicitud.plan_codigo ?? "plan"}, referencia ${solicitud.referencia_interna ?? solicitud.id}).`,
        "",
        TEXTO_DEL_VEREDICTO[veredicto.resultado],
        ...(veredicto.resultado === "coincide" ? [] : veredicto.motivos.map((m) => `  · ${m}`)),
        "",
        "Revisá en tu banco que la plata haya entrado: el agente ve la captura, no la cuenta.",
        queSigue,
      ].join("\n"),
    },
    deps,
  );

  return revision;
}

/* ------------------------------------------------------------------ */
/* 3. El dueño no contestó: activar, si corresponde                    */
/* ------------------------------------------------------------------ */

export type ResultadoAutoaprobacion = {
  activado: boolean;
  motivo: string;
  solicitudId?: string;
  planCodigo?: string | null;
  usuarioId?: string;
};

export async function autoaprobarSiCorresponde(
  admin: ClienteSinTipos,
  solicitudId: string,
  deps: Dependencias = {},
): Promise<ResultadoAutoaprobacion> {
  const ahora = deps.ahora ?? new Date();
  const config = configDelAgente(deps.env);
  // Antes de leer nada: con el agente apagado esto no toca la base.
  if (!config.autoaprueba) return { activado: false, motivo: "la aprobación automática está apagada" };

  const { data, error } = await admin.from("solicitudes_pago").select(CAMPOS).eq("id", solicitudId).maybeSingle();
  const solicitud = data as Solicitud | null;
  if (error || !solicitud) return { activado: false, motivo: "no se encontró el pedido" };

  const revision = (solicitud.metadata?.revision_ia ?? null) as RevisionIa | null;
  const subidoAt = Date.parse(String((solicitud.metadata?.comprobante as { subido_at?: string } | undefined)?.subido_at ?? ""));
  const minutosDesdeSubida = Number.isFinite(subidoAt) ? (ahora.getTime() - subidoAt) / 60_000 : 0;

  let operacionRepetida = false;
  const operacion = (revision?.lectura?.numero_operacion ?? "").trim();
  if (operacion) {
    const { data: otras, error: errorOtras } = await admin
      .from("solicitudes_pago")
      .select("id")
      .eq("metadata->revision_ia->lectura->>numero_operacion", operacion)
      .neq("id", solicitudId)
      .limit(1);
    // Si no se puede saber, se asume que sí: ante la duda decide el dueño.
    operacionRepetida = Boolean(errorOtras) || ((otras as unknown[] | null) ?? []).length > 0;
  }

  const desde = new Date(ahora.getTime() - DIAS_ENTRE_AUTOAPROBACIONES * 86_400_000).toISOString();
  const { data: previas, error: errorPrevias } = await admin
    .from("solicitudes_pago")
    .select("id")
    .eq("usuario_id", solicitud.usuario_id)
    .not("metadata->>autoaprobado_at", "is", null)
    .gte("created_at", desde)
    .neq("id", solicitudId)
    .limit(1);
  const autoaprobadoHaceMenosDe25Dias = Boolean(errorPrevias) || ((previas as unknown[] | null) ?? []).length > 0;

  const decision = puedeAutoaprobar(
    {
      estado: solicitud.estado,
      monto: Number(solicitud.monto),
      revision,
      minutosDesdeSubida,
      operacionRepetida,
      autoaprobadoHaceMenosDe25Dias,
    },
    config,
  );
  if (!decision.ok) return { activado: false, motivo: decision.motivo };

  // La misma función que usa el dueño desde el panel: mismas reglas, mismo
  // historial. Es idempotente y bloquea la fila, así que dos barridos a la vez
  // no activan dos veces.
  const { data: resultado, error: errorRpc } = await admin.rpc("eos_process_manual_payment_v42", {
    p_solicitud_id: solicitudId,
    p_action: "aprobar",
    p_admin_email: CORREO_DEL_AGENTE,
  });
  const r = (resultado ?? {}) as { ok?: boolean; status?: string; idempotent?: boolean; plan_codigo?: string };

  if (errorRpc || r.ok !== true || r.status !== "pagado") {
    console.error("Pagos: el agente no pudo activar el pedido:", errorRpc ?? resultado);
    return { activado: false, motivo: "no se pudo activar" };
  }
  if (r.idempotent === true) return { activado: false, motivo: "ya estaba pagado" };

  const { data: fresca } = await admin.from("solicitudes_pago").select("metadata").eq("id", solicitudId).maybeSingle();
  await admin
    .from("solicitudes_pago")
    .update({
      metadata: {
        ...(((fresca as { metadata?: Record<string, unknown> | null } | null)?.metadata) ?? {}),
        autoaprobado_at: ahora.toISOString(),
      },
    })
    .eq("id", solicitudId);

  const nombre = await nombreDe(admin, solicitud.usuario_id);
  await avisarAlDueno(
    admin,
    {
      titulo: "EOS · se activó un pago sin tu revisión",
      cuerpo: `EOS le activó el plan a ${nombre}: el comprobante coincidía y pasaron ${config.esperaMin} minutos. Revisá que la plata haya entrado.`,
      detalle: [
        `EOS activó el pedido de ${nombre} (${guaranies(Number(solicitud.monto))}, ${r.plan_codigo ?? solicitud.plan_codigo ?? "plan"}, referencia ${solicitud.referencia_interna ?? solicitud.id}).`,
        "",
        `El comprobante coincidía con el pedido y pasaron ${config.esperaMin} minutos sin que lo aprobaras o rechazaras.`,
        "Revisá en tu banco que la plata haya entrado. Si no entró, avisá para darle de baja el plan.",
      ].join("\n"),
    },
    deps,
  );

  return { activado: true, motivo: decision.motivo, solicitudId, planCodigo: r.plan_codigo ?? solicitud.plan_codigo, usuarioId: solicitud.usuario_id };
}

/** Barre todo lo que está en revisión. Para el reloj externo (cada pocos minutos). */
export async function barrerTransferencias(
  admin: ClienteSinTipos,
  deps: Dependencias = {},
): Promise<{ revisadas: number; activadas: ResultadoAutoaprobacion[] }> {
  const resumen = { revisadas: 0, activadas: [] as ResultadoAutoaprobacion[] };
  if (!configDelAgente(deps.env).autoaprueba) return resumen;

  const { data, error } = await admin
    .from("solicitudes_pago")
    .select("id")
    .eq("proveedor", "transferencia")
    .eq("estado", "en_revision")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Pagos: no se pudo leer lo que está en revisión:", error);
    return resumen;
  }

  for (const fila of (data ?? []) as { id: string }[]) {
    resumen.revisadas += 1;
    try {
      const r = await autoaprobarSiCorresponde(admin, fila.id, deps);
      if (r.activado) resumen.activadas.push(r);
    } catch (error) {
      console.error(`Pagos: falló el barrido de ${fila.id}:`, error);
    }
  }

  return resumen;
}
