/**
 * Qué se puede escribir en el log del servidor, y qué no.
 *
 * ============================================================
 * EL LOG NO ES UN LUGAR PRIVADO
 * ============================================================
 *
 * Lo que sale por `console.error` va al flujo de registros de Vercel: queda
 * guardado, lo ve cualquiera con acceso al panel, y no se borra cuando el
 * usuario pide que lo borren. La página /privacidad promete que el cuerpo de
 * los avisos bancarios no se guarda; un `console.error` que lo imprime es la
 * misma promesa rota por otro camino.
 *
 * La bitácora de auditoría ya resuelve esto para lo que se persiste a propósito
 * (`limpiarDetalle` en `lib/auditoria/registrar.ts`). Faltaba lo que se escribe
 * sin pensarlo: el objeto entero que se pasa como segundo argumento cuando algo
 * falla y hay apuro por entender qué pasó.
 *
 * ============================================================
 * LOS TRES CASOS QUE APARECIERON AL BUSCARLOS
 * ============================================================
 *
 *   · la respuesta cruda de n8n cuando el chat falla — que puede traer de
 *     vuelta el mensaje que escribió la persona;
 *   · la fila de un efecto del worker, con el payload de la acción adentro;
 *   · el objeto de autorización de una aprobación, con su snapshot.
 *
 * Ninguno se escribió con mala intención. Los tres son "pasale el objeto, que
 * después vemos", que es como se escriben todos.
 *
 * ============================================================
 * LA REGLA
 * ============================================================
 *
 * Lo que ayuda a diagnosticar es la FORMA del error: qué código, qué campos
 * faltaban, cuántos elementos. Lo que no ayuda y sí compromete es el
 * CONTENIDO. Así que pasan los escalares con nombre inocuo, y no pasa nada más.
 *
 * Un texto libre no se puede juzgar por su nombre, así que no pasa nunca: se
 * dice cuánto medía y se descarta. Si alguien necesita el cuerpo para depurar,
 * lo reproduce; no se guarda la conversación de una persona por las dudas.
 */

/**
 * Nombres de campo que nunca se registran, por más inocuos que parezcan en el
 * momento. Se compara en minúsculas y por inclusión, así `access_token` cae
 * con `token` y `user_email` con `email`.
 */
const PROHIBIDAS = [
  // Contenido libre: puede traer lo que escribió una persona.
  "texto",
  "html",
  "cuerpo",
  "body",
  "contenido",
  "mensaje",
  "message",
  "respuesta",
  "prompt",
  "descripcion",
  "notas",
  "payload",
  "snapshot",
  // Quién es.
  "email",
  "correo",
  "telefono",
  "documento",
  "ruc",
  "nombre",
  "direccion",
  // Credenciales.
  "token",
  "secret",
  "password",
  "contrasena",
  "contraseña",
  "api_key",
  "apikey",
  "authorization",
  "private_key",
  "cookie",
  "jwt",
];

const MAX_TEXTO = 120;
const MAX_CLAVES = 20;

function claveProhibida(nombre: string): boolean {
  const bajo = nombre.toLowerCase();
  return PROHIBIDAS.some((p) => bajo.includes(p));
}

/**
 * Deja un valor en algo que se puede escribir en el log.
 *
 * No lanza nunca: un fallo acá pasaría justo cuando se está intentando
 * registrar otro fallo, y taparía el original.
 */
export function paraRegistro(valor: unknown): unknown {
  try {
    if (valor === null || valor === undefined) return valor;

    // Un Error se registra por su mensaje. La traza no se recorta porque no
    // lleva datos del usuario, pero el mensaje sí puede: se recorta.
    if (valor instanceof Error) {
      return `${valor.name}: ${valor.message.slice(0, MAX_TEXTO)}`;
    }

    if (typeof valor === "number" || typeof valor === "boolean") return valor;

    /*
     * Un texto suelto no se puede juzgar por su nombre, porque no tiene.
     *
     * Si es JSON, se lo trata como objeto y se le aplica la misma regla que a
     * cualquier otro. Si no lo es, puede ser cualquier cosa —incluida la
     * respuesta de EOS a una pregunta personal— y entonces solo se dice cuánto
     * medía.
     */
    if (typeof valor === "string") {
      const recortado = valor.trim();
      if (recortado.startsWith("{") || recortado.startsWith("[")) {
        try {
          return paraRegistro(JSON.parse(recortado));
        } catch {
          // No era JSON después de todo.
        }
      }

      return `«${valor.length} caracteres, no se registran»`;
    }

    if (Array.isArray(valor)) {
      return `«lista de ${valor.length}»`;
    }

    if (typeof valor === "object") {
      const limpio: Record<string, unknown> = {};
      let omitidas = 0;

      for (const [clave, contenido] of Object.entries(valor as Record<string, unknown>)) {
        if (Object.keys(limpio).length >= MAX_CLAVES) {
          omitidas += 1;
          continue;
        }

        if (claveProhibida(clave)) {
          omitidas += 1;
          continue;
        }

        if (contenido === null) {
          limpio[clave] = null;
        } else if (typeof contenido === "number" || typeof contenido === "boolean") {
          limpio[clave] = contenido;
        } else if (typeof contenido === "string") {
          limpio[clave] =
            contenido.length > MAX_TEXTO ? `${contenido.slice(0, MAX_TEXTO)}…` : contenido;
        } else if (Array.isArray(contenido)) {
          limpio[clave] = `«lista de ${contenido.length}»`;
        } else if (typeof contenido === "object") {
          // Un objeto anidado es el camino por el que se cuela todo el resto.
          limpio[clave] = "«objeto»";
        }
      }

      if (omitidas > 0) limpio.__omitidos = omitidas;

      return limpio;
    }

    return "«valor de tipo desconocido»";
  } catch {
    return "«no se pudo preparar para el registro»";
  }
}

/**
 * Lo que se puede decir de una respuesta HTTP que falló, sin su cuerpo.
 *
 * El cuerpo de un error de n8n puede traer de vuelta el mensaje que escribió la
 * persona. Lo que sirve para diagnosticar es el código y el tamaño; si hace
 * falta el cuerpo, se reproduce.
 */
export function resumenDeRespuesta(status: number, cuerpo: string): Record<string, unknown> {
  return {
    status,
    largo: cuerpo.length,
    // Si el cuerpo es un JSON de error, sus campos con nombre inocuo sí ayudan
    // y ya pasaron por la criba.
    ...(typeof paraRegistro(cuerpo) === "object" ? { detalle: paraRegistro(cuerpo) } : {}),
  };
}
