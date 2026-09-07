/**
 * Lo que se muestra cuando una tarjeta del panel no pudo leer sus datos.
 *
 * ============================================================
 * LA DOCTRINA ES CALLARSE, PERO NO ANTE UN ERROR
 * ============================================================
 *
 * Las tarjetas del dashboard se callan solas cuando no tienen nada que decir:
 * un bloque de guiones no informa y ocupa la pantalla que necesita lo que sí
 * tiene algo. Eso está bien y es deliberado.
 *
 * El problema era escribirlo así:
 *
 *     if (error || data === null) return null;
 *
 * En una sola línea conviven tres cosas distintas —está cargando, se cayó, y
 * de verdad no hay nada— y las tres terminan en la misma pantalla vacía. Con
 * la red caída el panel entero desaparece: cinco tarjetas se van juntas y
 * queda un encabezado flotando, sin una palabra que explique por qué.
 *
 * Quien lo ve no concluye "hubo un error de red". Concluye que el producto no
 * tiene nada, o que se rompió para siempre.
 *
 * ============================================================
 * UN RENGLÓN, NO UNA TARJETA DE ERROR
 * ============================================================
 *
 * Cuando se cae la conexión se caen todas las tarjetas a la vez. Cinco cajas
 * rojas apiladas para un solo problema es peor que el silencio: parece que se
 * rompieron cinco cosas distintas.
 *
 * Por eso es un renglón fino con el nombre de lo que falló y qué hacer. Cinco
 * renglones se leen como lo que son —una caída— y cada uno dice qué parte del
 * panel falta, que es lo que no se podía saber antes.
 */
export default function FallaDeCarga({ que }: { que: string }) {
  return (
    <p className="fin-falla" role="alert">
      No pudimos cargar {que}. Volvé a entrar en un rato.
    </p>
  );
}
