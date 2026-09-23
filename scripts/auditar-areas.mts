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
  /**
   * Los módulos de `lib/` cuyas pruebas cubren su lógica. OBLIGATORIO.
   *
   * Era opcional, y un área sin la clave salía "—" sin que nadie hubiera
   * buscado. El 10 de septiembre de 2026 eso hizo que este script —y la
   * auditoría escrita con él— dijera "catorce áreas sin una sola prueba"
   * cuando varias las tenían: la bitácora, con quince; la cuenta corriente,
   * las compras, el Business Twin, los pagos. Un script que se presenta como
   * medición no puede reportar como hallazgo lo que no miró.
   *
   * `[]` quiere decir "se buscó y no hay". La ausencia ya no compila.
   */
  pruebas: string[];
  /** Los casos de `certificacion/casos/` que la recorren contra producción. */
  certificacion?: string[];
};

const AREAS: Area[] = [
  { nombre: "Chat", tabla: "mensajes", pruebas: ["gateway"] },
  { nombre: "Memoria", tabla: "eos_memory", verbo: "GUARDAR_MEMORIA", pruebas: ["eos/memoria-contexto"] },
  { nombre: "Objetivos", tabla: "eos_goals", verbo: "CREAR_OBJETIVO", pruebas: ["finanzas/objetivos"] },
  // Solo cómo entran al contexto del modelo. El alta es SQL y no tiene prueba.
  { nombre: "Tareas", tabla: "eos_tasks", verbo: "CREAR_TAREA", pruebas: ["eos/memoria-contexto"] },
  { nombre: "Briefing", tabla: "eos_daily_briefings", pruebas: ["briefing"] },
  // Solo las pendientes en el Centro de atención.
  { nombre: "Decisiones", tabla: "eos_decisions", pruebas: ["eos/atencion"] },
  // Solo el filtro de lo que llega al prompt. El motor vive en n8n.
  { nombre: "Aprendizajes", tabla: "eos_learnings", pruebas: ["eos/memoria-contexto"] },
  { nombre: "Business Twin", tabla: "eos_business_twins_v14", pruebas: ["kpi/twin"] },
  { nombre: "Autonomía · reglas", tabla: "eos_autonomy_rules_v12", pruebas: ["autonomia/decision"] },
  { nombre: "Autonomía · gate", tabla: "eos_worker_gate_audit_v15", pruebas: ["autonomia", "seguridad/worker-bearer"] },
  {
    nombre: "Órdenes del chat",
    tabla: "eos_action_commands",
    pruebas: ["eos/errores-accion", "gateway/ejecutar", "auditoria/ordenes-del-chat"],
  },
  { nombre: "ERP · productos", tabla: "eos_erp_productos", verbo: "CREAR_PRODUCTO", pruebas: ["erp"] },
  { nombre: "ERP · ventas", tabla: "eos_erp_ventas", verbo: "REGISTRAR_VENTA", pruebas: ["erp"], certificacion: ["08-venta-compra", "09-anulacion"] },
  {
    nombre: "ERP · compras",
    tabla: "eos_erp_compras",
    verbo: "REGISTRAR_COMPRA",
    pruebas: ["erp/anulacion-invariantes", "kpi/definiciones/compras"],
    certificacion: ["08-venta-compra"],
  },
  {
    nombre: "ERP · cuenta corriente",
    tabla: "eos_erp_cuenta_movimientos_v107",
    verbo: "REGISTRAR_COBRO",
    pruebas: ["erp/cartera", "kpi/definiciones/cartera"],
  },
  { nombre: "CRM · contactos", tabla: "eos_crm_contactos", verbo: "CREAR_CONTACTO", pruebas: ["crm"] },
  { nombre: "CRM · oportunidades", tabla: "eos_crm_oportunidades", verbo: "REGISTRAR_OPORTUNIDAD", pruebas: ["crm/embudo"] },
  { nombre: "Personal · movimientos", tabla: "eos_movimientos_financieros", verbo: "REGISTRAR_MOVIMIENTO_PERSONAL", pruebas: ["finanzas/panorama"] },
  { nombre: "Personal · cuentas", tabla: "eos_finanzas_cuentas", verbo: "DECLARAR_SALDO", pruebas: ["eos/contexto-posicion", "finanzas/patrimonio"] },
  { nombre: "Personal · deudas", tabla: "eos_finanzas_deudas", verbo: "REGISTRAR_DEUDA", pruebas: ["finanzas/deudas"] },
  { nombre: "Personal · tarjetas", tabla: "eos_finanzas_tarjetas", verbo: "REGISTRAR_TARJETA", pruebas: ["finanzas/tarjetas"] },
  { nombre: "Personal · fijos", tabla: "eos_finanzas_fijos", verbo: "REGISTRAR_GASTO_FIJO", pruebas: ["finanzas/fijos"] },
  // Buscado el 12/09/2026: ninguna prueba la nombra salvo una lista de verbos.
  { nombre: "Personal · transferencias", tabla: "eos_finanzas_transferencias", verbo: "REGISTRAR_TRANSFERENCIA", pruebas: [] },
  { nombre: "Personal · bienes", tabla: "eos_finanzas_activos", pruebas: ["finanzas/patrimonio"] },
  // Buscado el 12/09/2026: ninguna prueba la nombra.
  { nombre: "Personal · política", tabla: "eos_finanzas_politica", pruebas: [] },
  { nombre: "Onboarding", tabla: "eos_onboarding", pruebas: ["auth/destino"], certificacion: ["07-onboarding"] },
  { nombre: "Indicadores · historia", tabla: "eos_kpi_historia_v105", pruebas: ["kpi"] },
  { nombre: "Documentos", tabla: "eos_documentos", pruebas: ["documentos"] },
  { nombre: "Auditoría", tabla: "eos_auditoria_v60", pruebas: ["auditoria"], certificacion: ["13-auditoria"] },
  { nombre: "Pagos", tabla: "eos_pagos", pruebas: ["pagos"], certificacion: ["03-pago", "05-renovacion", "06-vencimiento"] },
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

const casosDeCertificacion = fs.readdirSync(path.join(RAIZ, "certificacion", "casos"));

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
  const contar = () => db.from(area.tabla).select("*", { count: "exact", head: true });

  /*
   * Una lectura que falla no dice que la tabla no existe: dice que no se pudo
   * leer. Este script imprimía "(no existe: …)" ante cualquier error, y el
   * 12/09/2026 informó que el Chat —1.204 mensajes— no existía, por un conteo
   * que falló una vez y funcionó en la siguiente. Se reintenta una vez; si
   * igual falla, se dice lo que pasó y el script termina en error. Un error de
   * medición no puede salir impreso con cara de hallazgo.
   */
  let total = await contar();
  if (total.error) total = await contar();

  if (total.error) {
    process.exitCode = 1;
    console.log(
      `${area.nombre.padEnd(26)}${"?".padStart(7)}   NO SE PUDO CONTAR (${total.status} ${total.error.message.slice(0, 40) || "sin mensaje"})`,
    );
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

  /*
   * Un prefijo declarado que no encuentra ningún archivo es un error del
   * script, no un área sin pruebas: alguien renombró el módulo o lo escribió
   * mal. Se corta acá, en vez de volver a informar un "—" que nadie miró.
   */
  const pruebas = area.pruebas.flatMap((prefijo) => {
    const archivos = archivosDePrueba.filter((a) => a.startsWith(prefijo));
    if (archivos.length === 0) throw new Error(`${area.nombre}: ninguna prueba empieza con "${prefijo}"`);
    return archivos;
  });

  const certificacion = (area.certificacion ?? []).map((caso) => {
    const archivo = casosDeCertificacion.find((c) => c.startsWith(caso));
    if (!archivo) throw new Error(`${area.nombre}: no existe el caso de certificación "${caso}"`);
    return archivo;
  });

  const cobertura =
    [pruebas.length ? `${pruebas.length} lib` : "", certificacion.length ? `${certificacion.length} cert` : ""]
      .filter(Boolean)
      .join(" + ") || "—";

  console.log(
    `${area.nombre.padEnd(26)}${String(total.count ?? 0).padStart(7)}${String(conteoReales === -1 ? "n/a" : conteoReales).padStart(11)}  ${verbo.padEnd(30)}${cobertura}`,
  );

  if (conteoReales === 0) sinUso.push(area.nombre);
  if (!area.verbo) sinVerbo.push(area.nombre);
  if (pruebas.length === 0 && certificacion.length === 0) sinPruebas.push(area.nombre);
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
