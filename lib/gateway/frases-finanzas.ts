/**
 * Las confirmaciones de la plata personal: qué quedó, por cuánto y DÓNDE verlo.
 *
 * ============================================================
 * EL CASO (29/09/2026)
 * ============================================================
 *
 * "Gasté 46.000 en Punto Farma con la Green… y gané 100.000." Por el camino
 * de texto la respuesta decía "Anoté la compra." y "La acción quedó
 * completada.": sin monto, sin tarjeta, sin dónde verla. La persona buscó la
 * compra en Movimientos —donde no va, porque no es un gasto del mes—, no la
 * encontró y dijo "no está". Cada "no está" la volvió a mandar: cinco compras.
 * Por el camino de imágenes (n8n) la frase sí decía monto y tarjeta. Los dos
 * caminos contaban cosas distintas de la misma acción.
 *
 * ============================================================
 * UNA SOLA FUENTE PARA LOS DOS CAMINOS
 * ============================================================
 *
 * Estas funciones las usa `ejecutar.ts` (texto) y las copia TAL CUAL al nodo
 * `05 INT Respuesta` del worker de n8n el parche
 * `n8n/parches/2026-09-29-finanzas-confirma-lo-guardado.mjs`, con
 * `Function.prototype.toString`. Por eso:
 *
 *   · reciben el mismo envoltorio que en n8n: `{ resultado }`;
 *   · no usan nada de afuera salvo las otras funciones de este archivo;
 *   · los tipos son solo `any`/`unknown` en la firma: al cargar, node los
 *     borra y lo que queda es JavaScript que n8n compila.
 *
 * `frases-finanzas.test.ts` prueba las dos cosas: lo que dicen y que el código
 * que viaja a n8n compila sin TypeScript.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Guaraníes como se escriben acá: punto de miles, coma decimal si hace falta. */
export function plataFin(n: any): string {
  const x = Number(n);
  if (!isFinite(x)) return String(n);
  const negativo = x < 0;
  const abs = Math.abs(x);
  const entero = Math.floor(abs);
  let texto = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimal = Math.round((abs - entero) * 100);
  if (decimal > 0) {
    let d = String(decimal);
    if (d.length === 1) d = "0" + d;
    if (d.charAt(1) === "0") d = d.charAt(0);
    texto = texto + "," + d;
  }
  return (negativo ? "-" : "") + texto;
}

export function signoFin(moneda: any): string {
  if (moneda === "USD") return "US$ ";
  if (!moneda || moneda === "PYG") return "₲ ";
  return moneda + " ";
}

/** AAAA-MM-DD → DD/MM. */
export function diaMesFin(iso: any): string {
  const s = String(iso || "");
  if (s.length < 10) return s;
  return s.slice(8, 10) + "/" + s.slice(5, 7);
}

/** Dónde se ve cada cosa en la app. Si la pantalla cambia de nombre, cambia acá. */
export const DONDE_TARJETAS = "Personal › Tengo y debo › Tarjetas";
export const DONDE_MOVIMIENTOS = "Personal › Mi mes › Movimientos";

/**
 * La compra con tarjeta.
 *
 * `ya_estaba` (v221): la misma compra llegó de nuevo y el ejecutor NO la
 * volvió a anotar. Se dice eso, con la hora, y cómo sumar una segunda de
 * verdad. Sin esta frase el reenvío se leería como "anoté otra".
 */
export function fraseDeCompraTarjeta(result: any): string | null {
  const r = (result && result.resultado) || {};
  if (!r.descripcion) return null;

  const signo = signoFin(r.moneda);
  const cuotas = Number(r.cuotas) || 1;
  const donde = "Personal › Tengo y debo › Tarjetas";
  const que =
    cuotas > 1
      ? r.descripcion + ": " + cuotas + " cuotas de " + signo + plataFin(r.monto_cuota) + " en " + r.tarjeta
      : r.descripcion + " por " + signo + plataFin(r.monto_cuota) + " en " + r.tarjeta;

  if (r.ya_estaba === true) {
    return (
      "Ya estaba anotada" + (r.anotada_a_las ? " desde las " + r.anotada_a_las : "") + ": " + que +
      ". No la anoté otra vez. La ves en " + donde +
      ". Si es otra compra igual, decime \"es otra\" y la sumo."
    );
  }

  const frases = ["Anoté " + que + "."];

  if (r.cuota_estimada) {
    frases.push("La cuota la saqué del total dividido " + cuotas + "; si con los intereses es otra, decímela.");
  }

  if (r.tarjeta_creada === true) {
    frases.push(r.tarjeta + " no estaba cargada: la agregué. Decime qué día cierra y qué día vence, así sé cuándo cae.");
  }

  // Lo contraintuitivo, dicho en voz alta: la persona va a buscar la compra
  // en Movimientos, y ahí no está porque no es un gasto del mes.
  frases.push("No es un gasto de este mes: sale cuando pagues el resumen. La ves en " + donde + ".");

  return frases.join(" ");
}

/** Qué campo de la tarjeta, en castellano. */
export function nombreDeCampoTarjeta(campo: any): string {
  const nombres: any = {
    emisor: "emisor",
    moneda: "moneda",
    linea_total: "límite",
    saldo_utilizado: "saldo usado",
    dia_cierre: "día de cierre",
    dia_vencimiento: "día de vencimiento",
    pago_minimo: "pago mínimo",
    pago_total: "total del resumen",
    resumen_al: "fecha del resumen",
  };
  return nombres[campo] || String(campo);
}

export function valorDeCampoTarjeta(campo: any, valor: any, moneda: any): string {
  if (valor === null || valor === undefined || valor === "") return "nada";
  if (campo === "linea_total" || campo === "saldo_utilizado" || campo === "pago_minimo" || campo === "pago_total") {
    return signoFin(moneda) + plataFin(valor);
  }
  if (campo === "resumen_al") return diaMesFin(valor);
  return String(valor);
}

/**
 * La tarjeta: alta, resumen o corrección.
 *
 * `sin_cambios` y `cambios` (v221): "Actualicé Green" sin decir qué dejaba a
 * la persona sin forma de ver que EOS le había cambiado el emisor por uno que
 * nadie dijo. Ahora cada campo que cambió va con su antes y su después, y si
 * no cambió nada se dice eso.
 */
export function fraseDeTarjeta(result: any): string | null {
  const r = (result && result.resultado) || {};
  if (!r.tarjeta) return null;

  const signo = signoFin(r.moneda);
  const frases: string[] = [];

  if (r.creada) frases.push("Cargué " + r.tarjeta + ".");

  // El resumen manda: si la persona acaba de contar cuánto vino, lo que quiere
  // ver confirmado es ese número y cuándo hay que pagarlo.
  const conResumen = r.pago_total !== null && r.pago_total !== undefined;
  if (conResumen) {
    let linea = "Resumen: " + signo + plataFin(r.pago_total);
    if (r.pago_minimo !== null && r.pago_minimo !== undefined) linea += ", mínimo " + signo + plataFin(r.pago_minimo);
    if (r.dia_vencimiento) linea += ". Vence el " + r.dia_vencimiento;
    frases.push(linea + ".");
  }

  if (r.creada) {
    if (r.dia_cierre && r.dia_vencimiento) {
      frases.push("Cierra el " + r.dia_cierre + " y vence el " + r.dia_vencimiento + ".");
    }
  } else {
    // Lo que el resumen ya dijo no se repite como "cambio".
    const delResumen = ["pago_total", "pago_minimo", "resumen_al"];
    const otros = (Array.isArray(r.cambios) ? r.cambios : []).filter(function (c: any) {
      return !conResumen || delResumen.indexOf(c.campo) < 0;
    });

    if (r.sin_cambios === true) {
      frases.push(r.tarjeta + " ya estaba cargada así: no cambié nada.");
    } else if (otros.length > 0) {
      const partes = otros.map(function (c: any) {
        return (
          nombreDeCampoTarjeta(c.campo) + " de " + valorDeCampoTarjeta(c.campo, c.antes, r.moneda) +
          " a " + valorDeCampoTarjeta(c.campo, c.despues, r.moneda)
        );
      });
      frases.push("En " + r.tarjeta + " cambié: " + partes.join("; ") + ".");
    } else if (!conResumen) {
      frases.push("Actualicé " + r.tarjeta + ".");
    }
  }

  if (r.falta_ciclo) {
    frases.push("Me falta qué día cierra y qué día vence para poder calcularte los vencimientos.");
  }

  frases.push("La ves en Personal › Tengo y debo › Tarjetas.");
  return frases.join(" ");
}

/**
 * Los movimientos personales: qué entró, qué salió, y qué YA estaba.
 *
 * `repetidos` (v221): lo que ya estaba anotado no se anota de nuevo, y se dice
 * cómo figuraba, para que la persona reconozca el suyo ("Punto Farma - Molas
 * López" del 27/09) en vez de creer que se perdió.
 */
export function fraseDePersonal(result: any): string {
  const r = (result && result.resultado) || {};
  const ms = Array.isArray(r.movimientos) ? r.movimientos : [];
  const repetidos = Array.isArray(r.repetidos) ? r.repetidos : [];
  const donde = "Personal › Mi mes › Movimientos";
  const frases: string[] = [];

  if (ms.length > 0) {
    const partes = ms.map(function (m: any) {
      // Tres verbos: una devolución no es un ingreso ni un gasto.
      const verbo = m.tipo === "ingreso" ? "Entró" : m.tipo === "devolucion" ? "Volvió" : "Salió";
      return verbo + " " + signoFin(m.moneda) + plataFin(m.monto) + " — " + m.descripcion;
    });
    frases.push(
      partes.join(". ") + ". " + (ms.length === 1 ? "Lo anoté" : "Los anoté") + " en " + donde +
        ". No toca las cuentas del negocio.",
    );
  }

  if (repetidos.length > 0) {
    const partes = repetidos.map(function (m: any) {
      return (
        signoFin(m.moneda) + plataFin(m.monto) + " del " + diaMesFin(m.fecha) +
        (m.como ? " (figura como \"" + m.como + "\")" : "")
      );
    });
    frases.push(
      (repetidos.length === 1 ? "Ya estaba anotado: " : "Ya estaban anotados: ") + partes.join("; ") +
        ". No lo anoté otra vez. Si es otro distinto, decime \"es otro\" y lo sumo.",
    );
  }

  if (frases.length === 0) return "No quedó nada anotado.";
  return frases.join(" ");
}

/**
 * El pago del resumen de una tarjeta (v222: REGISTRAR_PAGO_DEUDA contra una
 * tarjeta). En n8n la frase del pago de deuda no conocía `es_tarjeta` y
 * contestaba "No quedó registrado el pago." sobre un pago que sí quedó.
 */
export function fraseDePagoTarjeta(result: any): string | null {
  const r = (result && result.resultado) || {};
  if (r.es_tarjeta !== true) return null;

  const signo = signoFin(r.moneda);
  const nombre = r.tarjeta || "la tarjeta";
  const frases = ["Anoté el pago de " + signo + plataFin(r.pagado) + " de " + nombre + "."];

  if (r.saldo_despues !== null && r.saldo_despues !== undefined) {
    frases.push("Te queda usado " + signo + plataFin(r.saldo_despues) + ".");
  }

  frases.push(
    "Lo ves en Personal › Tengo y debo › Tarjetas, y la salida de plata en Personal › Mi mes › Movimientos.",
  );
  return frases.join(" ");
}

/**
 * Lo que viaja a n8n, en el orden en que se declara. Las de arriba primero:
 * las de abajo las llaman.
 */
export const FUNCIONES_PARA_N8N = [
  plataFin,
  signoFin,
  diaMesFin,
  nombreDeCampoTarjeta,
  valorDeCampoTarjeta,
  fraseDeCompraTarjeta,
  fraseDeTarjeta,
  fraseDePersonal,
  fraseDePagoTarjeta,
];
