import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ACCIONES_INTERNAS } from "../gateway/ejecutar.ts";
import { SYSTEM_RISK } from "../autonomia/riesgo.ts";

/**
 * Lo que EOS hace desde el chat, en la bitácora inmutable.
 *
 * ============================================================
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ============================================================
 *
 * Hasta la v163 la bitácora no tenía una sola fila del chat: 64 órdenes
 * completadas y ninguna asentada. Ahora el asiento lo hace un trigger en SQL,
 * `eos_auditoria_orden_del_chat_v163`, con una tabla de renglones —acción,
 * evento, qué hizo, qué intentó hacer— escrita adentro de la función.
 *
 * Esa tabla puede fallar callada de tres maneras, y las tres se prueban acá:
 *
 *   · Un evento que no está en el check de la tabla. El insert revienta, el
 *     trigger lo atrapa para no tumbar la orden, y la acción queda sin asentar
 *     sin que nadie se entere. Es la peor de las tres.
 *   · Una acción nueva sin renglón. Se asienta igual, pero con su nombre de
 *     máquina en el resumen.
 *   · Una frase mal conjugada, que queda escrita para siempre en un registro
 *     que no se puede corregir.
 *
 * Se lee la última migración que define la función, igual que
 * `certificacion/casos/12-aislamiento.mjs` descubre las tablas: una lista
 * copiada acá se desactualizaría el día que alguien cambie la de allá.
 */

const MIGRACIONES = path.resolve(import.meta.dirname, "..", "..", "supabase", "migrations");
const DEFINICION = "create or replace function public.eos_auditoria_orden_del_chat_v";
const CHECK = "add constraint eos_auditoria_v60_evento_check";

/** Las acciones que no tocan datos: la función las saltea antes de buscar su renglón. */
const SIN_EFECTO = new Set(["RESPONDER", "VER_DASHBOARD", "VER_BRIEFING"]);

function ultimaQueContiene(fragmento: string): { archivo: string; sql: string } {
  let hallada: { archivo: string; sql: string } | null = null;

  for (const archivo of fs.readdirSync(MIGRACIONES).filter((a) => a.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(MIGRACIONES, archivo), "utf8");
    if (sql.toLowerCase().includes(fragmento)) hallada = { archivo, sql };
  }

  assert.ok(hallada, `ninguna migración contiene "${fragmento}"`);
  return hallada;
}

function sinComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

function cuerpoDeLaFuncion(sql: string): string {
  const inicio = sql.toLowerCase().indexOf(DEFINICION);
  const desde = sql.indexOf("$$", inicio);
  const hasta = sql.indexOf("$$", desde + 2);
  return sinComentarios(sql.slice(desde + 2, hasta));
}

type Renglon = { accion: string; evento: string; hizo: string; hacer: string };

const { archivo: ARCHIVO, sql: SQL } = ultimaQueContiene(DEFINICION);
const CUERPO = cuerpoDeLaFuncion(SQL);

const RENGLONES: Renglon[] = [
  ...CUERPO.slice(
    CUERPO.indexOf("from (values"),
    CUERPO.indexOf(") as m(accion, evento, hizo, hacer)"),
  ).matchAll(/\('([A-Z_]+)', '([a-z_]+)', '([^']+)', '([^']+)'\)/g),
].map(([, accion, evento, hizo, hacer]) => ({ accion, evento, hizo, hacer }));

const POR_ACCION = new Map(RENGLONES.map((r) => [r.accion, r]));

function eventosPermitidos(): Set<string> {
  const { sql } = ultimaQueContiene(CHECK);
  const desde = sql.toLowerCase().lastIndexOf(CHECK);
  const bloque = sql.slice(desde, sql.indexOf(");", desde));
  return new Set([...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

test("la tabla de renglones se pudo leer", () => {
  assert.ok(RENGLONES.length >= 20, `${ARCHIVO}: se leyeron ${RENGLONES.length} renglones`);
});

test("cada acción que el worker ejecuta tiene su renglón", () => {
  const faltan = [...ACCIONES_INTERNAS].filter((accion) => !POR_ACCION.has(accion));

  assert.deepEqual(faltan, [], `sin renglón en ${ARCHIVO}`);
});

test("cada acción con riesgo declarado que toca datos tiene su renglón", () => {
  const faltan = Object.keys(SYSTEM_RISK).filter(
    (accion) => !SIN_EFECTO.has(accion) && !POR_ACCION.has(accion),
  );

  assert.deepEqual(faltan, [], `sin renglón en ${ARCHIVO}`);
});

test("las que no tocan datos se saltean a propósito, no por olvido", () => {
  for (const accion of SIN_EFECTO) {
    assert.ok(CUERPO.includes(`'${accion}'`), `${accion} no figura en el salteo`);
    assert.equal(POR_ACCION.has(accion), false, `${accion} tiene renglón y además se saltea`);
  }
});

test("ninguna acción tiene dos renglones", () => {
  assert.equal(POR_ACCION.size, RENGLONES.length);
});

test("todo evento que usa el trigger existe en el check de la tabla", () => {
  /*
   * Si no existe, el insert falla, el trigger lo atrapa para no tumbar la
   * orden, y la acción queda sin asentar. Nada se rompe y nada consta: el
   * mismo silencio que la v163 vino a cerrar.
   */
  const permitidos = eventosPermitidos();
  const invalidos = RENGLONES.filter((r) => !permitidos.has(r.evento)).map(
    (r) => `${r.accion} → ${r.evento}`,
  );

  assert.deepEqual(invalidos, []);
  assert.ok(permitidos.has("accion_ejecutada"), "el evento de respaldo no está en el check");
  assert.ok(CUERPO.includes("coalesce(v_evento, 'accion_ejecutada')"), "falta el respaldo");
});

test("las operaciones del ERP usan su propio evento, vengan del panel o del chat", () => {
  // Así "todas las ventas que se registraron" las trae a todas, y no solo las
  // que alguien cargó a mano.
  const esperado: Record<string, string> = {
    REGISTRAR_VENTA: "venta_registrada",
    ANULAR_VENTA: "venta_anulada",
    CORREGIR_VENTA: "venta_editada",
    REGISTRAR_COBRO: "venta_cobrada",
    REGISTRAR_COMPRA: "compra_registrada",
    REGISTRAR_PAGO_COMPRA: "compra_pagada",
    AJUSTAR_STOCK: "stock_ajustado",
    CREAR_PRODUCTO: "producto_modificado",
    ACTUALIZAR_PRODUCTO: "producto_modificado",
  };

  for (const [accion, evento] of Object.entries(esperado)) {
    assert.equal(POR_ACCION.get(accion)?.evento, evento, accion);
  }
});

test("qué hizo y qué intentó hacer dicen lo mismo, conjugado", () => {
  for (const r of RENGLONES) {
    const [verboHizo, ...restoHizo] = r.hizo.split(" ");
    const [verboHacer, ...restoHacer] = r.hacer.split(" ");

    assert.equal(restoHizo.join(" "), restoHacer.join(" "), `${r.accion}: "${r.hizo}" / "${r.hacer}"`);
    assert.match(verboHacer, /(ar|er|ir)$/, `${r.accion}: "${verboHacer}" no es un infinitivo`);

    if (verboHacer.endsWith("ar")) {
      assert.equal(verboHizo, `${verboHacer.slice(0, -2)}ó`, r.accion);
    } else {
      assert.match(verboHizo, /ió$/, `${r.accion}: "${verboHizo}"`);
    }
  }
});

test("el trigger no copia el payload ni el texto del error", () => {
  // El payload trae `mensaje`, lo que la persona escribió tal cual. El
  // error_message es texto libre. Ninguno de los dos va a un registro que no
  // se puede borrar nunca.
  assert.equal(/new\.payload/i.test(CUERPO), false);
  assert.equal(/error_message/i.test(CUERPO), false);
});
