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

/**
 * Deja un `.p8` en PEM canónico, venga como venga del panel de entorno.
 *
 * El 2026-11-11 la clave estaba cargada en producción y aun así APNs no
 * mandaba nada: `createPrivateKey` tiraba
 * `error:1E08010C:DECODER routines::unsupported`. La clave era correcta; lo
 * que estaba roto era el PEGADO. Un campo de una sola línea en un panel web
 * destruye un PEM de tres formas, todas invisibles a simple vista:
 *
 *   · los saltos de línea se convierten en `\n` literales (dos caracteres);
 *   · o se convierten en espacios, y queda todo en un renglón;
 *   · o alguien envuelve el valor entre comillas al copiarlo de un `.env`.
 *
 * Pedirle a una persona que vuelva a pegar la clave "pero bien" no es un
 * arreglo: la próxima vez vuelve a pasar, y el error que recibe no dice nada
 * sobre el pegado. Así que se reconstruye acá: se tira TODO el espaciado del
 * cuerpo y se rearma el PEM con líneas de 64, que es lo que esperan los
 * decodificadores.
 *
 * Preserva la etiqueta original (`PRIVATE KEY`, `EC PRIVATE KEY`, …): cambiarla
 * por una fija rompería una clave que sí estaba bien.
 */
export function normalizarClavePem(valor: string): string {
  let texto = (valor ?? "").trim();
  if (texto === "") return texto;

  const comillaInicial = texto[0];
  if ((comillaInicial === '"' || comillaInicial === "'") && texto.endsWith(comillaInicial)) {
    texto = texto.slice(1, -1).trim();
  }

  // `\n` y `\r\n` escritos como texto, no como salto real.
  texto = texto.replace(/\\r\\n|\\r|\\n/g, "\n");

  // Sin la marca `BEGIN` no hay nada que reconstruir: podría ser cualquier
  // texto, y envolverlo en un PEM inventado convierte un error claro ("esto no
  // es una clave") en uno incomprensible. Las tres formas de pegado roto que
  // importan conservan la marca; es lo que se pierde alrededor.
  const etiqueta = /-----BEGIN ([A-Z0-9 ]+?)-----/.exec(texto)?.[1];
  if (!etiqueta) return texto;

  const cuerpo = texto
    .replace(/-----BEGIN [A-Z0-9 ]+?-----/g, "")
    .replace(/-----END [A-Z0-9 ]+?-----/g, "")
    .replace(/\s+/g, "");

  // Si no quedó un cuerpo base64 reconocible, se devuelve lo que vino: es
  // preferible el error original de OpenSSL a una reconstrucción inventada.
  if (cuerpo === "" || /[^A-Za-z0-9+/=]/.test(cuerpo)) return texto;

  const lineas = cuerpo.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${etiqueta}-----\n${lineas.join("\n")}\n-----END ${etiqueta}-----\n`;
}

/** La clave de APNs, si las tres variables están cargadas. */
export function claveApns(): ClaveApns | null {
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const clavePrivada = process.env.APNS_CLAVE_PRIVADA;
  if (!teamId || !keyId || !clavePrivada) return null;
  return { teamId, keyId, clavePrivada: normalizarClavePem(clavePrivada) };
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
  /**
   * Por qué no salió cada uno que no salió, en texto.
   *
   * El conteo solo dice "no salió"; la diferencia entre una clave mal firmada
   * (`InvalidProviderToken`) y un bundle equivocado (`DeviceTokenNotForTopic`)
   * está justo acá. Nunca lleva el token entero, solo sus últimos caracteres.
   */
  razones: string[];
};

type EnvioUno = { estado: "enviado" | "muerto" | "fallido"; razon?: string };

/** Un envío aislado: si falla, no afecta a los demás tokens de la misma tanda. */
function enviarUno(
  sesion: ClientHttp2Session,
  token: string,
  jwt: string,
  cuerpo: string,
): Promise<EnvioUno> {
  return new Promise<EnvioUno>((resolve) => {
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
          resolve({ estado: "enviado" });
          return;
        }

        let razon = "";
        try {
          razon = (JSON.parse(datos) as { reason?: string }).reason ?? "";
        } catch {
          // Respuesta sin cuerpo o no-JSON: se trata como fallo, no como muerto.
        }
        const detalle = `HTTP ${estado} ${razon || "(sin razón)"} · ...${token.slice(-6)}`;
        // 410 = APNs ya no tiene el token (desinstalada). BadDeviceToken = token inválido.
        if (estado === 410 || razon === "BadDeviceToken") {
          resolve({ estado: "muerto", razon: detalle });
          return;
        }
        // Sin esto, un fallo real (JWT inválido, topic mal configurado, token del
        // entorno equivocado) queda indistinguible de "no se pudo mandar" para
        // siempre: se cuenta en `fallidos` y no hay ningún rastro de la razón.
        console.error(`APNs: fallo ${detalle}`);
        resolve({ estado: "fallido", razon: detalle });
      });
      peticion.on("error", (error) => {
        console.error(`APNs: error de conexión para ...${token.slice(-6)}:`, error);
        resolve({ estado: "fallido", razon: `conexión: ${(error as Error).message}` });
      });
      peticion.end(cuerpo);
    } catch (error) {
      resolve({ estado: "fallido", razon: `excepción: ${(error as Error).message}` });
    }
  });
}

/**
 * Manda el aviso a cada token de iOS, en una sola conexión HTTP/2: es lo que
 * pide APNs (no abrir una conexión por notificación). Nunca lanza error.
 */
export async function enviarApns(tokens: string[], aviso: AvisoNativo): Promise<ResultadoApns> {
  const clave = claveApns();
  if (!clave) {
    return {
      enviados: 0,
      fallidos: tokens.length,
      muertos: [],
      razones: tokens.length > 0 ? ["falta la clave de APNs (APNS_TEAM_ID / APNS_KEY_ID / APNS_CLAVE_PRIVADA)"] : [],
    };
  }
  if (tokens.length === 0) return { enviados: 0, fallidos: 0, muertos: [], razones: [] };

  const host = process.env.APNS_ENTORNO === "sandbox" ? HOST_SANDBOX : HOST_PRODUCCION;

  // Firmar es lo primero que puede fallar, y su error de OpenSSL
  // (`DECODER routines::unsupported`) no menciona ni a APNs ni a la variable
  // que hay que arreglar. Se traduce acá, una sola vez, en vez de dejarlo
  // subir crudo hasta el que lo lea en un log.
  let jwt: string;
  try {
    jwt = jwtVigente(clave);
  } catch (error) {
    const razon = `APNS_CLAVE_PRIVADA no se pudo leer como clave (${(error as Error).message}). Suele ser el .p8 pegado sin sus saltos de línea.`;
    console.error(`APNs: ${razon}`);
    return { enviados: 0, fallidos: tokens.length, muertos: [], razones: [razon] };
  }

  const cuerpo = mensajeApns(aviso);

  try {
    const sesion = connect(`https://${host}`);
    // El error de sesión hay que escucharlo igual (si no, Node lo convierte en
    // una excepción no capturada), pero callarlo escondía justo el caso en que
    // NINGÚN envío sale: la conexión con Apple nunca se llegó a abrir.
    sesion.on("error", (error) => {
      console.error(`APNs: error de sesión HTTP/2 contra ${host}:`, error);
    });

    try {
      const resultados = await Promise.all(
        tokens.map((token) => enviarUno(sesion, token, jwt, cuerpo)),
      );
      const muertos = tokens.filter((_token, indice) => resultados[indice].estado === "muerto");
      const enviados = resultados.filter((resultado) => resultado.estado === "enviado").length;
      const razones = resultados.flatMap((resultado) => (resultado.razon ? [resultado.razon] : []));
      if (muertos.length > 0) {
        console.error(`APNs: ${muertos.length} de ${tokens.length} token(s) dados por muertos por Apple.`);
      }
      return { enviados, fallidos: resultados.length - enviados, muertos, razones };
    } finally {
      sesion.close();
    }
  } catch (error) {
    console.error(`APNs: no se pudo conectar a ${host}:`, error);
    return {
      enviados: 0,
      fallidos: tokens.length,
      muertos: [],
      razones: [`no se pudo conectar a ${host}: ${(error as Error).message}`],
    };
  }
}
