/**
 * Teléfonos de clientes, para encontrar al cliente correcto del CRM.
 *
 * ============================================================
 * POR QUÉ NO ALCANZA CON COMPARAR TEXTO
 * ============================================================
 *
 * El mismo cliente está escrito de cuatro maneras: "0981 123 456" en la
 * ficha, "+595 981 123456" en un correo, "595981123456" como lo manda la API
 * de WhatsApp (`messages[].from`, siempre E.164 sin el "+"). Comparar los
 * textos crudos deja al cliente de siempre como "número nuevo" y le abre una
 * ficha duplicada con cada mensaje.
 *
 * ============================================================
 * QUÉ SE ASUME Y QUÉ NO
 * ============================================================
 *
 * Se asume Paraguay (595) SOLO cuando el número viene en formato local: con 0
 * inicial ("0981…") o de 9 dígitos que empiezan con 9 ("981123456"). Un
 * número que ya trae otro código de país se respeta tal cual.
 *
 * Lo que no se puede leer como teléfono devuelve `null`: no se inventa un
 * número, porque un teléfono equivocado asocia la conversación de un cliente
 * a la ficha de otro.
 */

/** Largo mínimo y máximo de un E.164 sin el "+" (ITU-T E.164: hasta 15 dígitos). */
const MIN_DIGITOS = 8;
const MAX_DIGITOS = 15;

export function normalizarTelefono(texto: string | null | undefined): string | null {
  if (!texto) return null;

  const soloDigitos = String(texto).replace(/\D+/g, "");
  if (!soloDigitos) return null;

  let digitos = soloDigitos;

  // "00595…" es el prefijo internacional escrito a la vieja usanza.
  if (digitos.startsWith("00")) digitos = digitos.slice(2);
  // "0981123456": formato local paraguayo, el 0 es el prefijo de larga distancia.
  else if (digitos.startsWith("0") && digitos.length >= 9) digitos = `595${digitos.slice(1)}`;
  // "981123456": el móvil sin ningún prefijo.
  else if (digitos.length === 9 && digitos.startsWith("9")) digitos = `595${digitos}`;

  if (digitos.length < MIN_DIGITOS || digitos.length > MAX_DIGITOS) return null;

  return digitos;
}

/** ¿Es la misma línea, escrita como sea? Dos `null` NO son el mismo teléfono. */
export function mismoTelefono(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizarTelefono(a);
  const nb = normalizarTelefono(b);
  return na !== null && nb !== null && na === nb;
}
