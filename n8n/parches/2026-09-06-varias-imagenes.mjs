/**
 * De una imagen por mensaje a diez.
 *
 *     node n8n/parches/2026-09-06-varias-imagenes.mjs
 *
 * El compositor aceptaba un archivo por mensaje. Quien saca cinco fotos de sus
 * facturas del día tenía que mandarlas de a una y gastar cinco mensajes de su
 * plan. La aplicación ya manda `archivos` (la lista completa) además de
 * `archivo` (el primero); este parche es la otra mitad, la que hace que el
 * modelo las VEA.
 *
 * Tres nodos:
 *
 *   01  arma `imagenes_data_url` con todas las imágenes de `archivos`. Este
 *       nodo descarta cualquier campo del payload que no nombre explícitamente,
 *       así que sin este cambio la lista viaja desde la app y se pierde en
 *       silencio: la app parece andar y el modelo nunca ve la segunda foto.
 *
 *   03  el texto que le avisa al modelo que hay imágenes pasa a nombrarlas en
 *       plural y a decir cuántas.
 *
 *   HTTP Request  manda un `input_image` por imagen en vez de uno solo.
 *
 * Se conservan `imagen_data_url` y `tiene_imagen` en singular: los usa el nodo
 * 05 para marcar `imagen_analizada` en la metadata, y no vale la pena tocar
 * eso en el mismo cambio.
 *
 * ============================================================
 * DE PASO: EL CONTEXTO ESTABA CORTADO EN 2.000 CARACTERES
 * ============================================================
 *
 * El nodo 01 recorta `contexto_negocio` a 2.000. Cuando ese campo llevaba solo
 * las cifras del mes alcanzaba de sobra. Desde el 6 de septiembre lleva además
 * la memoria de la persona —lo que contó, lo que se propuso, lo que funcionó—
 * y con eso el corte deja de ser teórico: se comería justo la parte de abajo,
 * que es la memoria.
 *
 * Sube a 6.000. El tope sigue existiendo porque este texto entra en CADA
 * llamada a OpenAI y sin tope una cuenta con mucho cargado le costaría a EOS
 * varias veces más que las demás; 6.000 caracteres son unos 1.500 tokens, que
 * al precio de hoy es ruido.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "JRgzUkoHBKgGpyPA";

function env() {
  const texto = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8");
  const valores = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) valores[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
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

// ------------------------------------------------------------------ nodo 01
const N01_VIEJO = `let imagen_data_url = '';
if (archivo && archivo_categoria === 'imagen') {
  imagen_data_url = archivo.base64.startsWith('data:')
    ? archivo.base64
    : \`data:\${archivo.tipo};base64,\${archivo.base64}\`;
}`;

const N01_NUEVO = `let imagen_data_url = '';
if (archivo && archivo_categoria === 'imagen') {
  imagen_data_url = archivo.base64.startsWith('data:')
    ? archivo.base64
    : \`data:\${archivo.tipo};base64,\${archivo.base64}\`;
}

/*
  TODAS las imágenes del mensaje, no solo la primera.

  \`archivos\` es la lista completa que manda /api/eos; \`archivo\` es el primero
  y se sigue recibiendo para que un cliente viejo —una pestaña abierta desde
  antes del despliegue— siga funcionando igual.

  Este nodo devuelve una lista explícita de campos y descarta lo que no
  nombra, así que si \`imagenes_data_url\` no se arma acá, la segunda foto
  viaja desde la app y se pierde sin que nada falle.
*/
const listaArchivos = Array.isArray(body.archivos) ? body.archivos : (archivo ? [archivo] : []);

const imagenes_data_url = listaArchivos
  .filter((a) => a && typeof a === 'object' && clean(a.tipo).startsWith('image/') && clean(a.base64))
  .slice(0, 10)
  .map((a) => {
    const b64 = clean(a.base64);
    return b64.startsWith('data:') ? b64 : \`data:\${clean(a.tipo)};base64,\${b64}\`;
  });`;

const N01_SALIDA_VIEJA = `    imagen_data_url,
    received_at:`;

const N01_SALIDA_NUEVA = `    imagen_data_url,
    imagenes_data_url,
    cantidad_imagenes: imagenes_data_url.length,
    received_at:`;

const N01_CONTEXTO_VIEJO = `    contexto_negocio: String(body.contexto_negocio || '').slice(0, 2000),`;
const N01_CONTEXTO_NUEVO = `    contexto_negocio: String(body.contexto_negocio || '').slice(0, 6000),`;

// ------------------------------------------------------------------ nodo 03
const N03_VIEJO = `const tieneImagen =
  !!i.archivo &&
  i.archivo_categoria === 'imagen' &&
  !!i.imagen_data_url;`;

const N03_NUEVO = `const imagenes = Array.isArray(i.imagenes_data_url) ? i.imagenes_data_url : [];

const tieneImagen =
  imagenes.length > 0 ||
  (!!i.archivo &&
    i.archivo_categoria === 'imagen' &&
    !!i.imagen_data_url);`;

const N03_AVISO_VIEJO = `    ? \`El usuario adjuntó una imagen llamada "\${i.archivo_nombre}". Analizá realmente el contenido visual de la imagen que acompaña este mensaje.\``;

const N03_AVISO_NUEVO = `    ? (imagenes.length > 1
        ? \`El usuario adjuntó \${imagenes.length} imágenes. Analizá realmente el contenido visual de TODAS las que acompañan este mensaje, y si se relacionan entre sí decilo.\`
        : \`El usuario adjuntó una imagen llamada "\${i.archivo_nombre}". Analizá realmente el contenido visual de la imagen que acompaña este mensaje.\`)`;

// ------------------------------------------------------- nodo HTTP Request
const HTTP_VIEJO = `          ...(
            $json.tiene_imagen && $json.imagen_data_url
              ? [
                  {
                    type: "input_image",
                    image_url: $json.imagen_data_url
                  }
                ]
              : []
          )`;

const HTTP_NUEVO = `          // Una entrada por imagen. La lista la arma el nodo 01 a partir de
          // \`archivos\`; el campo suelto queda como respaldo para un payload
          // viejo que todavía no la traiga.
          ...(
            Array.isArray($json.imagenes_data_url) && $json.imagenes_data_url.length
              ? $json.imagenes_data_url.map((url) => ({
                  type: "input_image",
                  image_url: url
                }))
              : ($json.tiene_imagen && $json.imagen_data_url
                  ? [
                      {
                        type: "input_image",
                        image_url: $json.imagen_data_url
                      }
                    ]
                  : [])
          )`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-gateway.json`);
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

function nodo(prefijo) {
  const n = flujo.nodes.find((x) => x.name === prefijo || x.name.startsWith(prefijo));
  if (!n) throw new Error(`No existe el nodo "${prefijo}".`);
  return n;
}

function cambiar(texto, viejo, nuevo, donde) {
  if (!texto.includes(viejo)) {
    throw new Error(`[${donde}] el texto que hay que reemplazar ya no está tal cual. No se escribió nada.`);
  }
  return texto.replace(viejo, nuevo);
}

const n01 = nodo("01 GW");
if (n01.parameters.jsCode.includes("imagenes_data_url")) {
  throw new Error("El nodo 01 ya está parcheado. No se escribió nada.");
}
let c01 = n01.parameters.jsCode;
c01 = cambiar(c01, N01_VIEJO, N01_NUEVO, "01/imagenes");
c01 = cambiar(c01, N01_SALIDA_VIEJA, N01_SALIDA_NUEVA, "01/salida");
c01 = cambiar(c01, N01_CONTEXTO_VIEJO, N01_CONTEXTO_NUEVO, "01/contexto");
n01.parameters.jsCode = c01;

const n03 = nodo("03 GW");
let c03 = n03.parameters.jsCode;
c03 = cambiar(c03, N03_VIEJO, N03_NUEVO, "03/tieneImagen");
c03 = cambiar(c03, N03_AVISO_VIEJO, N03_AVISO_NUEVO, "03/aviso");
n03.parameters.jsCode = c03;

const http = nodo("HTTP Request");
http.parameters.jsonBody = cambiar(http.parameters.jsonBody, HTTP_VIEJO, HTTP_NUEVO, "http/input_image");

const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, {
  method: "PUT",
  headers: CABECERAS,
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
