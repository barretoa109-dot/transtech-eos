#!/usr/bin/env -S npx tsx
/**
 * Cada área de EOS, contra la realidad.
 *
 *     npx tsx scripts/auditar-areas.mts
 *
 * ============================================================
 * POR QUÉ ESTO NO ES UN DOCUMENTO
 * ============================================================
 *
 * Una auditoría escrita a mano envejece el mismo día y no se puede repetir. Y
 * la regla del encargo es explícita: no confiar en documentos que dicen que
 * algo existe o falta, verificarlo contra el código, la base y producción.
 *
 * Esto mide cuatro cosas por área, todas comprobables:
 *
 *   ¿EXISTE?      hay tabla y tiene filas
 *   ¿SE USA?      tiene filas de usuarios REALES, no de pruebas
 *   ¿EOS ESCRIBE? hay un verbo del chat que la llena
 *   ¿HAY PRUEBAS? hay archivos de prueba que cubren su lógica
 *
 * Un área que existe, no se usa, no tiene verbo y no tiene pruebas no es una
 * función: es una tabla.
 *
 * ============================================================
 * QUIÉN ES UN USUARIO REAL
 * ============================================================
 *
 * De 68 usuarios en la base, la mayoría los creó un script de certificación.
 * Contar sus filas como uso sería medirse a uno mismo. Real es quien tuvo una
 * conversación de verdad: diez mensajes o más.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env: Record<string, string> = {};
for (const linea of fs.readFileSync(`${RAIZ}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Un área: cómo se llama, dónde vive, qué verbo la llena y qué la prueba. */
type Area = {
  nombre: string;
  tabla: string;
  /** La acción del chat que escribe ahí, si existe. */
  verbo?: string;
  /** Los módulos de `lib/` cuyas pruebas cubren su lógica. */
  pruebas?: string[];
};

const AREAS: Area[] = [
  { nombre: "Chat", tabla: "mensajes", pruebas: ["gateway"] },
  { nombre: "Memoria", tabla: "eos_memory", verbo: "GUARDAR_MEMORIA", pruebas: ["eos/memoria-contexto"] },
  { nombre: "Objetivos", tabla: "eos_goals", verbo: "CREAR_OBJETIVO", pruebas: ["finanzas/objetivos"] },
  { nombre: "Tareas", tabla: "eos_tasks", verbo: "CREAR_TAREA" },
  { nombre: "Briefing", tabla: "eos_daily_briefings", pruebas: ["briefing"] },
  { nombre: "Decisiones", tabla: "eos_decisions" },
  { nombre: "Aprendizajes", tabla: "eos_learnings" },
  { nombre: "Business Twin", tabla: "eos_business_twins_v14" },
  { nombre: "Autonomía · reglas", tabla: "eos_autonomy_rules_v12", pruebas: ["autonomia"] },
  { nombre: "Autonomía · gate", tabla: "eos_worker_gate_audit_v15", pruebas: ["worker-gate"] },
  { nombre: "Órdenes del chat", tabla: "eos_action_commands", pruebas: ["eos/errores-accion"] },
  { nombre: "ERP · productos", tabla: "eos_erp_productos", verbo: "CREAR_PRODUCTO", pruebas: ["erp"] },
  { nombre: "ERP · ventas", tabla: "eos_erp_ventas", verbo: "REGISTRAR_VENTA", pruebas: ["erp"] },
  { nombre: "ERP · compras", tabla: "eos_erp_compras", verbo: "REGISTRAR_COMPRA" },
  { nombre: "ERP · cuenta corriente", tabla: "eos_erp_cuenta_movimientos_v107", verbo: "REGISTRAR_COBRO" },
  { nombre: "CRM · contactos", tabla: "eos_crm_contactos", verbo: "CREAR_CONTACTO", pruebas: ["crm"] },
  { nombre: "CRM · oportunidades", tabla: "eos_crm_oportunidades", verbo: "REGISTRAR_OPORTUNIDAD", pruebas: ["crm/embudo"] },
  { nombre: "Personal · movimientos", tabla: "eos_movimientos_financieros", verbo: "REGISTRAR_MOVIMIENTO_PERSONAL", pruebas: ["finanzas/panorama"] },
  { nombre: "Personal · cuentas", tabla: "eos_finanzas_cuentas", verbo: "DECLARAR_SALDO" },
  { nombre: "Personal · deudas", tabla: "eos_finanzas_deudas", verbo: "REGISTRAR_DEUDA", pruebas: ["finanzas/deudas"] },
  { nombre: "Personal · tarjetas", tabla: "eos_finanzas_tarjetas", verbo: "REGISTRAR_TARJETA", pruebas: ["finanzas/tarjetas"] },
  { nombre: "Personal · fijos", tabla: "eos_finanzas_fijos", verbo: "REGISTRAR_GASTO_FIJO", pruebas: ["finanzas/fijos"] },
  { nombre: "Personal · transferencias", tabla: "eos_finanzas_transferencias", verbo: "REGISTRAR_TRANSFERENCIA" },
  { nombre: "Personal · bienes", tabla: "eos_finanzas_activos", pruebas: ["finanzas/patrimonio"] },
  { nombre: "Personal · política", tabla: "eos_finanzas_politica" },
  { nombre: "Onboarding", tabla: "eos_onboarding" },
  { nombre: "Indicadores · historia", tabla: "eos_kpi_historia_v105", pruebas: ["kpi"] },
  { nombre: "Documentos", tabla: "eos_documentos", pruebas: ["documentos"] },
  { nombre: "Auditoría", tabla: "eos_auditoria_v60" },
  { nombre: "Pagos", tabla: "eos_pagos" },
];

// ------------------------------------------------------------ usuarios reales
const { data: mensajes } = await db.from("mensajes").select("usuario_id").limit(5000);
const porUsuario = new Map<string, number>();
for (const m of (mensajes ?? []) as { usuario_id: string }[]) {
  porUsuario.set(m.usuario_id, (porUsuario.get(m.usuario_id) ?? 0) + 1);
}
const REALES = [...porUsuario.entries()].filter(([, n]) => n >= 10).map(([id]) => id);

// -------------------------------------------------------------- qué se prueba
const archivosDePrueba: string[] = [];
function recorrer(dir: string) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) recorrer(completo);
    else if (entrada.name.endsWith(".test.ts")) {
      archivosDePrueba.push(completo.replace(/\\/g, "/").split("/lib/")[1] ?? entrada.name);
    }
  }
}
recorrer(path.join(RAIZ, "lib"));

// -------------------------------------------------------- qué verbos existen
const sistema = fs.readFileSync(path.join(RAIZ, "lib", "gateway", "sistema.ts"), "utf8");
const prompt = JSON.parse(`"${sistema.match(/export const PROMPT_SISTEMA = "([\s\S]*?)";/)![1]}"`) as string;
const seccion = prompt.slice(prompt.indexOf("Acciones permitidas:"), prompt.indexOf("Acciones del negocio"));
const VERBOS = new Set([...seccion.matchAll(/^([A-Z_]{4,})$/gm)].map((m) => m[1]));

// ------------------------------------------------------------------ el barrido
console.log(`\nUsuarios reales (10+ mensajes): ${REALES.length} de ${porUsuario.size} que hablaron alguna vez\n`);
console.log(
  `${"ÁREA".padEnd(26)}${"FILAS".padStart(7)}${"DE REALES".padStart(11)}  ${"VERBO".padEnd(30)}PRUEBAS`,
);
console.log("-".repeat(96));

const sinUso: string[] = [];
const sinVerbo: string[] = [];
const sinPruebas: string[] = [];

for (const area of AREAS) {
  const total = await db.from(area.tabla).select("*", { count: "exact", head: true });

  if (total.error) {
    console.log(`${area.nombre.padEnd(26)}${"—".padStart(7)}   (no existe: ${total.error.message.slice(0, 40)})`);
    continue;
  }

  const deReales =
    REALES.length > 0
      ? await db.from(area.tabla).select("*", { count: "exact", head: true }).in("usuario_id", REALES)
      : { count: 0, error: null };

  const conteoReales = deReales.error ? -1 : (deReales.count ?? 0);

  const verbo = area.verbo
    ? VERBOS.has(area.verbo)
      ? area.verbo
      : `${area.verbo} (NO está en el prompt)`
    : "—";

  const pruebas = (area.pruebas ?? []).flatMap((p) =>
    archivosDePrueba.filter((a) => a.startsWith(p)),
  );

  console.log(
    `${area.nombre.padEnd(26)}${String(total.count ?? 0).padStart(7)}${String(conteoReales === -1 ? "n/a" : conteoReales).padStart(11)}  ${verbo.padEnd(30)}${pruebas.length || "—"}`,
  );

  if (conteoReales === 0) sinUso.push(area.nombre);
  if (!area.verbo) sinVerbo.push(area.nombre);
  if (pruebas.length === 0) sinPruebas.push(area.nombre);
}

console.log("\n" + "=".repeat(96));
console.log(`\nSIN UN SOLO DATO DE UN USUARIO REAL (${sinUso.length}):`);
console.log("  " + (sinUso.join(", ") || "ninguna"));
console.log(`\nSIN VERBO DEL CHAT QUE LAS LLENE (${sinVerbo.length}):`);
console.log("  " + (sinVerbo.join(", ") || "ninguna"));
console.log(`\nSIN PRUEBAS DE SU LÓGICA (${sinPruebas.length}):`);
console.log("  " + (sinPruebas.join(", ") || "ninguna"));
console.log(
  `\nLas tres listas juntas son la definición de "existe y no es una función":\n` +
    "  " +
    (sinUso.filter((n) => sinVerbo.includes(n) && sinPruebas.includes(n)).join(", ") || "ninguna"),
);
