import { randomUUID } from 'node:crypto';

const appBase = String(process.env.EOS_APP_BASE_URL || '').trim().replace(/\/$/, '');
const n8nBase = String(process.env.EOS_N8N_BASE_URL || '').trim().replace(/\/$/, '');
const secret = String(process.env.EOS_WORKER_GATE_SECRET || '').trim();
const timeoutMs = Number(process.env.EOS_SMOKE_TIMEOUT_MS || 15000);
const invalidSecret = secret
  ? `${secret.slice(0, -1)}${secret.endsWith('x') ? 'y' : 'x'}`
  : 'eos-smoke-invalid-secret';

function fail(message) {
  throw new Error(message);
}

function requireHttpUrl(value, name) {
  if (!value) fail(`${name} es obligatorio.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} no es una URL válida.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail(`${name} debe usar http o https.`);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
  }

  return { response, body };
}

async function expectStatus(label, url, options, expectedStatus) {
  const { response, body } = await requestJson(url, options);
  if (response.status !== expectedStatus) {
    fail(`${label}: esperado HTTP ${expectedStatus}, recibido ${response.status}. Respuesta: ${JSON.stringify(body)}`);
  }
  console.log(`PASS ${label} -> HTTP ${response.status}`);
  return body;
}

async function smokeAppGate() {
  const pingUrl = `${appBase}/api/internal/worker-ping/v1`;

  await expectStatus(
    'worker-ping sin Authorization',
    pingUrl,
    { method: 'POST', body: '{}' },
    401,
  );

  await expectStatus(
    'worker-ping con secreto incorrecto',
    pingUrl,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${invalidSecret}` },
      body: '{}',
    },
    401,
  );

  const body = await expectStatus(
    'worker-ping autenticado',
    pingUrl,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: '{}',
    },
    200,
  );

  if (body?.ok !== true || body?.service !== 'eos-worker-gate') {
    fail(`worker-ping autenticado devolvió contrato inesperado: ${JSON.stringify(body)}`);
  }
  console.log(`PASS contrato worker-ping -> ${body.service} ${body.version || ''}`.trim());
}

async function smokeN8nRespondPath() {
  if (!n8nBase) {
    console.log('SKIP n8n respond path: EOS_N8N_BASE_URL no configurado.');
    return;
  }

  requireHttpUrl(n8nBase, 'EOS_N8N_BASE_URL');

  const marker = `EOS_RC1_SMOKE_${Date.now()}`;
  const url = `${n8nBase}/webhook/eos-worker-rc1-respond`;
  const payload = {
    request_id: randomUUID(),
    usuario_id: randomUUID(),
    conversacion_id: randomUUID(),
    nombre: 'EOS RC1 Smoke',
    mensaje: 'healthcheck',
    respuesta_gateway: marker,
    accion: { tipo: 'RESPONDER', datos: {} },
    plan: 'free',
    origen: 'rc1-smoke',
    metadata: { smoke: true },
    received_at: new Date().toISOString(),
  };

  const body = await expectStatus(
    'n8n worker RESPONDER autenticado',
    url,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload),
    },
    200,
  );

  if (body?.ok !== true || body?.accion !== 'RESPONDER' || body?.respuesta !== marker) {
    fail(`n8n RESPONDER devolvió contrato inesperado: ${JSON.stringify(body)}`);
  }

  console.log('PASS n8n -> Vercel worker-ping -> respuesta gobernada');
}

async function main() {
  requireHttpUrl(appBase, 'EOS_APP_BASE_URL');
  if (!secret) fail('EOS_WORKER_GATE_SECRET es obligatorio.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    fail('EOS_SMOKE_TIMEOUT_MS debe estar entre 1000 y 120000.');
  }

  console.log('EOS Worker Gate RC1 smoke: inicio');
  console.log(`App: ${appBase}`);
  console.log(`n8n: ${n8nBase || '(omitido)'}`);

  await smokeAppGate();
  await smokeN8nRespondPath();

  console.log('EOS Worker Gate RC1 smoke: PASS');
}

main().catch((error) => {
  console.error(`EOS Worker Gate RC1 smoke: FAIL\n${error?.stack || error}`);
  process.exitCode = 1;
});
