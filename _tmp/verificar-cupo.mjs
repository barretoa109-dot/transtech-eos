import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of fs.readFileSync(".env.local","utf8").split(/\r?\n/)) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim().replace(/^["']|["']$/g,""); }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });

const { data: planes } = await db.from("planes").select("codigo, limite_mensajes").order("codigo");
console.table(planes);

// La cuenta con el plan vencido (la del usuario).
const VENCIDA = "33fd290b-4188-49ef-8d5a-fee723583795";
const rid = crypto.randomUUID();
const { data, error } = await db.rpc("eos_reserve_message_quota_server_v75", { p_usuario_id: VENCIDA, p_request_id: rid });
console.log("\nplan vencido →", error ? error.message : JSON.stringify(data));
if (data?.allowed) {
  await db.rpc("eos_release_message_quota_server_v75", { p_usuario_id: VENCIDA, p_request_id: rid, p_reason: "verificacion" });
  console.log("(reserva liberada)");
}

// Una cuenta business, si existe.
const { data: bs } = await db.from("usuarios").select("id,email").eq("plan","business").limit(1);
if (bs?.length) {
  const rid2 = crypto.randomUUID();
  const { data: d2, error: e2 } = await db.rpc("eos_reserve_message_quota_server_v75", { p_usuario_id: bs[0].id, p_request_id: rid2 });
  console.log("business", bs[0].email, "→", e2 ? e2.message : JSON.stringify(d2));
  if (d2?.allowed) await db.rpc("eos_release_message_quota_server_v75", { p_usuario_id: bs[0].id, p_request_id: rid2, p_reason: "verificacion" });
}
