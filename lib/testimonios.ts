/**
 * Lo que dicen clientes reales de EOS (punto 3 del plan de aceptación).
 *
 * En la simulación de 100 clientes (21/11/2026), varios comerciantes decían
 * "primero quiero ver a otro que lo use". Esto es para eso: casos reales del
 * piloto, con nombre, rubro y ciudad, en /planes y en la portada.
 *
 * ============================================================
 * REGLAS PARA AGREGAR UNO
 * ============================================================
 *
 * 1. Tiene que ser una persona real que usa EOS. Nada inventado, nada
 *    "inspirado en": un testimonio falso es publicidad engañosa.
 * 2. Con su permiso por escrito ANTES de publicarlo (un WhatsApp o un correo
 *    alcanza). En `consentimiento` va de dónde salió y la fecha, por ejemplo
 *    "WhatsApp 2026-12-03". Sin eso, `testimoniosPublicables` no lo muestra.
 * 3. La frase, como la dijo. Se puede acortar; no se puede reescribir.
 * 4. Si después pide que se saque, se borra de acá y listo.
 *
 * Mientras la lista esté vacía, la sección no aparece en ninguna página.
 */

export type Testimonio = {
  nombre: string;
  /** "Despensa", "Criadero de cerdos"... */
  rubro: string;
  ciudad: string;
  frase: string;
  /** De dónde salió el permiso y cuándo: "WhatsApp 2026-12-03". Obligatorio. */
  consentimiento: string;
};

export const TESTIMONIOS: readonly Testimonio[] = [];

/** Solo los que se pueden mostrar: completos y con permiso anotado. */
export function testimoniosPublicables(lista: readonly Testimonio[] = TESTIMONIOS): Testimonio[] {
  return lista.filter(
    (t) =>
      t.nombre.trim() !== "" &&
      t.rubro.trim() !== "" &&
      t.ciudad.trim() !== "" &&
      t.frase.trim().length >= 10 &&
      /\d{4}-\d{2}-\d{2}/.test(t.consentimiento),
  );
}
