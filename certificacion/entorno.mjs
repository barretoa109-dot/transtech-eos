/**
 * De dónde saca la suite sus credenciales, y contra qué se le permite correr.
 *
 * ============================================================
 * ESTA SUITE TOCA DATOS DE VERDAD
 * ============================================================
 *
 * A diferencia de `npm run evals`, que es puro cálculo, acá se crean ventas, se
 * cobran tarjetas contra Bancard y se activan módulos. Es la única forma de
 * certificar un circuito comercial: un pago simulado no prueba que el pago
 * funcione.
 *
 * Por eso hay tres candados:
 *
 *   1. Bancard tiene que estar en `staging`. Si alguien pone la suite a correr
 *      con las claves de producción, cobra plata real de tarjetas reales.
 *   2. Todo pasa por UNA cuenta de certificación declarada a mano, nunca por la
 *      cuenta de un usuario.
 *   3. Cada caso limpia lo que creó, y el corredor limpia igual si un caso
 *      explota a la mitad.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function leerEnv() {
  const ruta = path.join(RAIZ, ".env.local");

  if (!fs.existsSync(ruta)) {
    throw new Error(
      "Falta .env.local. La certificación necesita las claves de servicio y las de Bancard.",
    );
  }

  const texto = fs.readFileSync(ruta, "utf8");
  const valores = {};

  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) valores[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }

  return valores;
}

const env = leerEnv();

export const CONFIG = {
  supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
  serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  bancardEntorno: (env.BANCARD_ENV || "staging").toLowerCase(),
  bancardPublica: env.BANCARD_PUBLIC_KEY,
  bancardPrivada: env.BANCARD_PRIVATE_KEY,
  bancardBase: "https://vpos.infonet.com.py:8888/vpos/api/0.3",

  /*
   * La cuenta con la que se certifica.
   *
   * Es una sola y a propósito: los pagos necesitan una tarjeta ya catastrada, y
   * catastrar una exige el formulario de Bancard en un navegador, que no se
   * puede automatizar. Los casos que NO necesitan tarjeta crean su propia
   * cuenta descartable.
   */
  cuenta: env.EOS_CERT_EMAIL || "demo@transtech.com.py",

  sitio: "https://www.transtech.com.py",
};

export function verificarCandados() {
  const problemas = [];

  if (!CONFIG.supabaseUrl || !CONFIG.serviceKey) {
    problemas.push("Faltan las claves de Supabase.");
  }

  if (CONFIG.bancardEntorno !== "staging") {
    problemas.push(
      `BANCARD_ENV está en "${CONFIG.bancardEntorno}". La certificación cobra de verdad: ` +
        "sólo corre contra staging.",
    );
  }

  if (!CONFIG.bancardPublica || !CONFIG.bancardPrivada) {
    problemas.push("Faltan las claves de Bancard.");
  }

  return problemas;
}

let clienteAdmin = null;

export function admin() {
  if (!clienteAdmin) {
    clienteAdmin = createClient(CONFIG.supabaseUrl, CONFIG.serviceKey, {
      auth: { persistSession: false },
    });
  }

  return clienteAdmin;
}

/** El usuario de certificación, resuelto una sola vez. */
let usuarioCache = null;

export async function usuarioCertificacion() {
  if (usuarioCache) return usuarioCache;

  const { data, error } = await admin()
    .from("usuarios")
    .select("id,email,nombre")
    .eq("email", CONFIG.cuenta)
    .maybeSingle();

  if (error) throw new Error("No se pudo leer la cuenta de certificación: " + error.message);

  if (!data) {
    throw new Error(
      `No existe la cuenta de certificación "${CONFIG.cuenta}". ` +
        "Creala, catastrale una tarjeta de prueba y volvé a correr.",
    );
  }

  usuarioCache = data;
  return usuarioCache;
}
