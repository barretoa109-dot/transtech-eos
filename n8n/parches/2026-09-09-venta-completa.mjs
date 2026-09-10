/**
 * Que la venta cuente lo que pasó, y que el precio se pueda cambiar hablando.
 *
 *     node n8n/parches/2026-09-09-venta-completa.mjs
 *
 * Va sobre el WORKER (nodo `05 INT Respuesta`) y hace tres cosas:
 *
 *   1. REGISTRAR_VENTA deja de caer en la frase genérica "La venta quedó
 *      registrada" y cuenta lo que la v149 ahora devuelve: qué productos se
 *      crearon en el camino y de cuáles falta el costo. Sin eso, una venta que
 *      creó un producto nuevo se ve igual que una común, y el margen queda
 *      pendiente sin que nadie se entere.
 *
 *   2. CREAR_PRODUCTO informa los costos que completó. La v149 ya no descarta
 *      un costo cuando el producto existe y no tenía ninguno — era el caso de
 *      una usuaria el 9 de septiembre de 2026: dijo el costo de los dos
 *      conjuntos, uno se creó con costo y el otro perdió el número.
 *
 *   3. Se borra "cambiarlo todavía se hace desde Negocio > Productos". Ese
 *      "todavía" venció con la v133: ACTUALIZAR_PRODUCTO existe y cambia
 *      precio, costo e IVA desde el chat. Mandar a la persona a otra pantalla
 *      para algo que EOS sabe hacer es exactamente lo que este producto
 *      existe para no hacer.
 *
 * NO toca el prompt ni las listas blancas: no hay ninguna acción nueva.
 */

import fs from "node:fs";
import path from "node:path";

import { verificarFlujo } from "./verificar.mjs";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);
const ID = "iUMdg9fhAg54irmy";

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

async function traer(intentos = 6) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, { headers: CABECERAS });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === intentos) throw e;
      await new Promise((s) => setTimeout(s, 1500 * i));
    }
  }
  return null;
}

// --------------------------------------------------------------- la venta
const VENTA_NUEVA = `/*
  La venta dice qué entró, qué se creó en el camino y qué margen queda
  pendiente.

  Las tres cosas por el mismo motivo: la persona tiene que poder ver el error
  sin ir a mirar otra pantalla. Que se haya creado un producto es una decisión
  que EOS tomó por ella —con el precio que ella dijo— y esconderla sería
  cargarle el catálogo a espaldas suyas. Y un margen pendiente que no se
  nombra es un margen que nadie va a completar nunca.
*/
function fraseDeVenta(result) {
  const r = (result && result.resultado) || {};
  const creados = Array.isArray(r.productos_creados) ? r.productos_creados : [];
  const sinCosto = Array.isArray(r.sin_costo) ? r.sin_costo : [];

  const frases = [];

  frases.push(
    r.total != null
      ? 'Registré la venta por \\u20B2 ' + plata(r.total) + '. La ves en Negocio > Ventas.'
      : 'La venta quedó registrada. La ves en Negocio > Ventas.'
  );

  if (creados.length === 1) {
    frases.push(
      'Como \\u201C' + creados[0].nombre + '\\u201D no estaba en tu catálogo, lo cargué a \\u20B2 ' +
      plata(creados[0].precio_venta) + '.'
    );
  } else if (creados.length > 1) {
    frases.push('Cargué ' + creados.length + ' productos que no estaban en tu catálogo, con el precio de esta venta.');
  }

  if (sinCosto.length === 1) {
    frases.push(
      'Todavía no sé cuánto te cuesta \\u201C' + sinCosto[0] + '\\u201D, así que el margen queda pendiente: ' +
      'decime el costo y lo completo.'
    );
  } else if (sinCosto.length > 1) {
    frases.push(
      'De ' + sinCosto.length + ' de esos productos no sé el costo, así que sus márgenes quedan pendientes: ' +
      'pasámelos y los completo.'
    );
  }

  return frases.join(' ');
}

`;

const ACCION_VIEJA = `function fraseDeAccion(accion, result) {
  if (accion === 'CREAR_PRODUCTO') return fraseDeProductos(result);`;

const ACCION_NUEVA = `function fraseDeAccion(accion, result) {
  if (accion === 'REGISTRAR_VENTA') return fraseDeVenta(result);
  if (accion === 'CREAR_PRODUCTO') return fraseDeProductos(result);`;

// ------------------------------------------------------------ los productos
const PRODUCTOS_VIEJO = `  const creados = Array.isArray(r.creados) ? r.creados : [];
  const existian = Array.isArray(r.ya_existian) ? r.ya_existian : [];`;

const PRODUCTOS_NUEVO = `  const creados = Array.isArray(r.creados) ? r.creados : [];
  const existian = Array.isArray(r.ya_existian) ? r.ya_existian : [];
  const costos = Array.isArray(r.costos_puestos) ? r.costos_puestos : [];`;

const EXISTIA_VIEJO = `  if (existian.length === 1) {
    partes.push(
      \`\\u201C\${existian[0]}\\u201D ya estaba y no le toqué el precio: cambiarlo todavía se hace desde Negocio > Productos.\`
    );
  } else if (existian.length > 1) {
    partes.push(
      \`\${existian.length} ya estaban y no les toqué el precio: cambiarlo todavía se hace desde Negocio > Productos.\`
    );
  }`;

const EXISTIA_NUEVO = `  /*
    Un costo que faltaba SÍ se completa. Ver la v149: la regla "crear no es
    editar" protege el precio, del que sale el margen de todo lo que se venda
    después. Un costo en NULL no tiene nada que proteger, y sin él el panel de
    rentabilidad no puede decir nada de ese producto.
  */
  if (costos.length === 1) {
    partes.push(
      \`A \\u201C\${costos[0].nombre}\\u201D, que ya estaba sin costo, le puse \\u20B2 \${plata(costos[0].costo)}.\`
    );
  } else if (costos.length > 1) {
    partes.push(\`A \${costos.length} que ya estaban sin costo les cargué el que me pasaste.\`);
  }

  /*
    Y el precio se cambia HABLANDO.

    Acá decía "cambiarlo todavía se hace desde Negocio > Productos". Ese
    "todavía" venció con la v133: ACTUALIZAR_PRODUCTO cambia precio, costo e
    IVA desde el chat. Mandar a la persona a otra pantalla para algo que EOS
    sabe hacer es lo que este producto existe para no hacer.
  */
  const nombrados = existian.filter((n) => !costos.some((c) => c.nombre === n));

  if (nombrados.length === 1) {
    partes.push(
      \`\\u201C\${nombrados[0]}\\u201D ya estaba y no le toqué el precio. Si querés cambiarlo, decímelo: \` +
      \`"subí \${nombrados[0]} a tanto".\`
    );
  } else if (nombrados.length > 1) {
    partes.push(
      \`\${nombrados.length} ya estaban y no les toqué el precio. Si querés cambiar alguno, decímelo y lo hago.\`
    );
  }`;

const flujo = await traer();

const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const respaldo = path.join(RAIZ, "n8n", "respaldos", `${sello}-worker.json`);
fs.mkdirSync(path.dirname(respaldo), { recursive: true });
fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2));
console.log(`respaldo: ${path.relative(RAIZ, respaldo)} (updatedAt ${flujo.updatedAt})`);

function nodo(prefijo) {
  const n = flujo.nodes.find((x) => x.name === prefijo || x.name.startsWith(prefijo));
  if (!n) throw new Error(`No existe el nodo "${prefijo}".`);
  return n;
}

function cambiar(texto, viejo, nuevo, donde) {
  const partes = texto.split(viejo);
  if (partes.length !== 2) {
    throw new Error(`[${donde}] el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
  }
  return partes.join(nuevo);
}

const n05 = nodo("05 INT Respuesta");

if (n05.parameters.jsCode.includes("fraseDeVenta")) {
  throw new Error("El nodo ya tiene fraseDeVenta. No se escribió nada.");
}

n05.parameters.jsCode = cambiar(
  n05.parameters.jsCode,
  ACCION_VIEJA,
  VENTA_NUEVA + ACCION_NUEVA,
  "05 INT/fraseDeVenta",
);

n05.parameters.jsCode = cambiar(
  n05.parameters.jsCode,
  PRODUCTOS_VIEJO,
  PRODUCTOS_NUEVO,
  "05 INT/costos_puestos",
);

n05.parameters.jsCode = cambiar(
  n05.parameters.jsCode,
  EXISTIA_VIEJO,
  EXISTIA_NUEVO,
  "05 INT/ya existían",
);

// Antes de escribir: que compile. Un parche que deja el workflow roto tira el
// chat entero y n8n acepta el PUT sin decir nada.
console.log(`verificado: ${verificarFlujo(flujo, "worker")} nodos compilan`);

/*
 * `SECO=1` prueba el parche sin escribir.
 *
 * Los anclajes son cadenas exactas contra un archivo de 40 KB: la mitad de las
 * veces que un parche falla es porque una de ellas ya no está. Poder
 * comprobarlo sin tocar producción convierte ese error en una línea de consola
 * en vez de un PUT a medias.
 */
if (process.env.SECO === "1") {
  // Sin `process.exit`: en Windows, salir con handles de red todavía abiertos
  // dispara una aserción de libuv que se lee como si el parche hubiera roto
  // algo. Terminar la ejecución normalmente no tiene ese problema.
  console.log("SECO=1: los tres anclajes encajaron y el workflow compila. No se escribió nada.");
} else {
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
  console.log("worker actualizado: la venta cuenta lo que hizo y el precio se cambia hablando.");
  console.log("Reexportar con: node n8n/exportar.mjs worker");
}
