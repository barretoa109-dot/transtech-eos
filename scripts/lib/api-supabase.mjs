/**
 * Una consulta SQL por la Management API de Supabase, con reintentos.
 *
 * La API limita cuántas consultas se le hacen por minuto. `npm run respaldo`
 * hace una por tabla y el 24/09/2026 se cortó a la mitad con
 * "ThrottlerException: Too Many Requests". Un 429 (o un 5xx pasajero) no es un
 * error del respaldo: es "esperá un poco". Se espera lo que diga Retry-After,
 * o cada vez el doble, y se reintenta.
 */

export const ESPERAS_MS = [2_000, 4_000, 8_000, 16_000, 30_000, 60_000];

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

function esperaPedida(respuesta) {
  const valor = Number(respuesta.headers?.get?.("retry-after"));
  return Number.isFinite(valor) && valor > 0 ? Math.min(valor * 1_000, 120_000) : null;
}

export async function consultar(ref, token, query, { fetch: traer = fetch, esperar = dormir } = {}) {
  for (let intento = 0; ; intento += 1) {
    const r = await traer(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const pasajero = r.status === 429 || r.status >= 500;
    if (pasajero && intento < ESPERAS_MS.length) {
      await esperar(esperaPedida(r) ?? ESPERAS_MS[intento]);
      continue;
    }

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
}
