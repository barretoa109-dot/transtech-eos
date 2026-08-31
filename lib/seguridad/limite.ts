import { createHash } from "node:crypto";

/**
 * Un techo de solicitudes para las rutas que no piden sesión.
 *
 * ============================================================
 * DE DÓNDE SALE LA IP, Y POR QUÉ NO DE DONDE PARECE
 * ============================================================
 *
 * `x-forwarded-for` es una lista, y cualquiera puede mandarla. Si alguien pone
 * `x-forwarded-for: 1.2.3.4` en su pedido, el proxy AGREGA la IP real detrás:
 * la lista queda `1.2.3.4, <ip real>`.
 *
 * Entonces tomar el PRIMER elemento —que es lo que se hace casi siempre— deja
 * el límite sin efecto: el atacante manda una IP inventada distinta en cada
 * pedido y nunca choca contra su propio contador.
 *
 * El último elemento es el que puso el proxy, que es el único que no se puede
 * falsificar desde afuera. Por eso se toma ese, y `x-real-ip` antes que nada
 * porque en Vercel es el valor limpio.
 *
 * ============================================================
 * LA IP NO SE GUARDA
 * ============================================================
 *
 * Una IP es un dato personal, y /privacidad no promete guardarlas. Lo que viaja
 * a la base es `sha256(secreto + ruta + ip)`: alcanza para contar —la misma IP
 * da siempre la misma clave— y no alcanza para saber de quién es. Sin el
 * secreto no hay vuelta atrás, y sin sal por ruta un mismo visitante se vería
 * igual en todas.
 *
 * ============================================================
 * SI EL LÍMITE NO SE PUEDE CONSULTAR, SE DEJA PASAR
 * ============================================================
 *
 * Es la decisión incómoda de este archivo. Si la base no contesta, la
 * alternativa sería rechazar todo — y una caída de la base dejaría el
 * formulario de contacto muerto para todos los clientes de verdad, para
 * protegerse de un abuso que quizá no está pasando.
 *
 * Se deja pasar y se grita en el log. Un límite es una protección contra el
 * abuso, no un control de acceso: lo que protege datos es la sesión y la RLS,
 * y eso no depende de esto.
 */

export type Cupo = {
  permitido: boolean;
  intentos: number;
  maximo: number;
  faltan_segundos: number;
};

/**
 * La IP del cliente, tal como la dejó el proxy.
 *
 * Devuelve `null` cuando no hay ninguna cabecera confiable — en desarrollo, por
 * ejemplo. Sin IP no se puede limitar por IP, y eso lo decide quien llama.
 */
export function ipDelCliente(cabeceras: Headers): string | null {
  const real = cabeceras.get("x-real-ip")?.trim();
  if (real) return real;

  const reenviada = cabeceras.get("x-forwarded-for");
  if (!reenviada) return null;

  // El ÚLTIMO, no el primero: ver el comentario de cabecera.
  const partes = reenviada
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  return partes.length > 0 ? partes[partes.length - 1] : null;
}

/**
 * La clave con la que se cuenta, ya sin nada que identifique a nadie.
 *
 * Sin secreto configurado devuelve `null`: hashear con una sal vacía sería
 * publicar un diccionario de IPs disfrazado de hash, y es peor que no limitar.
 */
export function claveDeCupo(ruta: string, ip: string | null, secreto: string | undefined): string | null {
  if (!ip || !secreto || secreto.length < 16) return null;

  return createHash("sha256").update(`${secreto}${ruta}${ip}`).digest("hex");
}

/** Lo mínimo del cliente de servicio, sin arrastrar sus tipos. */
type ClienteAdmin = {
  rpc: (
    nombre: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/**
 * El secreto con el que se hashea la clave.
 *
 * Vive en una función aparte y no adentro de `consumirCupo` a propósito: leer
 * el entorno en medio de la lógica esconde una dependencia y vuelve la función
 * imposible de probar sin montar variables de entorno. Quien llama lo pasa.
 */
export function secretoDelEntorno(): string | undefined {
  return process.env.EOS_LIMITE_SECRETO || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export async function consumirCupo(
  admin: ClienteAdmin,
  opciones: {
    ruta: string;
    cabeceras: Headers;
    ventanaSegundos: number;
    maximo: number;
    secreto: string | undefined;
  },
): Promise<Cupo> {
  const librePorDefecto: Cupo = {
    permitido: true,
    intentos: 0,
    maximo: opciones.maximo,
    faltan_segundos: 0,
  };

  const clave = claveDeCupo(opciones.ruta, ipDelCliente(opciones.cabeceras), opciones.secreto);

  // Sin IP confiable no se puede contar por visitante. Pasa, y queda dicho.
  if (!clave) {
    console.warn(`Límite: sin IP confiable para ${opciones.ruta}; la solicitud pasa sin contar.`);
    return librePorDefecto;
  }

  try {
    const { data, error } = await admin.rpc("eos_consumir_cupo_v99", {
      p_clave: clave,
      p_ventana_segundos: opciones.ventanaSegundos,
      p_maximo: opciones.maximo,
    });

    if (error) {
      console.error("Límite: no se pudo consultar el cupo:", error.message);
      return librePorDefecto;
    }

    const cupo = data as Partial<Cupo> | null;

    return {
      permitido: cupo?.permitido !== false,
      intentos: Number(cupo?.intentos ?? 0),
      maximo: Number(cupo?.maximo ?? opciones.maximo),
      faltan_segundos: Number(cupo?.faltan_segundos ?? 0),
    };
  } catch (fallo) {
    console.error("Límite: excepción consultando el cupo:", fallo);
    return librePorDefecto;
  }
}

/**
 * La respuesta cuando el cupo se acabó.
 *
 * `Retry-After` va en segundos y con el número real: sin él, un cliente
 * legítimo que se pasó por un doble clic no sabe cuándo volver y reintenta en
 * bucle, que es exactamente lo que el límite quería evitar.
 */
export function respuestaSinCupo(cupo: Cupo, mensaje: string): Response {
  return new Response(JSON.stringify({ error: mensaje, reintentar_en: cupo.faltan_segundos }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(Math.max(1, cupo.faltan_segundos)),
      "Cache-Control": "no-store",
    },
  });
}
