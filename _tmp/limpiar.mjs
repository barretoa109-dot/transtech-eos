import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of fs.readFileSync(".env.local","utf8").split(/\r?\n/)) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim().replace(/^["']|["']$/g,""); }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const { data } = await db.from("eos_crm_contactos").select("id,nombre").eq("usuario_id","eca35420-24a2-44e1-a027-a154ceab88c5");
console.log("contactos del demo:", JSON.stringify(data));
const { error } = await db.from("eos_crm_contactos").delete().eq("usuario_id","eca35420-24a2-44e1-a027-a154ceab88c5").eq("nombre","Marisol Duarte");
console.log("borrado:", error ? error.message : "ok");
