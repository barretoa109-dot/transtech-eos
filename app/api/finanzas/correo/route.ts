import { after } from "next/server";
import { Resend } from "resend";

import {
  CONFIANZA_MINIMA_CORREO,
  extraerDeCorreo,
  type MovimientoDeCorreo,
} from "@/lib/finanzas/extraerDeCorreo";
import {
  registrarAuditoria,
  registrarVarias,
  resumirMovimiento,
  type EntradaAuditoria,
} from "@/lib/auditoria/registrar";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { consumirCupo, respuestaSinCupo, secretoDelEntorno } from "@/lib/seguridad/limite";
import { elegirAdjuntoFactura, type AdjuntoCrudo } from "@/lib/facturacion/adjuntoFactura";
import { leerKude } from "@/lib/facturacion/leerKude";
import { extraerTextoPdf } from "@/lib/documentos/textoPdf";
import { empresaDe } from "@/lib/empresa/acceso";
import { sumarCostoIA } from "@/lib/eos/costo-ia";

export const dynamic = "force-dynamic";

/**
 * Webhook de Resend: llegó un correo al buzón de ingesta de un usuario.
 *
 * Es la pieza que hace realidad el principio 1 de la doctrina ("cero carga
 * manual"): el usuario configura una regla de reenvío en su correo una sola
 * vez y a partir de ahí los avisos del banco entran a EOS solos.
 *
 * Dos decisiones heredadas de errores propios del proyecto:
 *
 * 1. Se responde 200 ANTES de hacer nada pesado, y el trabajo real va en
 *    `after()`. Es exactamente la lección del webhook de Bancard: llamar a la
 *    API del proveedor desde adentro del webhook que ese proveedor está
 *    esperando causó un deadlock de re-entrancia. Acá además evita que un
 *    reintento de Resend duplique trabajo.
 *
 * 2. El cuerpo del correo NO se persiste. Son avisos bancarios: traen saldos,
 *    números de cuenta y datos de terceros. Guardamos el importe extraído y
 *    metadatos mínimos; el original vive en Resend 30 días.
 */

type EmailRecibido = {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    received_for?: string[];
    subject?: string;
    created_at?: string;
  };
};

export async function POST(request: Request) {
  const crudo = await request.text();

  const secreto = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;

  // Las dos variables se validan juntas y ANTES de construir el cliente.
  //
  // `new Resend(undefined)` lanza "Missing API key". Cuando ese constructor
  // vivía dentro del try de la verificación, una variable de entorno faltante
  // salía como 401 "Firma inválida" — un problema de configuración disfrazado
  // de problema de firma, que costó una tarde de diagnóstico en la dirección
  // equivocada. Un 503 acá y un 401 solo allá abajo hacen la diferencia
  // diagnosticable desde afuera sin filtrar qué variable falta.
  if (!secreto || !apiKey) {
    console.error("Correo: falta RESEND_WEBHOOK_SECRET o RESEND_API_KEY.", {
      webhook_secret: Boolean(secreto),
      api_key: Boolean(apiKey),
    });
    return Response.json({ error: "No configurado." }, { status: 503 });
  }

  /*
   * Mismo criterio que el webhook de Bancard: un techo pensado
   * para el proveedor, no para una persona. Alto a propósito — un negocio con
   * varias cuentas puede recibir varios avisos bancarios seguidos, y frenar
   * eso de más deja plata real sin registrar sin que nadie lo note.
   */
  const cupo = await consumirCupo(adminSinTipos(), {
    ruta: "/api/finanzas/correo",
    cabeceras: request.headers,
    ventanaSegundos: 60,
    maximo: 60,
    secreto: secretoDelEntorno(),
  });

  if (!cupo.permitido) {
    return respuestaSinCupo(cupo, "Demasiadas notificaciones en poco tiempo.");
  }

  const resend = new Resend(apiKey);

  // Sin firma válida no se procesa: el buzón escribe movimientos que afectan
  // el disponible real, así que aceptar un POST sin verificar sería permitir
  // que cualquiera inyecte plata falsa en la cuenta de un usuario.
  let evento: EmailRecibido;
  try {
    evento = resend.webhooks.verify({
      payload: crudo,
      // El SDK pide los tres campos svix sueltos, no el objeto Headers web.
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: secreto,
    }) as EmailRecibido;
  } catch (error) {
    console.error("Correo: firma de webhook inválida:", error);
    return Response.json({ error: "Firma inválida." }, { status: 401 });
  }

  if (evento?.type !== "email.received" || !evento.data?.email_id) {
    // Otros eventos del mismo endpoint no son un error: se ignoran en silencio.
    return Response.json({ ok: true, ignorado: true });
  }

  const { email_id: emailId, from, subject } = evento.data;

  const token = extraerToken([...(evento.data.to ?? []), ...(evento.data.received_for ?? [])]);
  if (!token) {
    console.error("Correo: no se pudo determinar el buzón destino.");
    return Response.json({ ok: true, ignorado: true });
  }

  const admin = adminSinTipos();

  const { data: buzonCrudo, error: buzonError } = await admin
    .from("eos_finanzas_buzon")
    .select("usuario_id, activo")
    .eq("token", token)
    .maybeSingle();

  const buzon = buzonCrudo as { usuario_id: string; activo: boolean } | null;

  if (buzonError) {
    console.error("Correo: no se pudo resolver el buzón:", buzonError);
    return Response.json({ error: "No disponible." }, { status: 503 });
  }

  // Buzón inexistente o desactivado: 200 igual, para que Resend no reintente
  // eternamente un correo que nunca vamos a poder atribuir.
  if (!buzon || !buzon.activo) {
    return Response.json({ ok: true, ignorado: true });
  }

  // Reclamar el correo ANTES de procesarlo. El UNIQUE sobre email_id es la
  // idempotencia: si Resend reintenta, el insert falla y no se duplica nada.
  const { error: reclamoError } = await admin.from("eos_correos_entrantes").insert({
    usuario_id: buzon.usuario_id,
    email_id: emailId,
    remitente: from ?? null,
    asunto: subject ?? null,
    estado: "procesado",
  });

  if (reclamoError) {
    // 23505 = unique_violation: ya lo procesamos, todo bien.
    if ((reclamoError as { code?: string }).code === "23505") {
      return Response.json({ ok: true, idempotente: true });
    }
    console.error("Correo: no se pudo registrar el correo entrante:", reclamoError);
    return Response.json({ error: "No disponible." }, { status: 503 });
  }

  after(async () => {
    await procesar({ emailId, usuarioId: buzon.usuario_id, from: from ?? null, subject: subject ?? null });
  });

  return Response.json({ ok: true });
}

/**
 * Descarga el correo, extrae los movimientos y los guarda.
 *
 * Corre después de responderle a Resend, así que ningún error de acá puede
 * provocar un reintento: se registra el estado en la fila del correo y listo.
 */
async function procesar(args: {
  emailId: string;
  usuarioId: string;
  from: string | null;
  subject: string | null;
}) {
  const { emailId, usuarioId } = args;
  const admin = adminSinTipos();

  try {
    const respuesta = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      cache: "no-store",
    });

    if (!respuesta.ok) {
      throw new Error(`Resend devolvió ${respuesta.status} al leer el correo.`);
    }

    const correo = (await respuesta.json()) as {
      subject?: string | null;
      text?: string | null;
      html?: string | null;
      from?: string | null;
      created_at?: string | null;
      attachments?: { id: string; filename: string | null; size: number; content_type: string }[];
    };

    const movimientos = extraerDeCorreo({
      asunto: correo.subject ?? args.subject,
      texto: correo.text ?? null,
      html: correo.html ?? null,
      remitente: correo.from ?? args.from,
      recibidoEn: correo.created_at ?? new Date().toISOString(),
    });

    // Solo entra lo que EOS leyó con confianza. Perderse un movimiento es un
    // problema que el usuario nota; un importe mal leído, no — y decide con él.
    const confiables = movimientos.filter((m) => m.confianza >= CONFIANZA_MINIMA_CORREO);

    if (confiables.length > 0) {
      const { error: insertError } = await admin
        .from("eos_movimientos_financieros")
        .insert(confiables.map((m) => aFila(m, usuarioId, emailId)));

      if (insertError) throw insertError;
    }

    // Bitácora inmutable: es lo que le contesta al usuario "¿de dónde salió
    // este número?" sobre plata que entró sin que él tocara nada. Se registra
    // también lo DESCARTADO: que EOS haya visto un importe y no lo haya
    // guardado es información, y sin esto no queda rastro de esa decisión.
    const descartados = movimientos.filter((m) => m.confianza < CONFIANZA_MINIMA_CORREO);
    const fuente = (correo.from ?? args.from ?? "").split("@")[1] ?? "correo";

    await registrarAuditoria(admin, {
      usuarioId,
      evento: "correo_recibido",
      origen: "correo",
      resumen: `Llegó un aviso de ${fuente}: ${confiables.length} movimiento(s) registrado(s), ${descartados.length} descartado(s).`,
      referencia: emailId,
      detalle: { remitente: fuente, leidos: movimientos.length },
    });

    await registrarVarias(admin, [
      ...confiables.map(
        (m): EntradaAuditoria => ({
          usuarioId,
          evento: "movimiento_ingerido",
          origen: "correo",
          resumen: resumirMovimiento({ ...m, fuente: `aviso de ${fuente}` }),
          referencia: emailId,
          detalle: {
            tipo: m.tipo,
            monto: m.monto,
            moneda: m.moneda,
            fecha: m.fecha,
            confianza: m.confianza,
          },
        }),
      ),
      ...descartados.map(
        (m): EntradaAuditoria => ({
          usuarioId,
          evento: "movimiento_descartado",
          origen: "correo",
          resumen: `Se descartó un posible ${m.tipo} de ${m.moneda} ${m.monto}: la lectura no llegó al mínimo de confianza.`,
          referencia: emailId,
          detalle: {
            tipo: m.tipo,
            monto: m.monto,
            moneda: m.moneda,
            confianza: m.confianza,
            minimo: CONFIANZA_MINIMA_CORREO,
          },
        }),
      ),
    ]);

    // El único caso que no termina acá: no hubo ningún movimiento confiable,
    // pero el parser sí vio algo (`extraerDeCorreo` nunca devuelve más de un
    // movimiento por correo). Se guarda en la misma fila para que el usuario
    // lo pueda confirmar o descartar — antes esto solo quedaba en la
    // bitácora, donde nadie lo veía salvo que fuera a buscarlo.
    const unicoDescartado = confiables.length === 0 ? descartados[0] : undefined;

    await admin
      .from("eos_correos_entrantes")
      .update({
        movimientos_detectados: confiables.length,
        estado:
          confiables.length > 0 ? "procesado" : unicoDescartado ? "descartado" : "sin_movimientos",
        ...(unicoDescartado
          ? {
              tipo: unicoDescartado.tipo,
              monto: unicoDescartado.monto,
              moneda: unicoDescartado.moneda,
              descripcion: unicoDescartado.descripcion,
              confianza: unicoDescartado.confianza,
              revisado: false,
            }
          : {}),
      })
      .eq("email_id", emailId);

    await admin.rpc("eos_finanzas_registrar_correo_v53", { p_usuario_id: usuarioId }).then(
      () => undefined,
      // El contador del buzón es cosmético: que falle no invalida la ingesta.
      (error: unknown) => console.error("Correo: no se pudo actualizar el contador:", error),
    );

    // Aparte, en su propio try/catch: si esto falla no tiene que pisar el
    // `estado` que ya se guardó arriba por el aviso bancario del cuerpo del
    // correo — son dos lecturas independientes del mismo correo.
    try {
      await leerFacturaDeAdjuntos({ emailId, usuarioId, attachments: correo.attachments ?? [] });
    } catch (error) {
      console.error("Correo: no se pudo leer la factura de un adjunto:", error);
    }
  } catch (error) {
    console.error("Correo: fallo procesando el correo entrante:", error);
    await admin
      .from("eos_correos_entrantes")
      .update({ estado: "error" })
      .eq("email_id", emailId);
  }
}

/**
 * Si el correo trae un KuDE adjunto (Pilar 3 del documento de visión del
 * 04/11), lo lee y guarda una PROPUESTA de compra — nunca se registra sola.
 * No parsea el XML del Documento Electrónico de SIFEN: ver `leerKude.ts`.
 */
async function leerFacturaDeAdjuntos(args: {
  emailId: string;
  usuarioId: string;
  attachments: AdjuntoCrudo[];
}) {
  const { emailId, usuarioId, attachments } = args;

  const elegido = elegirAdjuntoFactura(attachments);
  if (!elegido) return;

  const admin = adminSinTipos();

  const metaRes = await fetch(
    `https://api.resend.com/emails/receiving/${emailId}/attachments/${elegido.id}`,
    { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, cache: "no-store" },
  );
  if (!metaRes.ok) throw new Error(`Resend devolvió ${metaRes.status} al pedir el adjunto.`);

  const meta = (await metaRes.json()) as { download_url?: string };
  if (!meta.download_url) throw new Error("El adjunto no trajo URL de descarga.");

  const archivoRes = await fetch(meta.download_url, { cache: "no-store" });
  if (!archivoRes.ok) throw new Error(`No se pudo descargar el adjunto (${archivoRes.status}).`);

  const bytes = new Uint8Array(await archivoRes.arrayBuffer());

  let costoUsd = 0;
  const alCosto = (usd: number) => {
    costoUsd += usd;
  };

  const factura = elegido.esImagen
    ? await leerKude(
        { tipo: "imagen", mime: attachments.find((a) => a.id === elegido.id)?.content_type ?? "image/jpeg", base64: Buffer.from(bytes).toString("base64") },
        { alCosto },
      )
    : await (async () => {
        const texto = await extraerTextoPdf(bytes);
        if (!texto) return null;
        return leerKude({ tipo: "texto", contenido: texto.texto }, { alCosto });
      })();

  if (costoUsd > 0) await sumarCostoIA(usuarioId, costoUsd, { avisar: true });

  if (!factura) return;

  const empresaId = await empresaDe(admin, usuarioId);

  const { error } = await admin.from("eos_facturas_recibidas").insert({
    usuario_id: usuarioId,
    empresa_id: empresaId,
    email_id: emailId,
    attachment_id: elegido.id,
    proveedor_ruc: factura.ruc_emisor,
    proveedor_nombre: factura.razon_social_emisor,
    numero_documento: factura.numero_documento,
    cdc: factura.cdc,
    fecha: factura.fecha,
    moneda: factura.moneda,
    total: factura.total,
    iva_tasa: factura.iva_tasa,
  });

  // 23505 = ya existe una fila para este correo (reintento de Resend): no es un error.
  if (error && (error as { code?: string }).code !== "23505") throw error;

  await registrarAuditoria(admin, {
    usuarioId,
    evento: "factura_proveedor_detectada",
    origen: "correo",
    resumen: `Se leyó una posible factura de ${factura.razon_social_emisor ?? "un proveedor"} por ${factura.moneda} ${factura.total}, pendiente de confirmar.`,
    referencia: emailId,
    detalle: { ruc: factura.ruc_emisor, total: factura.total, moneda: factura.moneda },
  });
}

function aFila(movimiento: MovimientoDeCorreo, usuarioId: string, emailId: string) {
  return {
    usuario_id: usuarioId,
    tipo: movimiento.tipo,
    monto: movimiento.monto,
    moneda: movimiento.moneda,
    descripcion: movimiento.descripcion,
    fecha: movimiento.fecha,
    origen: "correo",
    metadata: {
      email_id: emailId,
      confianza: movimiento.confianza,
      evidencia: movimiento.evidencia,
    },
  };
}

/**
 * Saca el token del destinatario.
 *
 * Las direcciones son `eos-<token>@<dominio de ingesta>`. Se contempla el
 * sufijo con `+` porque algunos clientes de correo lo agregan al reenviar.
 */
function extraerToken(destinatarios: string[]): string | null {
  for (const crudo of destinatarios) {
    const direccion = crudo.includes("<") ? (crudo.match(/<([^>]+)>/)?.[1] ?? crudo) : crudo;
    const local = direccion.split("@")[0]?.trim().toLowerCase();
    if (!local) continue;

    const sinSufijo = local.split("+")[0];
    if (!sinSufijo.startsWith("eos-")) continue;

    const token = sinSufijo.slice(4);
    if (/^[a-f0-9]{16,64}$/.test(token)) return token;
  }

  return null;
}
