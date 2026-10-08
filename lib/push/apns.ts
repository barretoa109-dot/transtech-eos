import { createPrivateKey, sign as firmar } from "node:crypto";
import { connect, constants as HTTP2, type ClientHttp2Session } from "node:http2";

/**
 * Envío de push a los teléfonos iOS de la app nativa, por el API HTTP/2 de
 * APNs (token de proveedor firmado con ES256, no certificado: no vence y no
 * hay que renovarlo a mano).
 *
 * Es el canal nativo, separado del push web (`./enviar`, VAPID) y del de
 * Android (`./fcm`, FCM). El WebView de la app no recibe Web Push.
 *
 * Apagado sin configuración: si falta alguna de las tres variables, no se
 * envía nada y no se rompe nada. Ver docs/app-nativa/tiendas.md.
 */

export type ClaveApns = {
  teamId: string;
  keyId: string;
  clavePrivada: string;
};

export type AvisoNativo = {
  titulo: string;
  cuerpo: string;
  url?: string;
};

/** Fijo: es el `appId` de `capacitor.config.ts`, no cambia por entorno. */
const BUNDLE_ID = "com.transtech.eos";
const HOST_PRODUCCION = "api.push.apple.com";
const HOST_SANDBOX = "api.sandbox.push.apple.com";

function base64url(entrada: string | Buffer): string {
  return Buffer.from(entrada).toString("base64url");
}

/** La clave de APNs, si las tres variables están cargadas. */
export function claveApns(): ClaveApns | null {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const clavePrivada = process.env.APNS_CLAVE_PRIVADA;
  if (!teamId || !keyId || !clavePrivada) return null;
  return { teamId, keyId, clavePrivada };
}

/**
 * El JWT de proveedor que pide APNs (ES256, no RS256 como el de FCM). Pura:
 * recibe el instante.
 */
export function jwtApns(clave: ClaveApns, ahoraSegundos: number): string {
  const encabezado = base64url(JSON.stringify({ alg: "ES256", kid: clave.keyId }));
  const reclamos = base64url(JSON.stringify({ iss: clave.teamId, iat: ahoraSegundos }));
  const firma = firmar("sha256", Buffer.from(`${encabezado}.${reclamos}`), {
    key: createPrivateKey(clave.clavePrivada),
    // APNs (y JWS en general) espera la firma cruda R||S de 64 bytes, no el
    // DER que Node devuelve por defecto para una clave EC.
    dsaEncoding: "ieee-p1363",
  });
  return `${encabezado}.${reclamos}.${base64url(firma)}`;
}

/** El cuerpo APNs del aviso. Puro. */
export function mensajeApns(aviso: AvisoNativo): string {
  return JSON.stringify({
    aps: {
      alert: { title: aviso.titulo, body: aviso.cuerpo },
      sound: "default",
    },
    url: aviso.url ?? "/eos/chat",
  });
}

let jwtCache: { valor: string; expira: number } | null = null;

/** APNs no acepta un token de más de una hora; se renueva bastante antes. */
function jwtVigente(clave: ClaveApns): string {
  const ahora = Date.now();
  if (jwtCache && jwtCache.expira > ahora) return jwtCache.valor;

  const valor = jwtApns(clave, Math.floor(ahora / 1000));
  jwtCache = { valor, expira: ahora + 50 * 60_000 };
  return valor;
}

export type ResultadoApns = {
  enviados: number;
  fallidos: number;
  /** Tokens que APNs dio por muertos (desinstalada o token inválido): hay que borrarlos. */
  muertos: string[];
};

/** Un envío aislado: si falla, no afecta a los demás tokens de la misma tanda. */
function enviarUno(
  sesion: ClientHttp2Session,
  token: string,
  jwt: string,
  cuerpo: string,
): Promise<"enviado" | "muerto" | "fallido"> {
  return new Promise((resolve) => {
    try {
      const peticion = sesion.request({
        [HTTP2.HTTP2_HEADER_METHOD]: "POST",
        [HTTP2.HTTP2_HEADER_PATH]: `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
      });

      let estado = 0;
      let datos = "";
      peticion.on("response", (encabezados) => {
        estado = Number(encabezados[HTTP2.HTTP2_HEADER_STATUS]);
      });
      peticion.setEncoding("utf8");
      peticion.on("data", (fragmento: string) => {
        datos += fragmento;
      });
      peticion.on("end", () => {
        if (estado === 200) {
          resolve("enviado");
          return;
        }

        let razon = "";
        try {
          razon = (JSON.parse(datos) as { reason?: string }).reason ?? "";
        } catch {
          // Respuesta sin cuerpo o no-JSON: se trata como fallo, no como muerto.
        }
        // 410 = APNs ya no tiene el token (desinstalada). BadDeviceToken = token inválido.
        resolve(estado === 410 || razon === "BadDeviceToken" ? "muerto" : "fallido");
      });
      peticion.on("error", () => resolve("fallido"));
      peticion.end(cuerpo);
    } catch {
      resolve("fallido");
    }
  });
}

/**
 * Manda el aviso a cada token de iOS, en una sola conexión HTTP/2: es lo que
 * pide APNs (no abrir una conexión por notificación). Nunca lanza error.
 */
export async function enviarApns(tokens: string[], aviso: AvisoNativo): Promise<ResultadoApns> {
  const clave = claveApns();
  if (!clave || tokens.length === 0) return { enviados: 0, fallidos: 0, muertos: [] };

  const host = process.env.APNS_ENTORNO === "sandbox" ? HOST_SANDBOX : HOST_PRODUCCION;
  const jwt = jwtVigente(clave);
  const cuerpo = mensajeApns(aviso);

  try {
    const sesion = connect(`https://${host}`);
    sesion.on("error", () => {});

    try {
      const resultados = await Promise.all(
        tokens.map((token) => enviarUno(sesion, token, jwt, cuerpo)),
      );
      const muertos = tokens.filter((_token, indice) => resultados[indice] === "muerto");
      const enviados = resultados.filter((resultado) => resultado === "enviado").length;
      return { enviados, fallidos: resultados.length - enviados, muertos };
    } finally {
      sesion.close();
    }
  } catch {
    return { enviados: 0, fallidos: tokens.length, muertos: [] };
  }
}
