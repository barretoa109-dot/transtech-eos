/**
 * Escritura en la bitácora inmutable (`eos_auditoria_v60`).
 *
 * La tabla se encarga de numerar, encadenar y sellar cada fila; desde acá solo
 * se describe QUÉ pasó. Nada de lo que se manda define la posición ni la fecha
 * del registro: si quien escribe pudiera elegir la fecha, podría antedatar.
 *
 * Regla de privacidad que este módulo hace cumplir: la página /privacidad
 * promete que el cuerpo de los avisos bancarios no se guarda, y un registro de
 * auditoría no es la excusa para guardarlo. `limpiarDetalle` recorta lo que se
 * escribe aunque quien llama se olvide.
 */

export type EventoAuditoria =
  | "correo_recibido"
  | "movimiento_ingerido"
  | "movimiento_descartado"
  | "movimiento_confirmado"
  | "accion_autorizada"
  | "accion_rechazada"
  | "datos_exportados"
  | "conciliacion_registrada";

export type OrigenAuditoria = "correo" | "documento" | "chat" | "panel" | "sistema";

export type EntradaAuditoria = {
  usuarioId: string;
  evento: EventoAuditoria;
  origen: OrigenAuditoria;
  /** Una línea legible por una persona, no por una máquina. */
  resumen: string;
  detalle?: Record<string, unknown>;
  /** Con qué se corresponde: id de correo, de movimiento, de aprobación. */
  referencia?: string | null;
};

/**
 * Claves que nunca se guardan, por más que alguien las mande.
 *
 * Dos familias: contenido libre que puede traer datos de terceros (el cuerpo
 * del correo, el HTML) y credenciales. La lista se compara sobre el nombre de
 * la clave en minúsculas y por inclusión, para que `access_token` y
 * `refresh_token` caigan con `token`.
 */
const CLAVES_PROHIBIDAS = [
  "texto",
  "html",
  "cuerpo",
  "body",
  "contenido",
  "mensaje",
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
];

/** Ningún valor de texto se guarda entero: un resumen no necesita 10 kB. */
const MAX_TEXTO = 200;

/**
 * Deja el detalle en algo seguro de persistir.
 *
 * Es una función pura y con tests propios porque es la única barrera entre un
 * `detalle` armado a las apuradas y una bitácora que termina guardando el
 * correo entero del banco.
 */
export function limpiarDetalle(detalle: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!detalle) return {};

  const limpio: Record<string, unknown> = {};

  for (const [clave, valor] of Object.entries(detalle)) {
    const nombre = clave.toLowerCase();

    if (CLAVES_PROHIBIDAS.some((prohibida) => nombre.includes(prohibida))) continue;
    if (valor === null || valor === undefined) continue;

    if (typeof valor === "string") {
      limpio[clave] = valor.length > MAX_TEXTO ? `${valor.slice(0, MAX_TEXTO)}…` : valor;
    } else if (typeof valor === "number" || typeof valor === "boolean") {
      limpio[clave] = valor;
    }
    // Objetos y arrays quedan afuera a propósito: son el camino por el que se
    // cuela un payload entero sin que nadie lo note.
  }

  return limpio;
}

/** Lo mínimo que se necesita del cliente de servicio, sin arrastrar sus tipos. */
type ClienteAdmin = {
  from: (tabla: string) => {
    insert: (fila: unknown) => PromiseLike<{ error: { message: string } | null }>;
  };
};

/**
 * Registra un hecho en la bitácora.
 *
 * **Nunca lanza y nunca aborta lo que estaba pasando.** Es una decisión con
 * costo: si el registro falla, la acción igual ocurre y queda sin asentar.
 * Al revés sería peor — negarle al usuario una aprobación que ya autorizó
 * porque falló un insert de auditoría rompe el producto para proteger un
 * papel—. Por eso el fallo se grita en el log del servidor: es un incidente,
 * no un detalle.
 */
export async function registrarAuditoria(
  admin: ClienteAdmin,
  entrada: EntradaAuditoria,
): Promise<boolean> {
  try {
    const { error } = await admin.from("eos_auditoria_v60").insert({
      usuario_id: entrada.usuarioId,
      evento: entrada.evento,
      origen: entrada.origen,
      resumen: entrada.resumen.slice(0, 300),
      detalle: limpiarDetalle(entrada.detalle),
      referencia: entrada.referencia ?? null,
    });

    if (error) {
      console.error("AUDITORÍA: no se pudo registrar", entrada.evento, error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.error("AUDITORÍA: excepción registrando", entrada.evento, error);
    return false;
  }
}

/** Registra varias entradas sin cortar si una falla. */
export async function registrarVarias(
  admin: ClienteAdmin,
  entradas: EntradaAuditoria[],
): Promise<number> {
  let ok = 0;
  for (const entrada of entradas) {
    if (await registrarAuditoria(admin, entrada)) ok += 1;
  }
  return ok;
}

/**
 * Redacta el resumen de un movimiento en el idioma del usuario, no en el de la
 * base de datos. "Ingreso de ₲50.000 leído del aviso de bancognb.com.py" le
 * contesta de dónde salió el número; `{"tipo":"ingreso","origen":"correo"}` no.
 */
export function resumirMovimiento(args: {
  tipo: "ingreso" | "gasto";
  monto: number;
  moneda: string;
  descripcion: string;
  fuente: string;
}): string {
  const simbolo = args.moneda === "PYG" ? "₲" : "US$";
  const monto = new Intl.NumberFormat("es-PY").format(args.monto);
  const verbo = args.tipo === "ingreso" ? "Ingreso" : "Gasto";

  return `${verbo} de ${simbolo} ${monto} — ${args.descripcion} (${args.fuente})`;
}
