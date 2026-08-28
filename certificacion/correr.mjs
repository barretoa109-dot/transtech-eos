/**
 * Certificación del recorrido comercial de EOS.
 *
 *   npm run certificar              todos los casos
 *   npm run certificar -- 3 4       sólo esos
 *
 * ============================================================
 * QUÉ ES Y QUÉ NO ES
 * ============================================================
 *
 * Es la lista que hay que ver en verde ANTES de abrirle EOS a alguien que
 * pagó. Recorre lo que hace un cliente de verdad —registrarse, elegir módulos,
 * pagar, usar el ERP, corregir un error, irse— contra la base y la pasarela
 * reales.
 *
 * NO reemplaza a `npm test` ni a `npm run evals`. Esos prueban unidades y
 * criterios; esto prueba que las piezas encajen. Un sistema puede tener las
 * tres suites en verde y aun así fallarle a alguien: por eso también existe la
 * lista de revisión a mano en el README.
 *
 * ============================================================
 * POR QUÉ NO HAY UMBRAL DE APROBACIÓN
 * ============================================================
 *
 * Un caso crítico que falla corta, punto. La suite de evals aprendió por las
 * malas que un umbral con holgura ("que pase el 80%") tolera regresiones por
 * construcción: algo se rompe, el porcentaje aguanta y nadie se entera. Acá
 * pasa lo mismo pero con plata.
 */

import { CONFIG, admin, usuarioCertificacion, verificarCandados } from "./entorno.mjs";

import { caso as registro } from "./casos/01-registro.mjs";
import { caso as modulos } from "./casos/02-modulos.mjs";
import { caso as pago } from "./casos/03-pago.mjs";
import { caso as activacion } from "./casos/04-activacion.mjs";
import { caso as renovacion } from "./casos/05-renovacion.mjs";
import { caso as vencimiento } from "./casos/06-vencimiento.mjs";
import { caso as onboarding } from "./casos/07-onboarding.mjs";
import { caso as ventaCompra } from "./casos/08-venta-compra.mjs";
import { caso as anulacion } from "./casos/09-anulacion.mjs";
import { caso as cuenta } from "./casos/10-cuenta.mjs";

const CASOS = [
  registro,
  modulos,
  pago,
  activacion,
  renovacion,
  vencimiento,
  onboarding,
  ventaCompra,
  anulacion,
  cuenta,
];

const VERDE = "\x1b[32m";
const ROJO = "\x1b[31m";
const GRIS = "\x1b[90m";
const AMARILLO = "\x1b[33m";
const FIN = "\x1b[0m";

async function main() {
  const problemas = verificarCandados();

  if (problemas.length > 0) {
    console.error(`${ROJO}No se puede certificar:${FIN}`);
    for (const p of problemas) console.error("  · " + p);
    process.exit(2);
  }

  const pedidos = process.argv.slice(2).map(Number).filter(Number.isFinite);
  const aCorrer = pedidos.length > 0 ? CASOS.filter((c) => pedidos.includes(c.numero)) : CASOS;

  if (aCorrer.length === 0) {
    console.error("Ningún caso coincide con lo pedido.");
    process.exit(2);
  }

  const usuario = await usuarioCertificacion();

  console.log(`\nCertificación de EOS`);
  console.log(`${GRIS}cuenta: ${usuario.email}  ·  Bancard: ${CONFIG.bancardEntorno}${FIN}\n`);

  const resultados = [];

  for (const caso of aCorrer) {
    /*
     * Cada caso junta su propia basura y la tira al final, pase lo que pase.
     * Sin esto, un caso que explota a la mitad deja ventas y productos sueltos
     * que ensucian la corrida siguiente y hacen dudar de un resultado que
     * estaba bien.
     */
    const limpiezas = [];
    const chequeos = [];

    const contexto = {
      admin,
      usuario,
      comprobar(titulo, condicion, detalle = "") {
        chequeos.push({ titulo, ok: Boolean(condicion), detalle: String(detalle) });
      },

      /*
       * Lo que no se pudo comprobar ahora, y por qué.
       *
       * No es verde y no es rojo: es "esto quedó sin verificar". Meterlo en
       * cualquiera de los dos sería mentir — en verde, diciendo que se probó
       * algo que no se probó; en rojo, frenando un lanzamiento por algo que no
       * está roto. Se cuenta aparte y se muestra al final para que nadie lo
       * pase por alto.
       */
      sinProbar(titulo, motivo) {
        chequeos.push({ titulo, ok: true, pendiente: true, detalle: String(motivo) });
      },
      alTerminar(fn) {
        limpiezas.push(fn);
      },
    };

    console.log(`${caso.numero}. ${caso.nombre}`);

    let explosion = null;

    try {
      await caso.correr(contexto);
    } catch (error) {
      explosion = error instanceof Error ? error.message : String(error);
      chequeos.push({ titulo: "el caso terminó sin explotar", ok: false, detalle: explosion });
    }

    // Al revés: lo último que se creó es lo primero que se borra.
    for (const limpiar of limpiezas.reverse()) {
      try {
        await limpiar();
      } catch (error) {
        console.log(
          `   ${GRIS}(no se pudo limpiar algo: ${
            error instanceof Error ? error.message : error
          })${FIN}`,
        );
      }
    }

    for (const c of chequeos) {
      const marca = c.pendiente
        ? `${AMARILLO}·· ${FIN}`
        : c.ok
          ? `${VERDE}ok${FIN}`
          : `${ROJO}FALLA${FIN}`;
      console.log(`   ${marca}  ${c.titulo}${c.detalle ? `  ${GRIS}${c.detalle}${FIN}` : ""}`);
    }

    const fallados = chequeos.filter((c) => !c.ok).length;
    resultados.push({ caso, chequeos, fallados });

    console.log("");
  }

  // ---------- Veredicto ----------
  const total = resultados.reduce((n, r) => n + r.chequeos.length, 0);
  const malos = resultados.reduce((n, r) => n + r.fallados, 0);

  const pendientes = resultados.flatMap((r) =>
    r.chequeos.filter((c) => c.pendiente).map((c) => ({ caso: r.caso.nombre, ...c })),
  );
  const criticosRotos = resultados.filter((r) => r.fallados > 0 && r.caso.critico);

  console.log("─".repeat(60));
  console.log(`${total - malos - pendientes.length} de ${total} comprobaciones en verde`);

  if (pendientes.length > 0) {
    console.log(
      `${AMARILLO}${pendientes.length} sin verificar en esta corrida:${FIN}`,
    );

    for (const p of pendientes) {
      console.log(`  ${AMARILLO}··${FIN} ${p.caso} — ${p.titulo}`);
      console.log(`     ${GRIS}${p.detalle}${FIN}`);
    }

    console.log("");
  }

  if (malos === 0) {
    console.log(
      pendientes.length === 0
        ? `${VERDE}Recorrido comercial certificado.${FIN}\n`
        : `${VERDE}Todo lo que se pudo probar, en verde.${FIN} ${GRIS}Mirá lo de arriba antes de lanzar.${FIN}\n`,
    );
    process.exit(0);
  }

  for (const r of resultados.filter((x) => x.fallados > 0)) {
    console.log(
      `${ROJO}·${FIN} ${r.caso.nombre}: ${r.fallados} ${
        r.fallados === 1 ? "comprobación falló" : "comprobaciones fallaron"
      }${r.caso.critico ? `  ${ROJO}(crítico)${FIN}` : ""}`,
    );
  }

  if (criticosRotos.length > 0) {
    console.log(`\n${ROJO}No se puede lanzar con esto roto.${FIN}\n`);
    process.exit(1);
  }

  console.log(`\n${GRIS}Nada crítico, pero alguien tiene que mirarlo.${FIN}\n`);
  process.exit(1);
}

main().catch((error) => {
  console.error("\nLa certificación no pudo correr:", error);
  process.exit(2);
});
