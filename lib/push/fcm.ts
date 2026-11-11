import { createSign } from "node:crypto";

/**
 * Envío de push a los teléfonos Android de la app nativa, por FCM HTTP v1.
 *
 * Es el canal nativo, separado del push web (`./enviar`, VAPID): el WebView
 * de la app no recibe Web Push. iOS va por APNs y todavía no está armado.
 *
 * Apagado sin configuración: si falta `FCM_SERVICE_ACCOUNT_JSON`, no se envía
 * nada y no se rompe nada. Ver docs/app-nativa/tiendas.md.
 */

export type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

export type AvisoNativo = {
  titulo: string;
  cuerpo: string;
  url?: string;
};

const URL_TOKEN = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function base64url(entrada: string | Buffer): string {
  return Buffer.from(entrada).toString("base64url");
}

/** La cuenta de servicio, si está configurada y es válida. */
export function cuentaDeServicio(): ServiceAccount | null {
  const crudo = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!crudo) return null;
  try {
    const cuenta = JSON.parse(crudo) as Partial<ServiceAccount>;
    if (!cuenta.project_id || !cuenta.client_email || !cuenta.private_key) return null;
    return cuenta as ServiceAccount;
  } catch {
    return null;
  }
}

/** El JWT que se intercambia por un token de acceso de Google. Pura: recibe el instante. */
export function jwtDeAcceso(cuenta: ServiceAccount, ahoraSegundos: number): string {
  const encabezado = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const reclamos = base64url(
    JSON.stringify({
      iss: cuenta.client_email,
      scope: SCOPE,
      aud: URL_TOKEN,
      iat: ahoraSegundos,
      exp: ahoraSegundos + 3600,
    }),
  );
  const firma = createSign("RSA-SHA256")
    .update(`${encabezado}.${reclamos}`)
    .sign(cuenta.private_key);
  return `${encabezado}.${reclamos}.${base64url(firma)}`;
}

/** El cuerpo del mensaje FCM v1 para un token. Pura. */
export function mensajeFcm(token: string, aviso: AvisoNativo) {
  return {
    message: {
      token,
      notification: { title: aviso.titulo, body: aviso.cuerpo },
      data: { url: aviso.url ?? "/eos/chat" },
      android: { priority: "HIGH" as const },
    },
  };
}

let tokenCache: { valor: string; expira: number } | null = null;

async function tokenDeAcceso(cuenta: ServiceAccount): Promise<string> {
  const ahora = Date.now();
  if (tokenCache && tokenCache.expira > ahora + 60_000) return tokenCache.valor;

  const respuesta = await fetch(URL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwtDeAcceso(cuenta, Math.floor(ahora / 1000)),
    }),
  });
  if (!respuesta.ok) throw new Error(`FCM: no se obtuvo el token de acceso (${respuesta.status})`);

  const datos = (await respuesta.json()) as { access_token: string; expires_in: number };
  tokenCache = { valor: datos.access_token, expira: ahora + datos.expires_in * 1000 };
  return datos.access_token;
}

export type ResultadoFcm = {
  enviados: number;
  fallidos: number;
  /** Tokens que FCM dio por muertos (desinstalada o caducada): hay que borrarlos. */
  muertos: string[];
  /** Por qué no salió cada uno que no salió. Ver `ResultadoApns.razones`. */
  razones: string[];
};

/**
 * Manda el aviso a cada token Android. Cada envío va aislado: un teléfono caído
 * no impide que el resto reciba el suyo.
 */
export async function enviarFcm(tokens: string[], aviso: AvisoNativo): Promise<ResultadoFcm> {
  const cuenta = cuentaDeServicio();
  if (!cuenta) {
    return {
      enviados: 0,
      fallidos: tokens.length,
      muertos: [],
      razones:
        tokens.length > 0
          ? ["FCM_SERVICE_ACCOUNT_JSON falta, no es JSON válido, o no tiene project_id/client_email/private_key"]
          : [],
    };
  }
  if (tokens.length === 0) return { enviados: 0, fallidos: 0, muertos: [], razones: [] };

  const acceso = await tokenDeAcceso(cuenta);
  const url = `https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`;

  let enviados = 0;
  let fallidos = 0;
  const muertos: string[] = [];
  const razones: string[] = [];

  for (const token of tokens) {
    try {
      const respuesta = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${acceso}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mensajeFcm(token, aviso)),
      });
      if (respuesta.ok) {
        enviados += 1;
        continue;
      }

      fallidos += 1;
      const cuerpo = (await respuesta.json().catch(() => null)) as {
        error?: { details?: { errorCode?: string }[]; message?: string };
      } | null;
      const codigo = cuerpo?.error?.details?.find((d) => d.errorCode)?.errorCode;
      const detalle = `HTTP ${respuesta.status} ${codigo ?? cuerpo?.error?.message ?? "(sin detalle)"} · ...${token.slice(-6)}`;
      razones.push(detalle);
      // UNREGISTERED: la app se desinstaló. INVALID_ARGUMENT: el token no es válido.
      if (codigo === "UNREGISTERED" || codigo === "INVALID_ARGUMENT") {
        muertos.push(token);
        continue;
      }
      // Sin esto, un fallo real (cuenta de servicio sin permiso, proyecto
      // equivocado) queda indistinguible de "no se pudo mandar" para siempre.
      console.error(`FCM: fallo ${detalle}`);
    } catch (error) {
      fallidos += 1;
      razones.push(`conexión: ${(error as Error).message} · ...${token.slice(-6)}`);
      console.error(`FCM: error de conexión para ...${token.slice(-6)}:`, error);
    }
  }

  return { enviados, fallidos, muertos, razones };
}
