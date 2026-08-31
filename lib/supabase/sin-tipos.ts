import { createAdminClient } from "../supabase-admin.ts";

/**
 * El cliente de servicio, admitiendo lo que los tipos generados no conocen.
 *
 * ============================================================
 * POR QUÉ ESTO EXISTE
 * ============================================================
 *
 * Buena parte de EOS no pasa por tablas: pasa por funciones de la base
 * (`eos_erp_registrar_venta`, `eos_contexto_negocio`, `eos_fe_siguiente_numero`
 * y una veintena más). Los tipos que genera Supabase no las incluyen, así que
 * cada llamada terminaba escrita igual:
 *
 *     // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ...
 *     const admin: any = createAdminClient();
 *
 * Repetido en veintidós archivos. El problema no es el `any` en sí —sin tipos
 * generados para esas funciones no hay nada mejor disponible— sino que estaba
 * desparramado: no se podía contar, ni encontrar, ni sacar el día que existan
 * los tipos. Treinta y seis excepciones sueltas no se leen como una decisión,
 * se leen como descuido.
 *
 * Acá hay UNA, con su nombre y su motivo. `adminSinTipos()` dice en la línea
 * misma qué se está haciendo, y `grep adminSinTipos` devuelve la lista completa
 * de lugares donde EOS se salta la verificación de tipos.
 *
 * ============================================================
 * LO QUE ESTO NO ES
 * ============================================================
 *
 * No es una puerta trasera de permisos. El cliente que devuelve es el mismo de
 * siempre: `service_role`, que se salta la RLS. Lo que cambia es únicamente qué
 * sabe TypeScript de él, no qué puede hacer.
 *
 * Por eso vale la regla de siempre, sin excepción: toda ruta que use esto tiene
 * que filtrar por el usuario de la sesión a mano, porque la RLS no la va a
 * cubrir. Las funciones que reciben `p_usuario_id` lo exigen adentro; las
 * consultas directas lo tienen que poner en su `.eq()`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la única del proyecto; el porqué está arriba
export type ClienteSinTipos = any;

export function adminSinTipos(): ClienteSinTipos {
  return createAdminClient();
}
