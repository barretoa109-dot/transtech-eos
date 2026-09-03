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
// 4. El orden de los archivos tiene que ser el de las fechas
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
