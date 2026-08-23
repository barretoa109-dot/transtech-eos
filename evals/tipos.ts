/**
 * Tipos compartidos de la suite de evals.
 *
 * Un eval NO es un test unitario. La diferencia que importa acá:
 *
 *   - Un test protege una función contra una regresión que ya conocemos.
 *   - Un eval mide, sobre un corpus de casos REALES, si el sistema sigue
 *     acertando cuando el mundo le manda lo que le manda de verdad.
 *
 * Por eso cada caso lleva `severidad`:
 *
 *   - `critico`: equivocarse mueve plata en la dirección equivocada, o mete un
 *     importe falso en el disponible real. **Ninguno puede fallar.** Un solo
 *     crítico roto devuelve código 1 y frena el deploy.
 *   - `deseable`: matices que preferimos acertar pero cuyo error no le miente
 *     al usuario sobre cuánta plata tiene. Se miden contra un umbral.
 *
 * Esa separación existe para que la suite pueda decir la verdad sobre sus
 * limitaciones sin quedar roja para siempre. Una suite siempre roja se ignora,
 * y una suite ignorada es peor que no tenerla: da la sensación de estar cubierto.
 */

export type Severidad = "critico" | "deseable";

export type Resultado = {
  ok: boolean;
  esperado: string;
  obtenido: string;
};

export type Caso = {
  nombre: string;
  severidad: Severidad;
  /** Por qué este caso está en el corpus. Si no se puede explicar, sobra. */
  porque: string;
  evaluar: () => Resultado;
};

export type Suite = {
  nombre: string;
  descripcion: string;
  casos: Caso[];
};
