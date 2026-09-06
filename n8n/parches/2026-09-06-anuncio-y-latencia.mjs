/**
 * Dos arreglos sobre el workflow del chat, en un solo PUT.
 *
 *     node n8n/parches/2026-09-06-anuncio-y-latencia.mjs
 *
 * Lee `N8N_BASE_URL` y `N8N_API_KEY` de `.env.local`. Antes de tocar nada deja
 * un respaldo con sello de fecha en `n8n/respaldos/`, y al terminar reexporta
 * el JSON versionado a `n8n/workflows/` sin credenciales.
 *
 * Si alguno de los dos textos que busca ya no está tal cual, no escribe nada y
 * sale con error: es preferible que alguien mire el workflow a que este script
 * lo deje a medio parchear.
 *
 * ============================================================
 * 1) EOS ANUNCIABA UN FINAL QUE NO CONOCÍA
 * ============================================================
 *
 * Las instrucciones del modelo todavía decían:
 *
 *   "Estas acciones SIEMPRE necesitan que el usuario las apruebe. Nunca digas
 *    que la venta quedó cargada [...]: decí que lo dejás listo para que lo
 *    confirme."
 *
 * Eso era cierto hasta el 3 de septiembre de 2026, cuando la puerta de
 * autonomía pasó a auto-aprobar las tres acciones del negocio (ver SYSTEM_RISK
 * en `lib/worker-gate-handler.ts`). Desde entonces la acción se ejecuta y el
 * modelo sigue diciendo que quedó pendiente.
 *
 * Probado contra producción el 6 de septiembre de 2026, pidiéndole agendar un
 * contacto. Respondió, textual:
 *
 *   "Dejo listo el alta de Rossana Benítez como cliente con el teléfono
 *    0981123456 para que lo confirmes.
 *
 *    El contacto quedo guardado. Lo ves en Negocio > Contactos."
 *
 * Dos finales opuestos en el mismo mensaje. El primero lo escribió el modelo,
 * el segundo lo agregó el sistema después de ejecutar de verdad. Quien lee eso
 * se queda con el primero —viene antes y suena a instrucción— espera una
 * confirmación que nunca llega, y concluye que EOS no registra nada. Es
 * exactamente el reporte que llegó del uso real.
 *
 * El arreglo no es cambiar un final por el otro: es que el modelo no anuncie
 * NINGUNO. Cuando escribe todavía no sabe qué va a decidir la puerta —puede
 * ejecutar, puede pedir aprobación si se pasó del presupuesto de riesgo del
 * día, puede fallar resolviendo el nombre del producto— y el sistema ya agrega
 * al final lo que pasó de verdad. Lo único que el modelo sí sabe, y que hace
 * falta, es QUÉ entendió: qué producto, cuántos, a quién. Eso es lo que le
 * permite al usuario darse cuenta de que entendió mal antes de que se ejecute.
 *
 * ============================================================
 * 2) SEIS SEGUNDOS PARA CONTAR UN CHISTE
 * ============================================================
 *
 * Medido en dos ejecuciones reales de producción (n8n 5545 y 5546, del 6 de
 * septiembre): el nodo de OpenAI tardó 6.461 ms y 3.484 ms en devolver 29
 * tokens de salida. La llamada no manda `reasoning`, así que la Responses API
 * usa el esfuerzo por defecto del modelo y piensa largo incluso para "decime
 * un chiste corto".
 *
 * `reasoning: { effort: "low" }`. El contexto ya viene resuelto por el
 * servidor —las cifras del negocio llegan calculadas y formateadas, no hay
 * que deducirlas— así que el razonamiento extra no estaba mejorando la
 * respuesta, la estaba demorando.
 *
 * Esto NO arregla toda la latencia. El otro segundo largo está en el nodo
 * "01.5 GW Verificar Reserva API", que vuelve a leer de Supabase la reserva de
 * cupo que la aplicación acaba de crear: 1.155 ms y 1.166 ms en esas mismas
 * dos ejecuciones. Se deja como está a propósito: es la puerta de admisión que
 * impide que cualquiera le pegue al webhook y gaste una llamada al modelo, y
 * moverla después de OpenAI sería sacar justamente lo que protege.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const ID = "JRgzUkoHBKgGpyPA";

function env() {
  const texto = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8");
  const valores = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) valores[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  if (!valores.N8N_BASE_URL || !valores.N8N_API_KEY) {
    throw new Error("Faltan N8N_BASE_URL o N8N_API_KEY en .env.local.");
  }
  return valores;
}

const { N8N_BASE_URL, N8N_API_KEY } = env();
const BASE = N8N_BASE_URL.replace(/\/$/, "");
const CABECERAS = { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" };

async function traer() {
  const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, { headers: CABECERAS });
  if (!r.ok) throw new Error(`GET falló: ${r.status} ${await r.text()}`);
  return r.json();
}

const REGLA_VIEJA = `- Estas acciones SIEMPRE necesitan que el usuario las apruebe. Nunca digas
  que la venta quedó cargada, que el stock quedó ajustado o que el cliente
  quedó agendado: decí que lo dejás listo para que lo confirme.`;

const REGLA_NUEVA = `- NO ANUNCIES EL RESULTADO. No digas ni que quedó cargado ni que quedó
  esperando aprobación: cuando escribís todavía no pasó. El sistema ejecuta
  la acción después de tu respuesta y agrega al final del mensaje lo que
  pasó de verdad. Si además lo decís vos, el usuario lee dos finales
  distintos para la misma acción y le cree al que viene primero, que es el
  tuyo y es el que puede estar equivocado.
- Tu "respuesta" para estas tres dice QUÉ entendiste que hay que hacer: qué
  producto, cuántos, a quién, por cuánto. Eso es lo único que sí sabés
  cuando escribís, y es lo que le permite al usuario darse cuenta de que
  entendiste mal antes de que se ejecute.`;

const ANCLA_MODELO = `    model: "gpt-5.5",`;

const CON_RAZONAMIENTO = `    model: "gpt-5.5",

    /*
      Esfuerzo de razonamiento explícito.

      Sin este campo la Responses API usa el default del modelo. En
      producción eso se midió en 3.484 ms y 6.461 ms para devolver 29 tokens
      (ejecuciones 5546 y 5545 del 6 de septiembre de 2026). El contexto del
      negocio ya llega calculado y formateado desde el servidor, así que el
      razonamiento largo no estaba mejorando la respuesta.
    */
    reasoning: { effort: "low" },`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-gateway.json`);
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

const nodo = flujo.nodes.find((n) => n.name === "HTTP Request");
if (!nodo) throw new Error('No existe el nodo "HTTP Request".');

let cuerpo = nodo.parameters.jsonBody;

if (!cuerpo.includes(REGLA_VIEJA)) {
  throw new Error("La regla de aprobación ya no está tal cual. No se escribió nada; revisá el workflow a mano.");
}
if (!cuerpo.includes(ANCLA_MODELO)) {
  throw new Error("No encontré la línea del modelo. No se escribió nada.");
}
if (cuerpo.includes("reasoning:")) {
  throw new Error("El nodo ya tiene un campo `reasoning`. No se escribió nada.");
}

cuerpo = cuerpo.replace(REGLA_VIEJA, REGLA_NUEVA).replace(ANCLA_MODELO, CON_RAZONAMIENTO);
nodo.parameters.jsonBody = cuerpo;

const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, {
  method: "PUT",
  headers: CABECERAS,
  // El PUT solo acepta estos cuatro campos.
  body: JSON.stringify({
    name: flujo.name,
    nodes: flujo.nodes,
    connections: flujo.connections,
    settings: flujo.settings ?? {},
  }),
});

if (!r.ok) throw new Error(`PUT falló: ${r.status} ${await r.text()}`);
console.log("workflow actualizado.");

const nuevo = await traer();
for (const n of nuevo.nodes) delete n.credentials;
fs.writeFileSync(
  path.join(RAIZ, "n8n", "workflows", "eos-conversational-gateway-rc1.json"),
  JSON.stringify(
    { name: nuevo.name, nodes: nuevo.nodes, connections: nuevo.connections, settings: nuevo.settings },
    null,
    2,
  ),
);
console.log("reexportado a n8n/workflows/eos-conversational-gateway-rc1.json");
