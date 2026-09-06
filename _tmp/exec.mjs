import fs from "node:fs";
const env = {};
for (const l of fs.readFileSync(".env.local","utf8").split(/\r?\n/)) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim().replace(/^["']|["']$/g,""); }
const BASE = env.N8N_BASE_URL.replace(/\/$/,""); const H = { "X-N8N-API-KEY": env.N8N_API_KEY };
const j = await (await fetch(`${BASE}/api/v1/executions?workflowId=JRgzUkoHBKgGpyPA&limit=3`, { headers: H })).json();
const id = j.data?.[0]?.id;
console.log("ejecución", id, j.data?.[0]?.status);
const d = await (await fetch(`${BASE}/api/v1/executions/${id}?includeData=true`, { headers: H })).json();
const rd = d.data?.resultData?.runData ?? {};
for (const [n, c] of Object.entries(rd)) console.log(`  ${n}: ${c[0]?.executionTime} ms`);
const ai = rd["HTTP Request"]?.[0]?.data?.main?.[0]?.[0]?.json;
if (ai) console.log("\nmodelo:", ai.model, "| reasoning:", JSON.stringify(ai.reasoning), "| usage:", JSON.stringify(ai.usage));
