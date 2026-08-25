import { enviarAviso, pushConfigurado, type Suscripcion } from "../push/enviar.ts";

/*
 * El aviso que evita que una suscripción se caiga en silencio.
 *
 * Cuando el banco emisor exige una verificación 3DS, el cobro automático no
 * puede completarse: el desafío lo responde la persona, y en una renovación
 * desatendida no hay nadie mirando. Marcarlo como rechazo es correcto, pero
 * hasta acá terminaba todo: el usuario se enteraba el día que perdía el
 * acceso, sin haber hecho nada mal y sin saber qué hacer al respecto. Es la
 * peor forma de perder a alguien, porque quería pagar.
 *
 * Vale para las dos formas en que una renovación se cae sola: el banco pide
 * una verificación que nadie puede responder, o la tarjeta rechaza el cobro.
 * Lo que pasó y qué hacer al respecto cambian; el resto es igual.
 */

/**
 * "verificacion": el emisor pidió 3DS y no hay nadie para responderlo.
 * "rechazo": la tarjeta dijo que no (saldo, vencida, bloqueada).
 */
export type MotivoRenovacion = "verificacion" | "rechazo";

export type EnviarCorreo = (args: {
  para: string;
  asunto: string;
  texto: string;
}) => Promise<void>;

export type TextoRenovacion = {
  titulo: string;
  cuerpo: string;
  asunto: string;
};

/*
 * El título no nombra el plan ni lleva cifras: se lee en la pantalla
 * bloqueada, delante de quien esté al lado. Mismo criterio que el aviso de
 * riesgo financiero.
 */
export const TITULO_RENOVACION = "EOS · tu renovación quedó pendiente";

function nombrePlan(plan: string): string {
  const limpio = plan.trim();

  if (!limpio) return "tu plan";

  return `EOS ${limpio.charAt(0).toUpperCase()}${limpio.slice(1).toLowerCase()}`;
}

function diaDelMes(iso: string): string {
  return String(Number(iso.slice(8, 10)));
}

/*
 * Cuánto apura.
 *
 * La fecha importa más que el motivo: quien lee esto necesita saber cuánto
 * tiempo tiene, no cómo funciona 3DS. Y si el plan ya venció se dice, en vez
 * de taparlo con un "pronto" que le haría creer que todavía hay margen.
 */
function plazo(vence: string | null, hoy: string): string {
  if (!vence) return "";

  if (vence < hoy) return `Tu plan venció el ${diaDelMes(vence)}.`;

  if (vence === hoy) return "Tu plan vence hoy.";

  const manana = new Date(Date.parse(`${hoy}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);

  if (vence === manana) return "Tu plan vence mañana.";

  return `Tu plan vence el ${diaDelMes(vence)}.`;
}

/*
 * Qué tiene que hacer, que no es lo mismo en los dos casos: una verificación
 * se responde, una tarjeta rechazada se cambia. Decirle "confirmá el pago" a
 * quien se quedó sin saldo es mandarlo a chocar contra la misma pared.
 */
function accion(motivo: MotivoRenovacion, vence: string | null, hoy: string): string {
  const paso =
    motivo === "verificacion"
      ? "Entrá y confirmá el pago"
      : "Entrá y probá de nuevo, o registrá otra tarjeta";

  if (!vence) return `${paso} para que tu plan siga activo.`;

  if (vence < hoy) return `${paso} para no quedarte sin acceso.`;

  return `${paso}.`;
}

/*
 * El texto dice tres cosas y ninguna más: qué pasó, que no fue culpa suya, y
 * qué tiene que hacer. Dice "verificación adicional de tu banco" y no "3DS":
 * el nombre técnico no le explica nada a quien recibe el mensaje.
 *
 * Del rechazo tampoco se cita el motivo que devuelve el emisor. Viene en su
 * idioma y a veces en su jerga ("Do not honour"), y una explicación que no se
 * entiende asusta más de lo que orienta. Lo que el usuario necesita saber es
 * que el cobro no salió y que puede resolverlo.
 */
export function redactarAvisoRenovacion(args: {
  motivo: MotivoRenovacion;
  plan: string;
  vence: string | null;
  hoy: string;
}): TextoRenovacion {
  const situacion =
    args.motivo === "verificacion"
      ? `Tu banco pidió una verificación adicional para renovar ${nombrePlan(
          args.plan,
        )} y no la podemos hacer por vos.`
      : `Tu tarjeta no aceptó el cobro para renovar ${nombrePlan(args.plan)}.`;

  const partes = [
    situacion,
    plazo(args.vence, args.hoy),
    accion(args.motivo, args.vence, args.hoy),
  ].filter(Boolean);

  return {
    titulo: TITULO_RENOVACION,
    cuerpo: partes.join(" "),
    asunto:
      args.motivo === "verificacion"
        ? "Tu renovación de EOS necesita que la confirmes vos"
        : "No pudimos cobrar tu renovación de EOS",
  };
}

/** Adónde mandarlo: el checkout con el plan ya elegido. */
export function enlaceRenovacion(plan: string, periodicidad: string): string {
  return `/pago/tarjeta?plan=${encodeURIComponent(plan)}&periodicidad=${encodeURIComponent(
    periodicidad,
  )}`;
}

export type ResultadoAviso = {
  avisado: boolean;
  motivo: "enviado" | "repetido" | "sin_canal" | "sin_historial";
};

/*
 * Push primero, correo de respaldo, uno solo de los dos.
 *
 * El correo NO se condiciona a `eos_followup_preferences.canal_email`, como sí
 * lo hace el aviso de riesgo. Esa preferencia arranca en false y gobierna los
 * seguimientos, que son mensajes que EOS elige mandar; esto es otra cosa: el
 * usuario pidió que le cobremos todos los meses y no pudimos. Callarlo por una
 * preferencia de seguimiento dejaría sin avisar a casi todos, que es
 * exactamente el problema que este módulo viene a resolver.
 */
export async function avisarRenovacionPendiente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tipos generados no incluyen estas tablas
  admin: any,
  args: {
    motivo: MotivoRenovacion;
    usuarioId: string;
    solicitudId: string;
    plan: string;
    periodicidad: string;
    vence: string | null;
    hoy: string;
    ventanaDesde: string;
    baseUrl: string;
    enviarCorreo?: EnviarCorreo;
  },
): Promise<ResultadoAviso> {
  /*
   * El cron reintenta cada día de la ventana de gracia, así que sin esto el
   * mismo problema se avisaría cuatro veces seguidas. Se mira si alguna
   * solicitud rechazada de esta misma ventana ya tiene el aviso anotado, y
   * ese sello se pone sólo cuando la entrega ocurrió de verdad: quien hoy no
   * tenía ningún canal se entera mañana si activa el push.
   */
  const { data: previas, error: previasError } = await admin
    .from("solicitudes_pago")
    .select("id,metadata")
    .eq("usuario_id", args.usuarioId)
    .eq("proveedor", "bancard")
    .eq("estado", "rechazado")
    .gte("created_at", args.ventanaDesde)
    .order("created_at", { ascending: false })
    .limit(20);

  /*
   * Si no se puede leer el historial, no se avisa. Es la misma regla que en
   * los avisos de riesgo: sin saber si ya avisamos, la alternativa es repetir
   * el mensaje cada día, y una notificación repetida se aprende a ignorar.
   */
  if (previasError) {
    console.error("Renovaciones: no se pudo leer el historial de avisos:", previasError);

    return { avisado: false, motivo: "sin_historial" };
  }

  const filas = (previas ?? []) as {
    id: string;
    metadata: Record<string, unknown> | null;
  }[];

  if (filas.some((f) => f.id !== args.solicitudId && f.metadata?.aviso_renovacion_en)) {
    return { avisado: false, motivo: "repetido" };
  }

  const texto = redactarAvisoRenovacion({
    motivo: args.motivo,
    plan: args.plan,
    vence: args.vence,
    hoy: args.hoy,
  });

  const ruta = enlaceRenovacion(args.plan, args.periodicidad);

  const entregado = await entregar(admin, {
    usuarioId: args.usuarioId,
    texto,
    ruta,
    baseUrl: args.baseUrl,
    enviarCorreo: args.enviarCorreo,
  });

  if (!entregado) return { avisado: false, motivo: "sin_canal" };

  const actual = filas.find((f) => f.id === args.solicitudId);

  const { error: marcarError } = await admin
    .from("solicitudes_pago")
    .update({
      metadata: {
        ...(actual?.metadata ?? {}),
        aviso_renovacion_en: new Date().toISOString(),
      },
    })
    .eq("id", args.solicitudId);

  if (marcarError) {
    // Ya se avisó; lo único que se arriesga es repetir el mensaje mañana.
    console.error("Renovaciones: aviso enviado pero no anotado:", marcarError);
  }

  return { avisado: true, motivo: "enviado" };
}

async function entregar(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver arriba
  admin: any,
  args: {
    usuarioId: string;
    texto: TextoRenovacion;
    ruta: string;
    baseUrl: string;
    enviarCorreo?: EnviarCorreo;
  },
): Promise<boolean> {
  if (pushConfigurado()) {
    const { data } = await admin
      .from("eos_push_suscripciones")
      .select("endpoint,p256dh,auth")
      .eq("usuario_id", args.usuarioId)
      .eq("activa", true);

    const suscripciones = (data ?? []) as Suscripcion[];

    if (suscripciones.length > 0) {
      const resultado = await enviarAviso(suscripciones, {
        titulo: args.texto.titulo,
        cuerpo: args.texto.cuerpo,
        url: args.ruta,
        tag: "eos-renovacion",
      });

      if (resultado.muertas.length > 0) {
        await admin
          .from("eos_push_suscripciones")
          .update({ activa: false })
          .in("endpoint", resultado.muertas);
      }

      if (resultado.enviados > 0) return true;
    }
  }

  if (!args.enviarCorreo) return false;

  const { data: perfil } = await admin
    .from("usuarios")
    .select("email")
    .eq("id", args.usuarioId)
    .maybeSingle();

  const email = (perfil?.email as string | null) ?? null;

  if (!email) return false;

  await args.enviarCorreo({
    para: email,
    asunto: args.texto.asunto,
    texto: `${args.texto.cuerpo}\n\n${args.baseUrl}${args.ruta}`,
  });

  return true;
}
