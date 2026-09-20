#!/usr/bin/env node
/**
 * Respaldo de los datos de producción a archivos locales, y su verificación.
 *
 * POR QUÉ EXISTE. El 20 de septiembre de 2026 se comprobó que el proyecto de
 * Supabase está en el plan GRATUITO: `backups: []` y `pitr_enabled: false`. No
 * hay ninguna copia de la base de producción en ningún lado. Lo correcto es un
 * plan pago (copia diaria, y PITR si se quiere volver a un minuto exacto), pero
 * eso es una decisión de plata. Mientras tanto, la base pesa decenas de MB: esto
 * baja todas las tablas de `public` a JSON para que exista AL MENOS una copia.
 *
 *   npm run respaldo                      baja todo a ../respaldos-eos/AAAA-MM-DD/
 *   npm run respaldo -- --carpeta RUTA    lo baja a otro lugar
 *   npm run respaldo -- --verificar RUTA  compara una copia con la base viva
 *
 * QUÉ ES Y QUÉ NO ES.
 *  - Es una copia de los DATOS de `public`. El esquema no hace falta guardarlo:
 *    está en `supabase/migrations/` y se reconstruye con `supabase db push`.
 *  - NO incluye `auth.users` (correos y hashes de contraseña de las personas):
 *    son datos demasiado sensibles para dejarlos sueltos en un archivo. Sin
 *    ellos, al restaurar hay que volver a crear las cuentas de Auth con los mismos
 *    ids. Con `--con-auth` se incluyen; queda bajo responsabilidad de quien lo
 *    corre guardarlos cifrados.
 *  - NO es una prueba de que la restauración funcione: eso nunca se ensayó
 *    (ver `docs/rollback-runbook.md`). Guarda los datos; la restauración con
 *    `session_replication_role = replica` y las migraciones está descrita ahí.
 *
 * LA CARPETA CONTIENE DATOS PERSONALES. Vive FUERA del repositorio a propósito
 * (por defecto en `../respaldos-eos/`). No se sube a ningún lado sin cifrar.
 *
 * Toma SUPABASE_ACCESS_TOKEN del entorno o de .env.local. Solo LEE la base.
 */

import fs from "node:fs";
import path from "node:path";

const REF = "dirugpkamzgvyshcnsxs";

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  try {
    return fs.readFileSync(".env.local", "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const t = token();
if (!t) {
  console.error("Falta SUPABASE_ACCESS_TOKEN (en el entorno o en .env.local).");
  process.exit(2);
}

async function sql(consulta) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: consulta }),
  });

  const texto = await r.text();
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    throw new Error(`Respuesta no válida (${r.status}): ${texto.slice(0, 200)}`);
  }

  if (!r.ok || !Array.isArray(cuerpo)) {
    throw new Error(cuerpo?.message ?? `Error ${r.status}`);
  }

  return cuerpo;
}

const argumentos = process.argv.slice(2);
const valor = (nombre) => {
  const i = argumentos.indexOf(nombre);
  return i >= 0 ? argumentos[i + 1] : undefined;
};

const conAuth = argumentos.includes("--con-auth");
const aVerificar = valor("--verificar");

/** Las tablas a copiar: todas las de `public`, y opcionalmente las de identidad de `auth`. */
async function listarTablas() {
  const filas = await sql(`
    select table_schema as esquema, table_name as tabla
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and (table_schema = 'public'
           ${conAuth ? "or (table_schema = 'auth' and table_name in ('users','identities'))" : ""})
    order by 1, 2`);
  return filas.map((f) => ({ esquema: f.esquema, tabla: f.tabla }));
}

const nombreSeguro = (x) => x.replace(/"/g, '""');
const calificada = (x) => `"${nombreSeguro(x.esquema)}"."${nombreSeguro(x.tabla)}"`;

async function contar(x) {
  const [f] = await sql(`select count(*)::bigint as n from ${calificada(x)}`);
  return Number(f.n);
}

if (aVerificar) {
  const manifiesto = JSON.parse(fs.readFileSync(path.join(aVerificar, "manifiesto.json"), "utf8"));
  let problemas = 0;

  for (const x of manifiesto.tablas) {
    const archivo = path.join(aVerificar, `${x.esquema}.${x.tabla}.json`);
    const enArchivo = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, "utf8")).length : -1;
    const vivas = await contar(x);

    const ok = enArchivo === x.filas;
    if (!ok) problemas++;

    // Que en la base haya MÁS filas que en la copia es normal (pasó tiempo). Que
    // el archivo no coincida con su propio manifiesto es lo que delata una copia rota.
    console.log(
      `${ok ? "  ok " : "FALLA"} ${x.esquema}.${x.tabla}: archivo ${enArchivo}, manifiesto ${x.filas}, base hoy ${vivas}`,
    );
  }

  console.log(
    problemas === 0
      ? `\nLa copia de ${manifiesto.creado_en} está íntegra: ${manifiesto.tablas.length} tablas, ${manifiesto.filas_totales} filas.`
      : `\n${problemas} tabla(s) no coinciden con su manifiesto: la copia está incompleta.`,
  );
  process.exit(problemas === 0 ? 0 : 1);
}

const hoy = new Date().toISOString().slice(0, 10);
const carpeta = path.resolve(valor("--carpeta") ?? path.join("..", "respaldos-eos", hoy));
fs.mkdirSync(carpeta, { recursive: true });

const tablas = await listarTablas();
const manifiesto = { proyecto: REF, creado_en: new Date().toISOString(), con_auth: conAuth, tablas: [], filas_totales: 0 };

for (const x of tablas) {
  // `to_jsonb(fila)` conserva los tipos (uuid, timestamptz, jsonb, numeric)
  // sin inventar un formato propio; al restaurar se vuelve a leer con
  // `jsonb_populate_recordset` o con el cliente.
  const filas = await sql(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as datos from ${calificada(x)} t`);
  const datos = filas[0]?.datos ?? [];

  fs.writeFileSync(path.join(carpeta, `${x.esquema}.${x.tabla}.json`), JSON.stringify(datos));

  manifiesto.tablas.push({ ...x, filas: datos.length });
  manifiesto.filas_totales += datos.length;

  process.stdout.write(`${x.esquema}.${x.tabla}: ${datos.length}\n`);
}

fs.writeFileSync(path.join(carpeta, "manifiesto.json"), JSON.stringify(manifiesto, null, 2));

console.log(`\nCopia en ${carpeta}: ${manifiesto.tablas.length} tablas, ${manifiesto.filas_totales} filas.`);
console.log("Esa carpeta tiene datos personales: guardala cifrada y no la subas a ningún lado tal cual.");
console.log(`Para comprobarla:  npm run respaldo -- --verificar "${carpeta}"`);
