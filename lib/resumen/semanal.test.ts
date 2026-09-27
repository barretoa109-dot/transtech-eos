import assert from "node:assert/strict";
import { test } from "node:test";

import { tokenDeBajaValido } from "../email/baja.ts";
import type { Deudor } from "../eos/quien-me-debe.ts";
import {
  enviarResumenesSemanales,
  MOTIVO_BAJA_RESUMEN,
  urlDeBajaResumen,
  type CorreoResumen,
  type FuenteResumen,
} from "./enviar.ts";
import { lineasDelResumen, redactarResumen, semanaDe, unaCosaParaHoy, type HechosSemana } from "./semanal.ts";

test("la semana: el lunes de hoy y las dos semanas completas de antes", () => {
  // 2026-09-28 es lunes.
  assert.deepEqual(semanaDe("2026-09-28"), {
    lunes: "2026-09-28",
    desde: "2026-09-21",
    hasta: "2026-09-27",
    desdeAnterior: "2026-09-14",
    hastaAnterior: "2026-09-20",
  });
  // El martes resume la misma semana que el lunes (es el reintento).
  assert.equal(semanaDe("2026-09-29").lunes, "2026-09-28");
  // Un domingo pertenece a la semana que empezó el lunes anterior.
  assert.equal(semanaDe("2026-09-27").lunes, "2026-09-21");
});

const deudor = (p: Partial<Deudor>): Deudor => ({
  nombre: "Juan Pérez",
  moneda: "PYG",
  saldo: 1_000_000,
  desde: "2026-09-10",
  vencidoHace: 12,
  venceEl: null,
  ...p,
});

const BASE: HechosSemana = {
  ventas: { cantidad: 25, total: 7_187_500 },
  ventasAnterior: { cantidad: 20, total: 5_900_000 },
  deudores: [],
  seAcaba: [],
  productos: 10,
  productosSinCosto: 0,
};

test("los cuatro renglones, con una sola cosa para hacer", () => {
  const lineas = lineasDelResumen({
    ...BASE,
    deudores: [deudor({}), deudor({ nombre: "María", saldo: 500_000, vencidoHace: null })],
    seAcaba: [{ nombre: "Balanceado", dias: 4 }],
  });

  assert.deepEqual(lineas, [
    "Vendiste ₲ 7.187.500 en 25 ventas (la semana anterior, ₲ 5.900.000).",
    "Te deben ₲ 1.500.000 entre 2 clientes; lo más atrasado es Juan Pérez (vencido hace 12 días).",
    "Se te está por acabar: Balanceado (unos 4 días).",
    'Para hoy: cobrale a Juan Pérez: te debe ₲ 1.000.000. Preguntame "¿quién me debe?" y te dejo el mensaje listo para reenviar.',
  ]);
});

test("una cosa para hoy, por plata en juego", () => {
  // Sin nada vencido, lo que se acaba.
  assert.equal(
    unaCosaParaHoy({ ...BASE, deudores: [deudor({ vencidoHace: null })], seAcaba: [{ nombre: "Harina", dias: null }] }),
    "Reponé Harina, que ya está bajo tu mínimo.",
  );
  // Sin nada que se acabe, los costos.
  assert.ok(unaCosaParaHoy({ ...BASE, productosSinCosto: 3 }).startsWith("Pasame el costo de 3 productos"));
  // Sin ventas, anotarlas.
  assert.ok(unaCosaParaHoy({ ...BASE, ventas: { cantidad: 0, total: 0 } }).startsWith("Contame la primera venta"));
  // Todo en orden.
  assert.ok(unaCosaParaHoy(BASE).startsWith("Seguí contándome"));
});

test("sin stock controlado no hay renglón de stock; sin deudas se dice", () => {
  const lineas = lineasDelResumen({ ...BASE, seAcaba: null });
  assert.equal(lineas.length, 3);
  assert.equal(lineas[1], "Nadie te debe nada.");
});

test("el correo no usa palabras prohibidas", () => {
  const { asunto, html, texto } = redactarResumen({
    hechos: BASE,
    nombre: "Carmen López",
    appUrl: "https://eos.test",
    urlBaja: "https://eos.test/baja",
  });
  assert.equal(asunto, "Tu semana: ₲ 7.187.500 vendidos");
  assert.ok(texto.startsWith("Buen lunes, Carmen."));
  for (const p of ["ilimitado", "sin tope", "sin límite"]) {
    assert.ok(!`${asunto} ${html} ${texto}`.toLowerCase().includes(p), p);
  }
});

test("la baja del resumen está firmada con su propio motivo", () => {
  const url = new URL(urlDeBajaResumen("https://eos.test", "u1", "s"));
  assert.equal(url.searchParams.get("m"), MOTIVO_BAJA_RESUMEN);
  assert.ok(tokenDeBajaValido("u1", MOTIVO_BAJA_RESUMEN, url.searchParams.get("t")!, "s"));
  assert.ok(!tokenDeBajaValido("u1", "informe_impacto", url.searchParams.get("t")!, "s"));
});

function fuenteFalsa(cuentas: Record<string, string | null>, bajas: string[] = []) {
  const reclamados = new Set<string>();
  const fuente: FuenteResumen = {
    cuentasConVentas: async () => Object.keys(cuentas),
    yaReclamados: async () => new Set(reclamados),
    bajas: async () => new Set(bajas),
    perfil: async (uid) => ({ nombre: null, email: cuentas[uid] }),
    hechos: async () => BASE,
    reclamar: async (uid) => (reclamados.has(uid) ? false : (reclamados.add(uid), true)),
    soltar: async (uid) => void reclamados.delete(uid),
  };
  return { fuente, reclamados };
}

test("solo sale lunes y martes, una vez por semana, respetando la baja", async () => {
  const { fuente } = fuenteFalsa({ a: "a@x.py", b: "b@x.py", c: null }, ["b"]);
  const enviados: CorreoResumen[] = [];
  const correr = (hoy: string) =>
    enviarResumenesSemanales(fuente, {
      hoy,
      appUrl: "https://eos.test",
      secreto: "s",
      enviar: async (c) => void enviados.push(c),
    });

  assert.equal((await correr("2026-09-30")).semana, null); // miércoles
  assert.equal(enviados.length, 0);

  const lunes = await correr("2026-09-28");
  assert.equal(lunes.enviados, 1);
  assert.deepEqual(
    enviados.map((c) => c.para),
    ["a@x.py"],
  );

  // El martes no lo repite.
  assert.equal((await correr("2026-09-29")).enviados, 0);
});

test("si el envío falla el lunes, el martes se reintenta", async () => {
  const { fuente, reclamados } = fuenteFalsa({ a: "a@x.py" });
  const r1 = await enviarResumenesSemanales(fuente, {
    hoy: "2026-09-28",
    appUrl: "https://eos.test",
    secreto: "s",
    enviar: async () => {
      throw new Error("Resend caído");
    },
  });
  assert.equal(r1.fallidos, 1);
  assert.equal(reclamados.size, 0);

  const enviados: CorreoResumen[] = [];
  await enviarResumenesSemanales(fuente, {
    hoy: "2026-09-29",
    appUrl: "https://eos.test",
    secreto: "s",
    enviar: async (c) => void enviados.push(c),
  });
  assert.equal(enviados.length, 1);
});
