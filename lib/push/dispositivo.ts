/**
 * Validación del token de push que manda la app nativa. Pura y probada, como
 * `lib/app-nativa/plataforma`: la ruta solo la usa para decidir si guarda o
 * rechaza el pedido.
 */

export type PlataformaPush = "ios" | "android";

export type DispositivoPush = {
  plataforma: PlataformaPush;
  token: string;
};

const PLATAFORMAS: readonly PlataformaPush[] = ["ios", "android"];
const LARGO_MINIMO = 16;
const LARGO_MAXIMO = 4096;

/** Devuelve el dispositivo si el cuerpo es válido, o `null` si no lo es. */
export function leerDispositivoPush(cuerpo: unknown): DispositivoPush | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;

  const { plataforma, token } = cuerpo as Record<string, unknown>;
  if (typeof plataforma !== "string" || !PLATAFORMAS.includes(plataforma as PlataformaPush)) {
    return null;
  }
  if (typeof token !== "string") return null;

  const limpio = token.trim();
  if (limpio.length < LARGO_MINIMO || limpio.length > LARGO_MAXIMO) return null;

  return { plataforma: plataforma as PlataformaPush, token: limpio };
}
