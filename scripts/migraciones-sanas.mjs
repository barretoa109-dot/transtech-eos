#!/usr/bin/env node
/**
 * Que las migraciones puedan correr desde cero.
 *
 * ============================================================
 * QUÉ PROBLEMA RESUELVE
 * ============================================================
 *
 * La base de producción está sana porque las migraciones se fueron aplicando
 * de a una, en el orden en que se escribieron, sobre un estado que ya existía.
 * Eso NO demuestra que corran desde una base vacía, que es lo que pasa cuando
 * alguien clona el repo, cuando se arma un entorno de pruebas o cuando hay que
 * reconstruir después de un incidente.
 *
 * El 2 de septiembre de 2026 dos agentes escribieron, sin saberlo, dos
 * migraciones distintas con el mismo timestamp `20260902100000`. En la base ya
 * aplicada no pasó nada: las dos habían corrido bajo versiones distintas. Pero
 * en una instalación desde cero Supabase usa el timestamp como clave, así que
 * habría aplicado UNA y salteado la otra en silencio — dejando código llamando
 * a una función que no existe. Pasó dos veces en el mismo día.
 *
 * Un error que sólo se ve al reconstruir es el peor momento posible para
 * verlo. Esto lo ve en dos segundos y sin base de datos.
 *
 * ============================================================
 * QUÉ NO ES
 * ============================================================
 *
 * No reemplaza aplicar las migraciones en un proyecto limpio. Es análisis de
 * texto: encuentra las tres formas de romper el orden que sí se pueden ver sin
 * ejecutar nada, y no puede encontrar las demás. El punto 4 de la lista de
 * lanzamiento sigue abierto hasta que las 178 corran de verdad sobre una base
 * vacía.
 */

import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "supabase", "migrations");

const archivos = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const problemas = [];
const avisos = [];

// ============================================================
// 1. Dos migraciones no pueden compartir versión
// ============================================================
//
// Supabase guarda el timestamp como clave primaria del historial. Con dos
// archivos iguales, uno se aplica y el otro se saltea sin decir nada.

const porVersion = new Map();

for (const archivo of archivos) {
  const version = archivo.slice(0, 14);

  if (!/^\d{14}$/.test(version)) {
    problemas.push(`${archivo}: no empieza con un timestamp de 14 dígitos.`);
    continue;
  }

  if (!porVersion.has(version)) porVersion.set(version, []);
  porVersion.get(version).push(archivo);
}

for (const [version, lista] of porVersion) {
  if (lista.length > 1) {
    problemas.push(
      `Versión ${version} repetida en ${lista.length} archivos: ${lista.join(", ")}.\n` +
        `      Desde cero se aplicaría UNA sola y las otras se saltean en silencio.`,
    );
  }
}

// ============================================================
// 2. Ninguna puede estar vacía
// ============================================================
//
// Una migración vacía queda registrada como aplicada y no hace nada. Si
// alguien la vació creyendo que la deshacía, la base queda distinta del
// código y el historial dice que todo está bien.

/*
 * La única excepción, con nombre y motivo.
 *
 * Es el archivo que dejó el primer `supabase migration new` y que nunca se
 * llenó. Ya está registrado como aplicado en producción, así que borrarlo
 * dejaría el historial remoto con una versión que el repo no tiene y el
 * próximo `db push` se quejaría de la diferencia.
 *
 * Se queda, y el control lo sabe. Una excepción escrita con su razón es
 * auditable; una regla que mira para otro lado, no. Si aparece otra migración
 * vacía, salta.
 */
const VACIAS_ACEPTADAS = new Set(["20260801221416_new-migration.sql"]);

for (const archivo of archivos) {
  const texto = fs.readFileSync(path.join(DIR, archivo), "utf8");
  const sinComentarios = texto
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();

  if (sinComentarios.length > 0) continue;

  if (VACIAS_ACEPTADAS.has(archivo)) {
    avisos.push(`${archivo} está vacía y es la excepción conocida (el stub del primer día).`);
    continue;
  }

  problemas.push(`${archivo}: no tiene una sola sentencia. Registrarla no cambia nada.`);
}

// ============================================================
// 3. Una tabla no se puede usar antes de crearse
// ============================================================
//
// El caso que rompe una instalación desde cero sin que nadie lo note en la
// base ya aplicada: `alter table`, `create trigger on` o una clave foránea
// contra una tabla que se crea en una migración POSTERIOR.
//
// Se mira sólo `public.` y nombres explícitos. Es a propósito: preferimos no
// avisar de algo dudoso antes que llenar esto de falsos positivos, porque una
// verificación que grita seguido enseña a ignorarla.

const creada = new Map();

for (const archivo of archivos) {
  const texto = fs.readFileSync(path.join(DIR, archivo), "utf8");

  for (const m of texto.matchAll(
    /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi,
  )) {
    const tabla = m[1].toLowerCase();
    if (!creada.has(tabla)) creada.set(tabla, archivo);
  }
}

for (const archivo of archivos) {
  const texto = fs.readFileSync(path.join(DIR, archivo), "utf8");
  const sinComentarios = texto.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  const usos = [
    [/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.([a-z_][a-z0-9_]*)/gi, "alter table"],
    [/create\s+trigger\s+\S+[\s\S]{0,200}?\son\s+public\.([a-z_][a-z0-9_]*)/gi, "create trigger"],
    [/references\s+public\.([a-z_][a-z0-9_]*)/gi, "clave foránea"],
  ];

  for (const [patron, que] of usos) {
    for (const m of sinComentarios.matchAll(patron)) {
      const tabla = m[1].toLowerCase();
      const donde = creada.get(tabla);

      // Sin `create table` en ningún lado puede ser de `auth`, `storage` o de
      // una extensión: no es asunto de este control.
      if (!donde) continue;

      if (donde > archivo) {
        problemas.push(
          `${archivo}: usa ${que} sobre "${tabla}", que recién se crea en ${donde}.\n` +
            `      En la base actual funciona; desde cero falla.`,
        );
      }
    }
  }
}

// ============================================================
// 4. El monto se lee con eos_leer_monto, y con nada más
// ============================================================
//
// Once funciones leían el monto del chat con esta expresión:
//
//     nullif(regexp_replace(coalesce(…), '[^0-9.]', '', 'g'), '')::numeric
//
// Deja pasar el punto, que en Paraguay es el separador de MILES. "800.000"
// entra como OCHOCIENTOS y no falla: la confirmación dice "listo" y el panel
// del mes queda mil veces por debajo sin una sola señal. La v150 lo movió a
// `public.eos_leer_monto`, que sabe leer un separador.
//
// El control mira sólo las migraciones POSTERIORES a la v150: las de antes
// tienen la expresión vieja en su texto histórico y así tienen que quedar —
// reescribir un archivo ya aplicado no cambia la base y sí borra el rastro de
// lo que realmente corrió.

const V150 = "20260909120000";

for (const archivo of archivos) {
  if (archivo.slice(0, 14) <= V150) continue;

  const texto = fs.readFileSync(path.join(DIR, archivo), "utf8");
  const sinComentarios = texto.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  /*
   * También `[^0-9.\-]`, que es la MISMA expresión con el signo menos.
   *
   * Se coló el 10 de septiembre de 2026 copiando `eos_erp_crear_productos_v131`
   * a una migración nueva: el control sólo miraba la forma sin el menos, así
   * que la copia pasó limpia leyendo un costo de "142.442,46" como 142. El
   * error no está en el guion, está en que el punto sobrevive.
   */
  if (/'\[\^0-9\.(\\-)?\]'/.test(sinComentarios)) {
    problemas.push(
      `${archivo}: lee un monto con la expresión vieja '[^0-9.]'.\n` +
        `      Usá public.eos_leer_monto(...): esa expresión toma "800.000" por 800.`,
    );
  }
}

// ============================================================
// 5. El orden de los archivos tiene que ser el de las fechas
// ============================================================
//
// Sólo un aviso: un archivo con fecha muy anterior a su vecino suele ser un
// renombrado a medias, y conviene mirarlo aunque no rompa nada.

for (let i = 1; i < archivos.length; i++) {
  const anterior = archivos[i - 1].slice(0, 8);
  const actual = archivos[i].slice(0, 8);

  if (/^\d{8}$/.test(anterior) && /^\d{8}$/.test(actual) && actual < anterior) {
    avisos.push(`${archivos[i]} tiene fecha anterior a ${archivos[i - 1]}, que va antes.`);
  }
}

// ============================================================
// 6. Una función no puede quedar viva con dos firmas distintas
// ============================================================
//
// `create or replace function` sólo reemplaza una firma que coincide EXACTO
// en cantidad y tipo de parámetros. Agregarle un parámetro a una función que
// ya existía no la reemplaza: crea una SEGUNDA función con el mismo nombre,
// viva al lado de la primera — y Postgres elige cuál llamar según cuántos
// argumentos le pasen, no según cuál se escribió último.
//
// Pasó dos veces (v90, 28/08/2026, y v283, 13/10/2026): la segunda firma
// quedó ejecutable sin que nadie lo pidiera, y en la v283 además alcanzable
// por `anon` sin sesión. `grants-sanos.mjs` ya compara permisos por firma
// completa; esto mira la FIRMA en sí, para agarrarlo antes de que llegue a
// los grants.
//
// Sólo cuenta la CANTIDAD de parámetros: es la forma concreta en que pasó
// las dos veces, y comparar tipos exactos (con defaults, arrays, texto
// multilínea) tendría muchos más falsos positivos de los que vale la pena.
// Mira el estado FINAL después de aplicar todas las migraciones en orden —
// igual que el resto de este archivo —, así que un `drop function` posterior
// que saca la firma vieja a propósito no cuenta como problema.

function separarArgumentosDeNivel(texto) {
  const partes = [];
  let profundidad = 0;
  let actual = "";
  for (const c of texto) {
    if (c === "(" || c === "[") profundidad++;
    if (c === ")" || c === "]") profundidad--;
    if (c === "," && profundidad === 0) {
      partes.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  if (actual.trim() !== "") partes.push(actual);
  return partes;
}

function firmasDeArchivo(sinComentarios) {
  const firmas = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)\s*\(/gi;
  let m;
  while ((m = re.exec(sinComentarios))) {
    const nombre = m[1].toLowerCase();
    let profundidad = 1;
    let i = re.lastIndex;
    for (; i < sinComentarios.length && profundidad > 0; i++) {
      if (sinComentarios[i] === "(") profundidad++;
      if (sinComentarios[i] === ")") profundidad--;
    }
    const argumentos = sinComentarios.slice(re.lastIndex, i - 1);
    const cantidad = argumentos.trim() === "" ? 0 : separarArgumentosDeNivel(argumentos).length;
    firmas.push({ nombre, cantidad });
    re.lastIndex = i;
  }
  return firmas;
}

const vivos = new Map(); // nombre -> Map(cantidad -> archivo donde se definió esa firma)

for (const archivo of archivos) {
  const texto = fs.readFileSync(path.join(DIR, archivo), "utf8");
  const sinComentarios = texto.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // Un `drop function` de este nombre borra TODAS sus firmas vivas: no
  // sabemos sin parsear tipos cuál firma específica saca, así que se asume
  // que quien lo escribió sabe lo que borra y se despeja el registro entero
  // para no arrastrar falsos positivos.
  for (const m of sinComentarios.matchAll(
    /drop\s+function\s+(?:if\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi,
  )) {
    vivos.delete(m[1].toLowerCase());
  }

  for (const { nombre, cantidad } of firmasDeArchivo(sinComentarios)) {
    if (!vivos.has(nombre)) vivos.set(nombre, new Map());
    vivos.get(nombre).set(cantidad, archivo);
  }
}

for (const [nombre, cantidades] of vivos) {
  if (cantidades.size > 1) {
    const detalle = [...cantidades.entries()]
      .map(([c, a]) => `${c} parámetro(s) desde ${a}`)
      .join(" y ");
    problemas.push(
      `public.${nombre}(...) queda con más de una firma viva: ${detalle}.\n` +
        `      "create or replace" no reemplaza una firma con distinta cantidad de parámetros:\n` +
        `      las dos quedan ejecutables (pasó en la v90 y en la v283). Si el cambio de forma\n` +
        `      fue a propósito, agregar un "drop function" de la firma vieja.`,
    );
  }
}

// ============================================================

console.log(`${archivos.length} migraciones · ${porVersion.size} versiones distintas`);

for (const aviso of avisos) console.log(`  aviso: ${aviso}`);

if (problemas.length === 0) {
  console.log("Las migraciones pueden aplicarse desde cero en el orden en que están.");
  process.exit(0);
}

console.error(`\n${problemas.length} problema(s):\n`);
for (const p of problemas) console.error(`  · ${p}`);
console.error("");
process.exit(1);
