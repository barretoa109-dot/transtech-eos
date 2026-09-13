#!/usr/bin/env -S npx tsx
/**
 * Hablarle a EOS como le habla la aplicación.
 *
 *     npx tsx scripts/sonda-chat.mts "gasté 50 mil en nafta" [usuario_id]
 *
 * ============================================================
 * POR QUÉ ESTO EXISTE, Y POR QUÉ ARMA EL CONTEXTO DE VERDAD
 * ============================================================
 *
 * La sonda anterior mandaba `contexto_negocio: ""`. Con eso, cualquier
 * pregunta sobre la plata de la persona se contesta con "no puedo ver eso
 * desde acá" — y no porque el producto esté roto, sino porque la sonda no le
 * mandó nada que ver.
 *
 * El 10 de septiembre de 2026 eso hizo perder un rato persiguiendo un fantasma
 * y casi dio por cierta una conclusión falsa sobre producción. Una prueba que
 * no reproduce lo que hace la aplicación no prueba nada: da respuestas con
 * cara de resultado.
 *
 * Así que esta arma el MISMO `contexto_negocio` que arma
 * `app/api/eos/route.ts`: la RPC de contexto pasada por `textoContexto`, más
 * la memoria por `textoMemoria`, unidas igual que allá.
 *
 * ============================================================
 * QUÉ NO REPRODUCE
 * ============================================================
 *
 * La sesión. La ruta real valida la cookie, resuelve el usuario y aplica el
 * límite de solicitudes; acá el usuario se pasa por parámetro y se reserva la
 * cuota a mano. Sirve para probar el camino del chat, no el de autenticación.
 */

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { textoContexto } from "../lib/eos/contexto-negocio.ts";
import { textoMemoria } from "../lib/eos/memoria-contexto.ts";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env: Record<string, string> = {};
for (const linea of fs.readFileSync(`${RAIZ}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const mensaje = process.argv[2];
if (!mensaje) {
  console.error('Uso: npx tsx scripts/sonda-chat.mts "el mensaje" [usuario_id]');
  process.exit(1);
}

const usuario = process.argv[3] ?? env.EOS_USUARIO_PRUEBA ?? "eca35420-24a2-44e1-a027-a154ceab88c5";
const requestId = randomUUID();

const URL_GATEWAY =
  env.N8N_EOS_WEBHOOK_URL || "https://n8n-production-6cdb.up.railway.app/webhook/eos-chat";

// ---------------------------------------------------------------- el contexto
const { data: contexto } = await db.rpc("eos_contexto_negocio", { p_usuario_id: usuario });

const [memorias, objetivos, tareas] = await Promise.all([
  db
    .from("eos_memory")
    .select("titulo,categoria,contenido,importancia")
    .eq("usuario_id", usuario)
    .eq("estado", "activo")
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

const contextoNegocio = [
  textoContexto(contexto),
  textoMemoria({
    memorias: memorias.data ?? [],
    objetivos: objetivos.data ?? [],
    tareas: tareas.data ?? [],
  }),
]
  .filter((p) => p.trim() !== "")
  .join("\n\n");

// ------------------------------------------------------------------- la cuota
const { data: reserva, error } = await db.rpc("eos_reserve_message_quota_server_v75", {
  p_usuario_id: usuario,
  p_request_id: requestId,
});

if (error || (reserva as { allowed?: boolean })?.allowed !== true) {
  console.error("No se pudo reservar cuota:", JSON.stringify(error ?? reserva));
  process.exit(1);
}

console.log(`\n=== CONTEXTO QUE VIAJA (${contextoNegocio.length} caracteres) ===`);
console.log(contextoNegocio || "  (vacío)");
console.log(`\n> ${mensaje}\n`);

const t0 = Date.now();
const r = await fetch(URL_GATEWAY, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    request_id: requestId,
    usuario_id: usuario,
    conversacion_id: process.env.CONV ?? randomUUID(),
    nombre: "Prueba",
    plan: (reserva as { plan?: string })?.plan ?? "free",
    contexto_negocio: contextoNegocio,
    mensaje,
    historial: [],
    nuevo_chat: true,
    archivo: null,
    archivos: [],
    origen: "sonda",
    fecha: new Date().toISOString(),
  }),
});

const texto = await r.text();
console.log(`HTTP ${r.status} en ${Date.now() - t0} ms · ${texto.length} bytes\n`);

let cuerpo: Record<string, unknown>;
try {
  cuerpo = JSON.parse(texto) as Record<string, unknown>;
} catch {
  console.log(texto);
  process.exit(0);
}

console.log("RESPUESTA:");
console.log(
  String(cuerpo.respuesta ?? "(sin respuesta)")
    .split("\n")
    .map((l) => "  " + l)
    .join("\n"),
);

const acciones = cuerpo.acciones;
if (Array.isArray(acciones) && acciones.length > 0) {
  console.log("\nACCIONES:");
  console.log(JSON.stringify(acciones, null, 2));
}
