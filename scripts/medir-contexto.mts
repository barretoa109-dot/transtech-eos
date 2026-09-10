#!/usr/bin/env -S npx tsx
/**
 * Cuánto ocupa el contexto que viaja en CADA mensaje.
 *
 *     npx tsx scripts/medir-contexto.mts [usuario_id]
 *
 * ============================================================
 * POR QUÉ SE MIDE Y NO SE ESTIMA
 * ============================================================
 *
 * Todo lo que entra acá se paga dos veces: en tokens de entrada de cada
 * mensaje, y en milisegundos que la persona espera mirando la pantalla. Y se
 * paga contra el presupuesto de atención del modelo, que no es infinito: un
 * bloque que crece empuja al fondo a los que estaban antes.
 *
 * El tope de cada lista está elegido a ojo —8 cuentas, 5 tarjetas, 8 deudas, 5
 * objetivos, 40 productos—. Esto dice cuánto cuesta ese ojo con una carga
 * realista, en vez de suponerlo.
 *
 * Se corre contra un usuario real. No escribe nada.
 */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { textoContexto, type ContextoNegocio } from "../lib/eos/contexto-negocio.ts";
import { textoMemoria } from "../lib/eos/memoria-contexto.ts";
import { PROMPT_SISTEMA } from "../lib/gateway/sistema.ts";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env: Record<string, string> = {};
for (const linea of fs.readFileSync(`${RAIZ}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const usuario = process.argv[2] ?? "eca35420-24a2-44e1-a027-a154ceab88c5";

const t0 = Date.now();
const { data: contexto } = await db.rpc("eos_contexto_negocio", { p_usuario_id: usuario });
const msContexto = Date.now() - t0;

const [memorias, objetivos, tareas] = await Promise.all([
  db
    .from("eos_memory")
    .select("titulo,categoria,contenido,importancia")
    .eq("usuario_id", usuario)
    .eq("archivada", false)
    .order("importancia", { ascending: false })
    .limit(30),
  db
    .from("eos_goals")
    .select("titulo,valor_objetivo,valor_actual,unidad,fecha_limite,ambito")
    .eq("usuario_id", usuario)
    .limit(10),
  db
    .from("eos_tasks")
    .select("titulo,prioridad,fecha_limite")
    .eq("usuario_id", usuario)
    .neq("estado", "completada")
    .limit(10),
]);

const negocio = textoContexto(contexto as ContextoNegocio);
const memoria = textoMemoria({
  memorias: memorias.data ?? [],
  objetivos: objetivos.data ?? [],
  tareas: tareas.data ?? [],
});

/**
 * Una cuenta de tokens de andar por casa: ~4 caracteres por token en
 * castellano. No es exacta y no pretende serlo — sirve para ver el orden de
 * magnitud y para comparar un bloque con otro.
 */
const tokens = (t: string) => Math.round(t.length / 4);

function fila(que: string, texto: string) {
  console.log(
    `  ${que.padEnd(28)} ${String(texto.length).padStart(6)} car  ~${String(tokens(texto)).padStart(5)} tok`,
  );
}

console.log(`\nUsuario ${usuario}`);
console.log(`\nLo que va en CADA mensaje:`);
fila("prompt del sistema", PROMPT_SISTEMA);
fila("contexto del negocio", negocio);
fila("memoria", memoria);
fila("TOTAL fijo", PROMPT_SISTEMA + negocio + memoria);

/*
 * El desglose por bloque.
 *
 * `textoContexto` une con un salto simple, así que un bloque nuevo empieza
 * donde una línea NO arranca con dos espacios: los renglones de detalle van
 * indentados y los encabezados no.
 */
console.log(`\nDentro del contexto del negocio:`);
const bloques: string[] = [];
for (const linea of negocio.split("\n")) {
  if (!linea.startsWith("  ") || bloques.length === 0) bloques.push(linea);
  else bloques[bloques.length - 1] += `\n${linea}`;
}
for (const bloque of bloques) {
  fila(`  ${bloque.split("\n")[0].slice(0, 38)}`, bloque);
}

console.log(`\nLa RPC de contexto tardó ${msContexto} ms.`);

/*
 * Y el aviso que importa: si el contexto pasa de este tamaño, deja de ser
 * contexto y pasa a ser ruido que empuja al prompt hacia el fondo.
 */
const TOPE_SANO = 2000;
if (negocio.length > TOPE_SANO) {
  console.log(
    `\n  AVISO: el contexto del negocio pasa los ${TOPE_SANO} caracteres.` +
      `\n  Cada mensaje lo paga. Conviene recortar el tope de alguna lista.`,
  );
} else {
  console.log(`\n  El contexto está dentro de los ${TOPE_SANO} caracteres sanos.`);
}
