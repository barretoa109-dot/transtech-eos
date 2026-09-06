import fs from "node:fs";
const env = {};
for (const l of fs.readFileSync(".env.local","utf8").split(/\r?\n/)) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim().replace(/^["']|["']$/g,""); }
const BASE = env.N8N_BASE_URL.replace(/\/$/,""); const H = { "X-N8N-API-KEY": env.N8N_API_KEY };
const j = await (await fetch(`${BASE}/api/v1/executions?workflowId=JRgzUkoHBKgGpyPA&limit=6`, { headers: H })).json();
for (const e of j.data ?? []) {
  const d = await (await fetch(`${BASE}/api/v1/executions/${e.id}?includeData=true`, { headers: H })).json();
  const rd = d.data?.resultData?.runData ?? {};
  const total = Object.values(rd).reduce((a, c) => a + (c[0]?.executionTime ?? 0), 0);
  const ai = rd["HTTP Request"]?.[0]?.executionTime ?? 0;
  const reserva = rd["01.5 GW Verificar Reserva API"]?.[0]?.executionTime ?? 0;
  const pared = new Date(e.stoppedAt) - new Date(e.startedAt);
  console.log(`${e.id} ${e.startedAt.slice(11,19)} | pared ${pared} ms | nodos ${total} ms | openai ${ai} ms | reserva ${reserva} ms`);
}
