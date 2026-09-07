/**
 * Que ningún parche escriba en producción un workflow que no compila.
 *
 * ============================================================
 * EL CASO QUE LO OBLIGÓ
 * ============================================================
 *
 * El 7 de septiembre de 2026, un parche agregó a las instrucciones del modelo
 * la palabra `total` entre comillas invertidas, para que se leyera como
 * nombre de campo. El prompt de n8n vive DENTRO de un literal de plantilla de
 * JavaScript, así que esa comilla lo terminó antes de tiempo: el prompt quedó
 * cortado en "El MONTO: mandá " y el cuerpo entero de la petición pasó a ser
 * JavaScript inválido.
 *
 * n8n aceptó el PUT sin una palabra. El chat de producción se cayó para todos
 * y se supo recién cuando falló una prueba del repositorio, después de haber
 * escrito.
 *
 * Compilar es instantáneo y no ejecuta nada: `new Function(codigo)` parsea y
 * tira si el texto no es JavaScript. Llamar a esto antes del PUT convierte una
 * caída de producción en un script que sale con error sin tocar nada.
 */

/**
 * Compila cada nodo de código y cada expresión `={{ … }}` del workflow.
 * Tira con el nombre del nodo si alguno no compila.
 */
export function verificarFlujo(flujo, etiqueta = "workflow") {
  let revisados = 0;

  for (const nodo of flujo.nodes ?? []) {
    const codigo = nodo.parameters?.jsCode;

    if (typeof codigo === "string") {
      try {
        new Function(codigo);
      } catch (e) {
        throw new Error(`[${etiqueta}] el nodo "${nodo.name}" no compila: ${e.message}`);
      }
      revisados += 1;
    }

    const cuerpo = nodo.parameters?.jsonBody;

    if (typeof cuerpo === "string" && cuerpo.startsWith("={{")) {
      const expresion = cuerpo.replace(/^=\{\{/, "(").replace(/\}\}$/, ")");
      try {
        new Function(`return ${expresion}`);
      } catch (e) {
        throw new Error(`[${etiqueta}] la expresión del nodo "${nodo.name}" no compila: ${e.message}`);
      }
      revisados += 1;
    }
  }

  return revisados;
}
