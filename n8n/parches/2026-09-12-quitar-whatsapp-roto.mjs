/**
 * Saca del gateway el primer intento de WhatsApp, hecho entero adentro de n8n.
 *
 * ============================================================
 * POR QUÉ SE BORRA Y NO SE ARREGLA ACÁ
 * ============================================================
 *
 * Esta rama (`Webhook` de verificación GET, `Webhook1` que recibe el POST de
 * Meta, `WA Preparar Entrada` y `WA → EOS Gateway`) nunca resolvía a qué
 * cuenta de EOS correspondía el número: mandaba `usuario_id: null` y
 * reenviaba con un POST al propio webhook `eos-chat`. Ese segundo llamado
 * entra a `01 GW Preparar Entrada`, que exige un UUID, y explota. Resultado:
 * cero respuesta y una ejecución en error por cada mensaje de WhatsApp.
 *
 * La forma correcta ya existe y vive en la app, no en n8n:
 * `app/api/whatsapp/webhook/route.ts` resuelve el usuario_id contra
 * `eos_whatsapp_vinculos_v162` (vinculado por código, no por el número suelto)
 * y llama al `eos-chat` de siempre con un payload válido, reusando
 * `lib/eos/procesar-mensaje.ts` — el mismo motor del chat web. Dejar las dos
 * ramas vivas es exactamente la trampa de "una acción en cuatro lugares" que
 * ese archivo cita como motivo de su propia existencia.
 *
 * Los cinco nodos están aislados: ningún otro nodo del flujo principal se
 * conecta hacia ellos (verificado antes de escribir este parche). Sacarlos no
 * toca el camino del chat web.
 */

const NODOS_A_QUITAR = new Set([
  "Webhook",
  "Respond to Webhook",
  "Webhook1",
  "WA Preparar Entrada",
  "WA → EOS Gateway",
]);

export function aplicar(flujo) {
  const nodosRestantes = flujo.nodes.filter((n) => !NODOS_A_QUITAR.has(n.name));

  if (nodosRestantes.length !== flujo.nodes.length - NODOS_A_QUITAR.size) {
    throw new Error(
      "No se encontraron todos los nodos esperados de la rama de WhatsApp rota.",
    );
  }

  const conexionesRestantes = {};
  for (const [origen, valor] of Object.entries(flujo.connections)) {
    if (NODOS_A_QUITAR.has(origen)) continue;
    conexionesRestantes[origen] = valor;
  }

  return {
    ...flujo,
    nodes: nodosRestantes,
    connections: conexionesRestantes,
  };
}
