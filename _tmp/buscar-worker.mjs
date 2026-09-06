import fs from "node:fs";
const env = {};
for (const l of fs.readFileSync(".env.local","utf8").split(/\r?\n/)) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim().replace(/^["']|["']$/g,""); }
const BASE = env.N8N_BASE_URL.replace(/\/$/,""); const H = { "X-N8N-API-KEY": env.N8N_API_KEY };
const j = await (await fetch(`${BASE}/api/v1/workflows?limit=100`, { headers: H })).json();
for (const w of j.data ?? []) if (/worker/i.test(w.name)) console.log(w.id, "|", w.active ? "ACTIVO" : "inactivo", "|", w.name, "|", w.updatedAt);
