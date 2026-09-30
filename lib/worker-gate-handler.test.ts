import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as modulo from "node:module";

// Fuera de Next, Node no resuelve `next/server` sin la extensión (el paquete no
// declara `exports`). Solo para esta prueba: la puerta importa NextResponse.
// `registerHooks` existe desde Node 23.5 (el CI corre 24), pero los tipos del
// proyecto son de Node 20: se declara acá.
type Siguiente = (especificador: string, contexto: unknown) => unknown;
const { registerHooks } = modulo as unknown as {
  registerHooks: (ganchos: { resolve: (especificador: string, contexto: unknown, siguiente: Siguiente) => unknown }) => void;
};
registerHooks({
  resolve(especificador, contexto, siguiente) {
    return siguiente(especificador === "next/server" ? "next/server.js" : especificador, contexto);
  },
});

/**
 * La puerta de autorización, de caja negra (29/09/2026).
 *
 * Hasta hoy no tenía pruebas propias: es código de seguridad que habla con la
 * base. Acá el cliente de Supabase apunta a un servidor falso que responde
 * como PostgREST, con una demora de 50 ms por pedido y la cuenta de cuántos
 * pedidos están abiertos a la vez. Así se prueba lo que decide la puerta y,
 * además, que las lecturas salen juntas (autorizar tardaba 1,7 s por hacerlas
 * de a una).
 */

const DEMORA_MS = 50;
const USUARIO = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const ORDEN = "44444444-4444-4444-8444-444444444444";

type Datos = Record<string, unknown[]>;

/*
 * UN solo servidor para todo el archivo: `createAdminClient` guarda el
 * cliente la primera vez, con la URL de ese momento. Cada caso cambia los datos
 * y mira los pedidos que llegaron durante su corrida.
 */
let datosActuales: Datos = {};
let pedidos: { metodo: string; tabla: string }[] = [];
let abiertos = 0;
let maximoAbiertos = 0;
let servidor: Server | null = null;

async function levantarServidor() {
  if (servidor) return;
  servidor = createServer((req, res) => {
    const tabla = (req.url ?? "").split("?")[0].replace("/rest/v1/", "");
    pedidos.push({ metodo: req.method ?? "", tabla });
    abiertos += 1;
    maximoAbiertos = Math.max(maximoAbiertos, abiertos);
    req.resume();
    req.on("end", () => {
      setTimeout(() => {
        abiertos -= 1;
        const filas = req.method === "GET" ? (datosActuales[tabla] ?? []) : [];
        res.writeHead(req.method === "GET" ? 200 : 201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(filas));
      }, DEMORA_MS);
    });
  });
  await new Promise<void>((r) => servidor!.listen(0, "127.0.0.1", r));
  const { port } = servidor.address() as AddressInfo;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-prueba";
  process.env.EOS_WORKER_GATE_SECRET = "secreto-de-prueba";
}

after(() => new Promise<void>((r) => (servidor ? servidor.close(() => r()) : r())));

async function conBaseFalsa(datos: Datos, correr: () => Promise<void>) {
  await levantarServidor();
  datosActuales = datos;
  pedidos = [];
  maximoAbiertos = 0;
  await correr();
  return { pedidos: [...pedidos], maximoAbiertos };
}

async function pedir(cuerpo: Record<string, unknown>) {
  const { POST } = await import("./worker-gate-handler.ts");
  const respuesta = await POST(
    new Request("http://eos.internal/api/internal/worker-gate/v1", {
      method: "POST",
      headers: { Authorization: "Bearer secreto-de-prueba", "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    }),
  );
  return { status: respuesta.status, cuerpo: (await respuesta.json()) as Record<string, unknown> };
}

const base = {
  usuario_id: USUARIO,
  request_id: REQUEST,
  accion: "REGISTRAR_VENTA",
  payload: { datos: { items: [{ producto: "Pan", cantidad: 2 }] } },
};

test("sin clave, no autoriza ni lee nada", async () => {
  const { pedidos } = await conBaseFalsa({}, async () => {
    const { POST } = await import("./worker-gate-handler.ts");
    const r = await POST(
      new Request("http://eos.internal/x", { method: "POST", headers: { Authorization: "Bearer otra" }, body: JSON.stringify(base) }),
    );
    assert.equal(r.status, 401);
  });
  assert.equal(pedidos.length, 0);
});

test("un usuario que no existe se bloquea igual que antes", async () => {
  let r!: Awaited<ReturnType<typeof pedir>>;
  await conBaseFalsa({ usuarios: [] }, async () => {
    r = await pedir(base);
  });
  assert.equal(r.status, 404);
  assert.equal(r.cuerpo.execute, false);
  assert.equal(r.cuerpo.error, "Usuario no válido para ejecución.");
});

test("una orden de otro usuario se bloquea, aunque todo lo demás se haya leído", async () => {
  let r!: Awaited<ReturnType<typeof pedir>>;
  await conBaseFalsa(
    {
      usuarios: [{ id: USUARIO }],
      eos_action_commands: [{ id: ORDEN, usuario_id: OTRO, request_id: REQUEST, accion: "REGISTRAR_VENTA", estado: "recibida" }],
    },
    async () => {
      r = await pedir({ ...base, command_id: ORDEN });
    },
  );
  assert.equal(r.cuerpo.execute, false);
  assert.equal(r.cuerpo.decision, "block");
  assert.match(String(r.cuerpo.error ?? r.cuerpo.reason ?? ""), /no coincide exactamente/);
});

test("una orden ya cerrada no se vuelve a ejecutar", async () => {
  let r!: Awaited<ReturnType<typeof pedir>>;
  await conBaseFalsa(
    {
      usuarios: [{ id: USUARIO }],
      eos_action_commands: [{ id: ORDEN, usuario_id: USUARIO, request_id: REQUEST, accion: "REGISTRAR_VENTA", estado: "completada" }],
    },
    async () => {
      r = await pedir({ ...base, command_id: ORDEN });
    },
  );
  assert.equal(r.cuerpo.execute, false);
  assert.match(String(r.cuerpo.error ?? r.cuerpo.reason ?? ""), /estado no ejecutable: completada/);
});

test("las ocho lecturas salen juntas: el usuario, la orden y las seis de autonomía", async () => {
  const { pedidos, maximoAbiertos } = await conBaseFalsa(
    {
      usuarios: [{ id: USUARIO }],
      eos_action_commands: [{ id: ORDEN, usuario_id: USUARIO, request_id: REQUEST, accion: "REGISTRAR_VENTA", estado: "recibida" }],
    },
    async () => {
      const r = await pedir({ ...base, command_id: ORDEN });
      // Decida lo que decida con la política por defecto, contesta con una decisión.
      assert.equal(typeof r.cuerpo.decision, "string");
    },
  );
  const lecturas = pedidos.filter((p) => p.metodo === "GET").map((p) => p.tabla);
  for (const tabla of [
    "usuarios",
    "eos_action_commands",
    "eos_autonomy_profiles_v12",
    "eos_autonomy_rules_v12",
    "eos_action_approvals_v12",
    "eos_autonomy_events_v12",
    "eos_master_context_v8",
  ]) {
    assert.ok(lecturas.includes(tabla), `leyó ${tabla}`);
  }
  assert.ok(maximoAbiertos >= 8, `pedidos a la vez: ${maximoAbiertos}`);
});
