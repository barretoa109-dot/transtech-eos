import { monedaConocida } from "../finanzas/monedas.ts";
import {
  detectarGastosAnormales,
  redactarGastoAnormal,
  type FijoDeclarado,
  type GastoAnormal,
  type GastoHistorico,
} from "./gasto-anormal.ts";

import { proyectarAgotamiento, type SalidaDeStock } from "./agotamiento.ts";
import {
  pagosAProveedores,
  redactarPagos,
  type CompraAPagar,
  type PagosPorMoneda,
} from "./pagos-proveedores.ts";

export type { CompraAPagar, FijoDeclarado, GastoHistorico, SalidaDeStock };

/**
 * Los riesgos que no son de la caja, sino del negocio.
 *
 * ============================================================
 * QUÉ FALTABA
 * ============================================================
 *
 * `lib/finanzas/riesgo.ts` encuentra el día en que la plata no alcanza. Es la
 * mitad del punto 20 de la lista: quedaban inventario bajo y cobros pendientes,
 * que son los dos avisos que un comercio necesita y que hoy nadie le da.
 *
 * Quedarse sin el producto que más sale es una venta perdida que no aparece en
 * ningún reporte, porque la venta que no se hizo no deja rastro. Y una venta a
 * crédito que lleva dos meses sin cobrarse es plata que el usuario ya cuenta
 * como suya y que cada día se parece más a una pérdida.
 *
 * ============================================================
 * LA CLAVE ES LO QUE EVITA EL RUIDO
 * ============================================================
 *
 * El detector encuentra el MISMO problema todos los días hasta que se resuelve.
 * Mandarlo cinco veces es exactamente lo que entrena a ignorar los avisos.
 *
 * `lib/finanzas/avisos.ts` resuelve eso para el faltante comparando fecha y
 * monto. Acá la regla es más simple y más exacta: cada riesgo trae una CLAVE
 * armada con los ids de lo que lo compone. Si la clave no cambió, es el mismo
 * problema y no se vuelve a avisar. Si entró un producto nuevo a la lista de
 * faltantes, la clave cambia y eso sí es una noticia.
 *
 * ============================================================
 * LOS GASTOS ANORMALES, APAGADOS HASTA EL 6 DE SEPTIEMBRE DE 2026
 * ============================================================
 *
 * Acá decía que el tercer aviso del punto 20 —"gastos anormales"— no se
 * encendía, porque cualquier regla razonable marca como anormal la compra
 * anual del seguro y el mismo punto pide no mandar alarmas falsas.
 *
 * El razonamiento seguía en pie; lo que faltaba era ver que "raro" y "problema"
 * no son lo mismo, y que lo que los separa no está en el monto sino en si ya
 * pasó antes y en si el usuario ya lo sabía. Eso vive en `gasto-anormal.ts`,
 * con las cinco condiciones escritas y sus casos —incluido el del seguro, que
 * se avisa el primer año y se calla solo a partir del segundo—.
 */

export type ProductoStock = {
  id: string;
  nombre: string;
  stock_actual: number;
  stock_minimo: number;
  controla_stock: boolean;
  activo: boolean;
};

export type VentaACobrar = {
  id: string;
  fecha: string;
  total: number;
  moneda: string | null;
  /**
   * Cuándo vence, si se pactó plazo (v168). Null cuando no se pactó, que no
   * es lo mismo que vencido — mismo criterio que `lib/erp/cartera.ts`.
   */
  vence_el?: string | null;
};

export type RiesgoNegocio =
  | {
      tipo: "inventario_bajo";
      /** Los mismos productos dan la misma clave: eso frena la repetición. */
      clave: string;
      productos: { nombre: string; stock: number; minimo: number }[];
    }
  | {
      /**
       * Lo que todavía no está bajo el mínimo pero, al ritmo de las últimas
       * semanas, se acaba pronto. Ver `lib/erp/agotamiento.ts`.
       */
      tipo: "stock_por_agotarse";
      clave: string;
      productos: { nombre: string; stock: number; dias: number }[];
    }
  | {
      /**
       * Pagos a proveedores vencidos o que vencen en los próximos 7 días. Uno
       * solo con todas las monedas adentro: el aviso guarda una fila por tipo.
       * Ver `lib/erp/pagos-proveedores.ts`.
       */
      tipo: "pagos_a_proveedores";
      clave: string;
      grupos: PagosPorMoneda[];
    }
  | {
      tipo: "cobros_demorados";
      clave: string;
      moneda: string;
      total: number;
      cantidad: number;
      /** Días de la más vieja. Es lo que vuelve urgente al aviso. */
      dias_de_la_mas_vieja: number;
    }
  | {
      tipo: "gasto_anormal";
      clave: string;
      /** El detalle de cada uno, con contra qué se lo comparó. */
      gastos: GastoAnormal[];
    };

/**
 * A partir de cuántos días una venta a crédito sin cobrar es una noticia,
 * CUANDO NO SE PACTÓ UN VENCIMIENTO.
 *
 * Treinta, el plazo comercial habitual en Paraguay. Desde la v168 existe
 * `vence_el` en `eos_erp_ventas` y se usa cuando está cargado —ver más abajo,
 * `estaDemorada()`—; este número queda como el criterio de respaldo para las
 * ventas que no lo tienen, que hoy siguen siendo casi todas: cargar el
 * vencimiento es opcional, y una venta vieja nunca lo va a tener hacia atrás.
 * No inventa una mora que nadie pactó: sigue diciendo "hace más de treinta
 * días desde la venta", no "vencida".
 */
const DIAS_DEMORA = 30;

/** Cuántos productos se nombran. Una lista de cuarenta no se lee. */
const MAX_PRODUCTOS = 5;

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function detectarRiesgosNegocio(datos: {
  hoy: string;
  productos: ProductoStock[];
  ventasACobrar: VentaACobrar[];
  diasDemora?: number;
  /** Opcionales: sin ellos, el aviso de gasto anormal simplemente no existe. */
  gastos?: GastoHistorico[];
  fijos?: FijoDeclarado[];
  /** Las salidas del kardex de los últimos 30 días. Sin ellas no hay proyección. */
  salidasStock?: SalidaDeStock[];
  /** Compras a crédito sin pagar del todo, con lo ya pagado. Sin ellas no hay aviso de pagos. */
  comprasAPagar?: CompraAPagar[];
}): RiesgoNegocio[] {
  const riesgos: RiesgoNegocio[] = [];

  // ---------- Inventario bajo ----------
  //
  // Solo lo que lleva stock y está activo. Un servicio no puede faltar, y un
  // producto dado de baja no interesa aunque su saldo diga cero.
  const faltantes = datos.productos
    .filter((p) => p.controla_stock && p.activo && p.stock_actual <= p.stock_minimo)
    .sort((a, b) => a.stock_actual - b.stock_actual || a.id.localeCompare(b.id));

  if (faltantes.length > 0) {
    riesgos.push({
      tipo: "inventario_bajo",
      // Los ids ordenados: la misma lista da la misma clave, y agregar uno la
      // cambia. Va la lista COMPLETA aunque solo se nombren cinco, para que un
      // producto nuevo en el puesto veinte también cuente como noticia.
      clave: faltantes
        .map((p) => p.id)
        .sort()
        .join(","),
      productos: faltantes.slice(0, MAX_PRODUCTOS).map((p) => ({
        nombre: p.nombre,
        stock: p.stock_actual,
        minimo: p.stock_minimo,
      })),
    });
  }

  // ---------- Stock por agotarse ----------
  //
  // Solo con salidas reales del kardex. Sin ellas, o con muy pocas, no hay
  // ritmo y no se inventa uno: ver `lib/erp/agotamiento.ts`.
  const porAgotarse = proyectarAgotamiento({
    hoy: datos.hoy,
    productos: datos.productos,
    salidas: datos.salidasStock ?? [],
  });

  if (porAgotarse.length > 0) {
    riesgos.push({
      tipo: "stock_por_agotarse",
      clave: porAgotarse
        .map((p) => p.id)
        .sort()
        .join(","),
      productos: porAgotarse.slice(0, MAX_PRODUCTOS).map((p) => ({
        nombre: p.nombre,
        stock: p.stock,
        dias: p.dias_restantes,
      })),
    });
  }

  // ---------- Cobros demorados ----------
  //
  // Por moneda y sin convertir, como todo lo demás: sumar guaraníes con
  // dólares daría un total que no existe en ninguna de las dos.
  const limite = datos.diasDemora ?? DIAS_DEMORA;

  /*
   * Con vencimiento pactado (v168), demorada es la que ya venció —cero
   * invención, mismo criterio que `lib/erp/cartera.ts` (`tramoDe`)—. Sin
   * vencimiento, sigue el respaldo de siempre: más de `limite` días desde la
   * venta. Las dos reglas conviven porque hoy conviven las dos clases de
   * venta: la que cargó un plazo y la que no.
   */
  const diasDeAtraso = (v: VentaACobrar): number =>
    v.vence_el ? diasEntre(v.vence_el, datos.hoy) : diasEntre(v.fecha, datos.hoy);

  const estaDemorada = (v: VentaACobrar): boolean =>
    v.vence_el ? diasDeAtraso(v) > 0 : diasDeAtraso(v) >= limite;

  const demoradas = datos.ventasACobrar.filter(estaDemorada);

  const porMoneda = new Map<string, VentaACobrar[]>();
  for (const venta of demoradas) {
    const moneda = monedaConocida(venta.moneda);
    if (!porMoneda.has(moneda)) porMoneda.set(moneda, []);
    porMoneda.get(moneda)!.push(venta);
  }

  for (const [moneda, ventas] of [...porMoneda.entries()].sort()) {
    riesgos.push({
      tipo: "cobros_demorados",
      clave: `${moneda}:${ventas
        .map((v) => v.id)
        .sort()
        .join(",")}`,
      moneda,
      total: ventas.reduce((t, v) => t + Number(v.total ?? 0), 0),
      cantidad: ventas.length,
      dias_de_la_mas_vieja: Math.max(...ventas.map(diasDeAtraso)),
    });
  }

  // ---------- Pagos a proveedores ----------
  //
  // Solo lo que tiene fecha de vencimiento pactada: sin ella no hay plazo que
  // se pueda incumplir y no se inventa uno (ver `pagos-proveedores.ts`).
  const pagos = pagosAProveedores(datos.hoy, datos.comprasAPagar ?? [], monedaConocida);

  if (pagos.length > 0) {
    riesgos.push({
      tipo: "pagos_a_proveedores",
      // Por moneda y con los ids adentro: si entra un pago nuevo a la ventana
      // de 7 días, la clave cambia y eso sí es una noticia.
      clave: pagos.map((g) => `${g.moneda}:${g.ids.join(",")}`).join("|"),
      grupos: pagos,
    });
  }

  // ---------- Gasto anormal ----------
  //
  // Uno solo con la lista adentro, igual que el inventario bajo: dos avisos
  // separados el mismo día por dos gastos del mismo mes se leen como dos
  // problemas, y son el mismo mes raro.
  const anormales = detectarGastosAnormales({
    hoy: datos.hoy,
    gastos: datos.gastos ?? [],
    fijos: datos.fijos ?? [],
  });

  if (anormales.length > 0) {
    riesgos.push({
      tipo: "gasto_anormal",
      // Los ids de los movimientos, ordenados: si aparece otro gasto raro la
      // clave cambia y eso sí es una noticia nueva.
      clave: anormales
        .map((g) => g.clave)
        .sort()
        .join(","),
      gastos: anormales,
    });
  }

  return riesgos;
}

/** El texto del aviso. Concreto: sin el nombre y el número no sirve para nada. */
export function redactarRiesgoNegocio(
  riesgo: RiesgoNegocio,
  formatear: (monto: number, moneda: string) => string,
): string {
  if (riesgo.tipo === "inventario_bajo") {
    const lista = riesgo.productos
      .map((p) => `${p.nombre} (${p.stock} de ${p.minimo})`)
      .join(", ");

    return riesgo.productos.length === 1
      ? `Te estás quedando sin ${lista}.`
      : `Te estás quedando sin: ${lista}.`;
  }

  if (riesgo.tipo === "stock_por_agotarse") {
    const dias = (n: number) => (n === 1 ? "1 día" : `${n} días`);

    if (riesgo.productos.length === 1) {
      const p = riesgo.productos[0];
      return (
        `${p.nombre} tiene ${p.stock} unidades y, al ritmo de tus ventas de las últimas semanas, ` +
        `se agotaría en unos ${dias(p.dias)}. Decime y te dejo la reposición como tarea.`
      );
    }

    const lista = riesgo.productos
      .map((p) => `${p.nombre} (${p.stock}, unos ${dias(p.dias)})`)
      .join(", ");

    return (
      `Al ritmo de tus ventas de las últimas semanas, se te podrían acabar pronto: ${lista}. ` +
      "Decime y te dejo la reposición como tarea."
    );
  }

  if (riesgo.tipo === "pagos_a_proveedores") {
    return riesgo.grupos.map((g) => redactarPagos(g, formatear)).join(" ");
  }

  if (riesgo.tipo === "gasto_anormal") {
    // Cada uno con su comparación: sin eso el aviso obliga a ir a buscar el
    // historial a mano, que es justo lo que se quiere evitar.
    return riesgo.gastos.map((g) => redactarGastoAnormal(g, formatear)).join(" ");
  }

  // "Con atraso" y no "más de 30 días": desde la v168 algunas llegan acá por
  // vencimiento real, no por el plazo de respaldo, y ese número ya no es
  // siempre 30. `dias_de_la_mas_vieja` es exacto en los dos casos.
  const cuantas =
    riesgo.cantidad === 1 ? "Una venta a crédito lleva" : `${riesgo.cantidad} ventas a crédito llevan`;

  return (
    `${cuantas} atraso sin cobrarse, por ${formatear(riesgo.total, riesgo.moneda)}. ` +
    `La más vieja, ${riesgo.dias_de_la_mas_vieja} días.`
  );
}
