/**
 * Lo que el parche del caso Green le hace a los dos workflows, como funciones
 * puras: reciben el workflow y lo devuelven cambiado, sin red.
 *
 * Van aparte del script que escribe en n8n para que la prueba
 * (`lib/gateway/finanzas-n8n.test.ts`) las aplique sobre los workflows
 * EXPORTADOS y compruebe que n8n dice exactamente lo mismo que TypeScript.
 *
 * El código que se inyecta sale de `lib/gateway/frases-finanzas.ts` y
 * `lib/gateway/sin-anuncios.ts` con `Function.prototype.toString`: no hay una
 * segunda copia escrita a mano que se pueda desincronizar.
 */

import { FUNCIONES_PARA_N8N } from "../../lib/gateway/frases-finanzas.ts";
import { FUNCIONES_SIN_ANUNCIOS_PARA_N8N } from "../../lib/gateway/sin-anuncios.ts";
import { aplicar } from "./cambios-finanzas-confirma-lo-guardado.mjs";

const MARCA_WORKER = "/* v221: frases de finanzas, copiadas de lib/gateway/frases-finanzas.ts */";
const MARCA_GATEWAY = "/* v221: sin anuncios, copiado de lib/gateway/sin-anuncios.ts */";

function fuente(funciones) {
  const texto = funciones.map((f) => f.toString()).join("\n\n");
  if (texto.includes("`")) throw new Error("El código a inyectar trae una comilla invertida.");
  return texto;
}

function nodo(flujo, prefijo) {
  const n = flujo.nodes.find((x) => x.name === prefijo || x.name.startsWith(prefijo));
  if (!n) throw new Error(`No existe el nodo "${prefijo}".`);
  return n;
}

/** Saca una declaración `function nombre(...) {...}` de nivel superior. */
function sacarFuncion(codigo, nombre) {
  const inicio = codigo.indexOf(`function ${nombre}(result) {`);
  if (inicio < 0) throw new Error(`No encuentro function ${nombre} en el worker.`);
  const fin = codigo.indexOf("\n}\n", inicio);
  if (fin < 0) throw new Error(`No encuentro dónde termina ${nombre}.`);
  return codigo.slice(0, inicio) + codigo.slice(fin + 3);
}

/** Worker, nodo `05 INT Respuesta`: las frases de tarjeta, compra con tarjeta y personal. */
export function transformarWorker(flujo) {
  const n = nodo(flujo, "05 INT Respuesta");
  let codigo = n.parameters.jsCode;
  if (codigo.includes(MARCA_WORKER)) return flujo;

  for (const nombre of ["fraseDePersonal", "fraseDeTarjeta", "fraseDeCompraTarjeta"]) {
    codigo = sacarFuncion(codigo, nombre);
  }

  // El pago de deuda contra una tarjeta (v222) no traía acreedor y decía
  // "No quedó registrado el pago." sobre un pago que sí quedó.
  const pago = "function fraseDePagoDeuda(result) {";
  if (codigo.split(pago).length !== 2) throw new Error("No encuentro fraseDePagoDeuda en el worker.");
  codigo = codigo.replace(
    pago,
    () => pago + "\n  if (result && result.resultado && result.resultado.es_tarjeta === true) return fraseDePagoTarjeta(result);",
  );

  const ancla = "function fraseDeAccion(accion, result) {";
  if (codigo.split(ancla).length !== 2) throw new Error("No encuentro fraseDeAccion en el worker.");
  codigo = codigo.replace(ancla, () => `${MARCA_WORKER}\n${fuente(FUNCIONES_PARA_N8N)}\n\n${ancla}`);

  n.parameters.jsCode = codigo;
  return flujo;
}

/** Gateway: el prompt y, en el nodo 08, los anuncios que los comprobantes contradicen. */
export function transformarGateway(flujo) {
  const http = nodo(flujo, "HTTP Request");
  http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

  const n = nodo(flujo, "08 GW Agregar Resultados Worker");
  let codigo = n.parameters.jsCode;
  if (codigo.includes(MARCA_GATEWAY)) return flujo;

  const inicio = "let respuesta =\n  extraerTexto(base.respuesta) ||\n  'Listo.';";
  if (codigo.split(inicio).length !== 2) throw new Error("No encuentro el armado de la respuesta en el nodo 08.");
  codigo = codigo.replace(
    inicio,
    () =>
      `${MARCA_GATEWAY}\n${fuente(FUNCIONES_SIN_ANUNCIOS_PARA_N8N)}\n\n` +
      "/*\n  Si algo falló o ya estaba, lo que el modelo anunció antes de ejecutar\n" +
      "  no vale: se sacan sus anuncios y mandan los comprobantes (29/09/2026).\n*/\n" +
      "const delModelo = extraerTexto(base.respuesta);\n" +
      "let respuesta = anunciosContradichos(resultados) ? sinAnuncios(delModelo) : (delModelo || 'Listo.');",
  );

  const cierre = "const accionesEjecutadas = validos";
  if (codigo.split(cierre).length !== 2) throw new Error("No encuentro accionesEjecutadas en el nodo 08.");
  codigo = codigo.replace(cierre, () => `if (!respuesta.trim()) respuesta = 'Listo.';\n\n${cierre}`);

  n.parameters.jsCode = codigo;
  return flujo;
}
