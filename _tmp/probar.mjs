import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of fs.readFileSync(".env.local","utf8").split(/\r?\n/)) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim().replace(/^["']|["']$/g,""); }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });

const USUARIO = "eca35420-24a2-44e1-a027-a154ceab88c5";     // demo@transtech.com.py
const CONV = "f627e75d-a43b-4f3e-9ac1-61f69547f2ec";
const mensaje = process.argv[2] ?? "Hola, decime un chiste corto";
const rid = crypto.randomUUID();

const { data: reserva, error } = await db.rpc("eos_reserve_message_quota_server_v75", { p_usuario_id: USUARIO, p_request_id: rid });
if (error || !reserva?.allowed) { console.error("sin cupo:", error ?? reserva); process.exit(1); }

const t0 = Date.now();
const r = await fetch("https://n8n-production-6cdb.up.railway.app/webhook/eos-chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    request_id: rid, usuario_id: USUARIO, conversacion_id: CONV,
    nombre: "Augusto", plan: "free", contexto_negocio: "", mensaje,
    historial: [], nuevo_chat: false, archivo: null, origen: "diagnostico-cli",
    fecha: new Date().toISOString(),
  }),
});
const segundos = ((Date.now() - t0) / 1000).toFixed(1);
const cuerpo = await r.json().catch(() => null);
console.log(`HTTP ${r.status} en ${segundos} s`);
console.log("respuesta:", cuerpo?.respuesta);
console.log("acciones:", JSON.stringify(cuerpo?.acciones));
console.log("worker:", JSON.stringify(cuerpo?.worker));

await db.rpc("eos_release_message_quota_server_v75", { p_usuario_id: USUARIO, p_request_id: rid, p_reason: "diagnostico" });
