import webpush from "web-push";

/**
 * Envío de notificaciones push.
 *
 * Push es el canal de lo URGENTE, no el del resumen. El briefing diario sale
 * por correo y se lee cuando se puede; acá solo viaja lo que pierde sentido si
 * se lee mañana — que el 28 no va a alcanzar, por ejemplo. Un push por día
 * "porque sí" es lo que entrena a la gente a apagar las notificaciones, y
 * cuando llega el aviso que importa ya no hay nadie del otro lado.
 *
 * Web Push estándar (VAPID), no FCM: **no depende de las tiendas**. Funciona
 * hoy en Chrome/Edge/Firefox de escritorio y Android, y en iOS 16.4+ para la
 * PWA instalada. No hay que esperar al D-U-N-S para tener push.
 *
 * La responsabilidad más importante de este módulo no es enviar: es **limpiar
 * las suscripciones muertas**. Un usuario que revocó el permiso, desinstaló la
 * PWA o borró los datos del navegador deja un endpoint que responde 404/410
 * para siempre. Si no se marcan, cada envío reintenta contra dispositivos que
 * ya no existen y el ruido tapa los errores reales.
 */

export type Suscripcion = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type Aviso = {
  titulo: string;
  cuerpo: string;
  url?: string;
  tag?: string;
};

export type ResultadoEnvio = {
  enviados: number;
  fallidos: number;
  /** Ids de suscripciones que el servicio de push dio por muertas. */
  muertas: string[];
};

/** `true` si hay claves VAPID configuradas. Sin ellas no se puede enviar nada. */
export function pushConfigurado(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configurar() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:soporte@transtech.com.py",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );
}

/**
 * Manda un aviso a todas las suscripciones dadas.
 *
 * Cada envío va aislado: un dispositivo caído no puede impedir que el resto
 * reciba lo suyo.
 */
export async function enviarAviso(
  suscripciones: Suscripcion[],
  aviso: Aviso,
): Promise<ResultadoEnvio> {
  if (!pushConfigurado()) {
    console.error("Push: faltan las claves VAPID, no se envía nada.");
    return { enviados: 0, fallidos: suscripciones.length, muertas: [] };
  }

  configurar();

  const payload = JSON.stringify({
    titulo: aviso.titulo,
    cuerpo: aviso.cuerpo,
    url: aviso.url ?? "/eos/chat",
    tag: aviso.tag ?? "eos-aviso",
  });

  let enviados = 0;
  let fallidos = 0;
  const muertas: string[] = [];

  for (const s of suscripciones) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        // TTL de un día: si el dispositivo estuvo apagado más que eso, el
        // aviso de ayer ya no le sirve a nadie.
        { TTL: 86_400 },
      );
      enviados += 1;
    } catch (error) {
      fallidos += 1;

      // 404/410 = la suscripción ya no existe del lado del servicio de push.
      // No es un fallo transitorio: reintentar es tirar recursos.
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        muertas.push(s.id);
      } else {
        console.error(`Push: fallo enviando a ${s.id}:`, status ?? error);
      }
    }
  }

  return { enviados, fallidos, muertas };
}

/**
 * Recorta el texto para que entre en una notificación.
 *
 * En el teléfono se ven dos o tres líneas. Un texto largo se corta con
 * puntos suspensivos justo donde estaba lo importante, así que es mejor
 * elegir nosotros dónde termina.
 */
export function resumirParaPush(texto: string | null, maximo = 120): string {
  const limpio = (texto ?? "").trim().replace(/\s+/g, " ");
  if (limpio.length <= maximo) return limpio;

  const corte = limpio.slice(0, maximo);
  const ultimoEspacio = corte.lastIndexOf(" ");
  return `${corte.slice(0, ultimoEspacio > 60 ? ultimoEspacio : maximo)}…`;
}
