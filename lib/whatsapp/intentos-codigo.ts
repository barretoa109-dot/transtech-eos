import { createHash } from "node:crypto";

/*
 * Cuántas veces se puede probar un código de vinculación de WhatsApp.
 *
 * El código tiene 6 dígitos y vale 10 minutos. Quien lo canjea desde su
 * teléfono queda DENTRO de la cuenta que lo pidió: lee sus finanzas, registra
 * ventas, le escribe a sus clientes. Sin límite, cualquiera con un WhatsApp
 * podía mandar números al azar y, con suerte, entrar en la cuenta de alguien
 * que estaba vinculando el suyo en ese momento.
 *
 * Dos techos:
 *   - por teléfono: 5 intentos por hora. Una persona real acierta al primero;
 *     con cinco hay margen para un dedo torpe.
 *   - global: 100 intentos cada 10 minutos entre todos los teléfonos, para que
 *     rotar números no sirva de atajo.
 *
 * A diferencia de `consumirCupo`, esto FALLA CERRADO: si el contador no
 * responde, el código no se prueba. Es preferible que una persona tenga que
 * reintentar en un minuto a abrir la puerta porque la base tardó.
 */
export const MAX_POR_TELEFONO = 5;
export const VENTANA_TELEFONO_S = 3600;
export const MAX_GLOBAL = 100;
export const VENTANA_GLOBAL_S = 600;

type ClienteAdmin = {
  rpc: (
    nombre: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

function clave(secreto: string, parte: string): string {
  return createHash("sha256").update(`${secreto}whatsapp-codigo${parte}`).digest("hex");
}

async function consumir(admin: ClienteAdmin, p_clave: string, ventana: number, maximo: number) {
  const { data, error } = await admin.rpc("eos_consumir_cupo_v99", {
    p_clave,
    p_ventana_segundos: ventana,
    p_maximo: maximo,
  });
  if (error) throw new Error(error.message ?? "sin detalle");
  return (data as { permitido?: boolean } | null)?.permitido !== false;
}

export async function puedeProbarCodigo(
  admin: ClienteAdmin,
  telefono: string,
  secreto: string | undefined,
): Promise<boolean> {
  if (!secreto || secreto.length < 16) {
    console.error("WhatsApp: sin secreto para contar intentos de código; no se prueba.");
    return false;
  }

  try {
    const porTelefono = await consumir(admin, clave(secreto, `tel:${telefono}`), VENTANA_TELEFONO_S, MAX_POR_TELEFONO);
    if (!porTelefono) return false;
    return await consumir(admin, clave(secreto, "global"), VENTANA_GLOBAL_S, MAX_GLOBAL);
  } catch (error) {
    console.error("WhatsApp: no se pudo contar el intento de código; no se prueba.", error);
    return false;
  }
}
