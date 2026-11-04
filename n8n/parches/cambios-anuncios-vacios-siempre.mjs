/**
 * El caso del relleno (02/11/2026): un anuncio sin un número adentro no
 * informa nada, salió bien o mal la acción. Hasta ahora el nodo 08 solo
 * sacaba los anuncios del modelo cuando algo fallaba o ya estaba; con todo
 * bien el texto quedaba como vino, aunque dijera "Anoté el saldo." o "La
 * tarea quedó registrada." sin monto ni dónde verlo.
 *
 * Reemplaza, en el nodo `08 GW Agregar Resultados Worker`, el bloque
 * inyectado por `n8n/parches/2026-09-29-finanzas-confirma-lo-guardado.mjs`
 * (`esAnuncio`, `sinAnuncios` de un solo argumento) por la versión actual de
 * `lib/gateway/sin-anuncios.ts` (agrega `esAnuncioVacio` y el segundo
 * argumento `soloVacios` de `sinAnuncios`), y la línea que arma `respuesta`.
 *
 * Pura, sin red: la prueba (`lib/gateway/finanzas-n8n.test.ts`) la aplica
 * sobre el workflow EXPORTADO y compara contra `juntarResultados`.
 */

import { FUNCIONES_SIN_ANUNCIOS_PARA_N8N } from "../../lib/gateway/sin-anuncios.ts";

const MARCA_VIEJA = "/* v221: sin anuncios, copiado de lib/gateway/sin-anuncios.ts */";
const MARCA_NUEVA = "/* 02/11/2026: el relleno se saca siempre, copiado de lib/gateway/sin-anuncios.ts */";

const USO_VIEJO =
  "const delModelo = extraerTexto(base.respuesta);\n" +
  "let respuesta = anunciosContradichos(resultados) ? sinAnuncios(delModelo) : (delModelo || 'Listo.');";

const USO_NUEVO =
  "const delModelo = extraerTexto(base.respuesta);\n" +
  "let respuesta = sinAnuncios(delModelo, !anunciosContradichos(resultados));";

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

/** Gateway, nodo `08 GW Agregar Resultados Worker`. */
export function transformarGateway(flujo) {
  const n = nodo(flujo, "08 GW Agregar Resultados Worker");
  let codigo = n.parameters.jsCode;
  if (codigo.includes(MARCA_NUEVA)) return flujo;

  const inicio = codigo.indexOf(MARCA_VIEJA);
  const finUso = codigo.indexOf(USO_VIEJO);
  if (inicio < 0 || finUso < 0) {
    throw new Error(
      "No encuentro, en el nodo 08, el bloque que dejó 2026-09-29-finanzas-confirma-lo-guardado.mjs. " +
        "¿Corrió ese parche?",
    );
  }

  const antes = codigo.slice(0, inicio);
  const despues = codigo.slice(finUso + USO_VIEJO.length);
  codigo = antes + MARCA_NUEVA + "\n" + fuente(FUNCIONES_SIN_ANUNCIOS_PARA_N8N) + "\n\n" + USO_NUEVO + despues;

  n.parameters.jsCode = codigo;
  return flujo;
}
