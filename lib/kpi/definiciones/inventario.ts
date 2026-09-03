import {
  costoDeLoVendido,
  diasDeInventario,
  inventarioPromedio,
  rotacion,
  stockQuieto,
  valorInventario,
  type MovimientoKardex,
  type ProductoStock,
} from "../../erp/kardex.ts";
import { sinIva } from "../../erp/margen.ts";
import { monedaConocida } from "../../finanzas/monedas.ts";
import { valorConocido, valorDesconocido } from "../tipos.ts";
import type { DefinicionKPI, Hechos, Periodo, ProductoHecho, ValorKPI } from "../tipos.ts";

/**
 * Inventario, desde `eos_erp_productos`. Las dos fotos de acá son eso —fotos
 * de ahora, `instantanea: true`— porque el stock es un saldo del momento, sin
 * historia (`docs/erp-profesional-arquitectura.md`, §2). El día que exista
 * kardex valorizado (Fase 8 del plan de negocio), rotación y DIO se agregan
 * como definiciones nuevas; estas dos no cambian.
 */

function conControlDeStock(hechos: Hechos): ProductoHecho[] {
  return (hechos.productos ?? []).filter((p) => p.controla_stock && p.activo);
}

/**
 * El mismo criterio que `lib/erp/riesgos-negocio.ts` usa para el aviso
 * proactivo de "inventario bajo" — a propósito la misma definición, no una
 * segunda regla para la misma pregunta.
 */
export const PRODUCTOS_BAJO_MINIMO: DefinicionKPI = {
  id: "productos_bajo_minimo",
  nombre: "Productos bajo su stock mínimo",
  familia: "inventario",
  unidad: "cantidad",
  direccion: "menos_es_mejor",
  necesita: ["productos"],
  instantanea: true,
  umbrales: { atencion: 1, alerta: 5 },
  calcular(hechos): ValorKPI[] {
    const candidatos = conControlDeStock(hechos);
    const monedas = new Set(candidatos.map((p) => monedaConocida(p.moneda)));

    return [...monedas].sort().map((moneda) => {
      const cantidad = candidatos.filter(
        (p) => monedaConocida(p.moneda) === moneda && p.stock_actual <= p.stock_minimo,
      ).length;
      return valorConocido(moneda, cantidad);
    });
  },
};

/**
 * Cuánta plata está inmovilizada en lo que hay en el depósito, neta de IVA
 * igual que el resto de los indicadores de costo (`lib/erp/margen.ts`): el
 * IVA que pagaste por esa mercadería lo recuperás como crédito fiscal, no es
 * capital tuyo inmovilizado.
 *
 * `direccion: "neutro"` a propósito: tener capital en stock no es malo por sí
 * solo —es la mercadería que vas a vender— y este proyecto ya decidió no
 * inventar un umbral de "demasiado" sin la historia para saber qué es normal
 * en ESTE negocio (ver `lib/erp/riesgos-negocio.ts`, la nota sobre gastos
 * anormales).
 */
export const CAPITAL_INMOVILIZADO: DefinicionKPI = {
  id: "capital_inmovilizado",
  nombre: "Capital inmovilizado en stock",
  familia: "inventario",
  unidad: "moneda",
  direccion: "neutro",
  necesita: ["productos"],
  instantanea: true,
  calcular(hechos): ValorKPI[] {
    const conStock = conControlDeStock(hechos);
    const monedas = new Set(conStock.map((p) => monedaConocida(p.moneda)));

    return [...monedas].sort().map((moneda) => {
      const deMoneda = conStock.filter((p) => monedaConocida(p.moneda) === moneda);
      const costeados = deMoneda.filter((p) => p.costo !== null && p.costo > 0);

      if (costeados.length === 0) {
        return valorDesconocido(moneda, "Ningún producto con stock tiene costo cargado");
      }

      const total = costeados.reduce(
        (s, p) => s + sinIva(Number(p.costo) * p.stock_actual, p.iva),
        0,
      );

      const sinCosto = deMoneda.length - costeados.length;
      if (sinCosto === 0) return valorConocido(moneda, total);

      // Hay dato, pero incompleto: se dice el número Y que falta cargar el
      // resto, en vez de disimular como si estuviera completo.
      return {
        moneda,
        valor: total,
        confianza: {
          nivel: costeados.length / deMoneda.length,
          motivos: [`${sinCosto} de ${deMoneda.length} productos con stock no tienen costo cargado`],
        },
        falta: null,
      };
    });
  },
};

export const DEFINICIONES_INVENTARIO_BASE: DefinicionKPI[] = [PRODUCTOS_BAJO_MINIMO, CAPITAL_INMOVILIZADO];

/*
 * ============================================================
 * LO QUE HABILITÓ EL KARDEX VALORIZADO (v108)
 * ============================================================
 *
 * `lib/erp/indicadores.ts` decía en `loQueFalta()`: "Rotación de inventario
 * necesita el stock valorizado al inicio y al final del período. Hoy el stock
 * es un saldo del momento, sin historia." La v108 puso el valor en cada
 * movimiento del kardex, así que ahora sí hay con qué.
 *
 * La aritmética vive en `lib/erp/kardex.ts` y está testeada ahí; acá solo se
 * la expone como definiciones del motor.
 */

function movimientosDe(hechos: Hechos): MovimientoKardex[] {
  return (hechos.movimientos_stock ?? []).map((m) => ({
    fecha: m.fecha,
    tipo: m.tipo,
    cantidad: m.cantidad,
    costo_unitario: m.costo_unitario,
    valor_resultante: m.valor_resultante,
    producto_id: m.producto_id,
    moneda: monedaConocida(m.moneda),
  }));
}

function productosDe(hechos: Hechos): ProductoStock[] {
  return (hechos.productos ?? []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    moneda: monedaConocida(p.moneda),
    stock_actual: p.stock_actual,
    costo_promedio: p.costo_promedio,
    activo: p.activo,
    controla_stock: p.controla_stock,
  }));
}

function largoDelPeriodo(p: Periodo): number {
  return (
    Math.round((Date.parse(`${p.hasta}T00:00:00Z`) - Date.parse(`${p.desde}T00:00:00Z`)) / 86_400_000) + 1
  );
}

/**
 * Cuántas veces se dio vuelta el stock en el período.
 *
 * De período, no `instantanea`: compara el movimiento del mes contra el del
 * anterior, que es justamente la pregunta.
 */
export const ROTACION_INVENTARIO: DefinicionKPI = {
  id: "rotacion_inventario",
  nombre: "Rotación de inventario",
  familia: "inventario",
  unidad: "ratio",
  direccion: "mas_es_mejor",
  necesita: ["productos", "movimientos_stock"],
  calcular(hechos, periodo: Periodo): ValorKPI[] {
    const movs = movimientosDe(hechos);
    const valores = valorInventario(productosDe(hechos));

    return valores.map((v) => {
      const costo = costoDeLoVendido(movs, v.moneda, periodo.desde, periodo.hasta);
      const promedio = inventarioPromedio(movs, v.moneda, periodo.desde, periodo.hasta, v.valor);
      const rot = rotacion(costo, promedio);

      return rot === null
        ? valorDesconocido(
            v.moneda,
            costo === null
              ? "Todavía no hay salidas de stock con costo conocido en el período"
              : "Falta el valor del inventario al inicio del período: el kardex arrancó después",
          )
        : valorConocido(v.moneda, rot);
    });
  },
};

/** Cuántos días dura el stock al ritmo del período. */
export const DIAS_DE_INVENTARIO: DefinicionKPI = {
  id: "dias_de_inventario",
  nombre: "Días de inventario",
  familia: "inventario",
  unidad: "dias",
  // Menos días es mejor mientras no se quiebre el stock. Sin un mínimo
  // declarado por producto EOS no puede saber dónde está ese límite, así que
  // no se alarma solo: `productos_bajo_minimo` es el que avisa del otro lado.
  direccion: "menos_es_mejor",
  necesita: ["productos", "movimientos_stock"],
  calcular(hechos, periodo: Periodo): ValorKPI[] {
    const movs = movimientosDe(hechos);
    const valores = valorInventario(productosDe(hechos));
    const dias = largoDelPeriodo(periodo);

    return valores.map((v) => {
      const rot = rotacion(
        costoDeLoVendido(movs, v.moneda, periodo.desde, periodo.hasta),
        inventarioPromedio(movs, v.moneda, periodo.desde, periodo.hasta, v.valor),
      );
      const d = diasDeInventario(rot, dias);

      return d === null
        ? valorDesconocido(v.moneda, "Necesita la rotación, que todavía no se puede calcular")
        : valorConocido(v.moneda, d);
    });
  },
};

/** La plata parada: mercadería con stock que no salió en todo el período. */
export const STOCK_QUIETO: DefinicionKPI = {
  id: "stock_quieto",
  nombre: "Plata parada en stock que no se mueve",
  familia: "inventario",
  unidad: "moneda",
  direccion: "menos_es_mejor",
  necesita: ["productos", "movimientos_stock"],
  calcular(hechos, periodo: Periodo): ValorKPI[] {
    const productos = productosDe(hechos);
    const movs = movimientosDe(hechos);
    const monedas = [...new Set(productos.filter((p) => p.activo && p.controla_stock).map((p) => p.moneda))];

    return monedas.sort().map((moneda) => {
      const quietos = stockQuieto(productos, movs, periodo.desde, periodo.hasta, moneda);
      const conValor = quietos.filter((q) => q.valor !== null);
      const sinValor = quietos.length - conValor.length;

      const total = conValor.reduce((s, q) => s + (q.valor as number), 0);

      // La confianza baja cuando hay productos quietos sin costo: el número
      // real es MAYOR que el que se muestra, y eso hay que decirlo.
      return sinValor === 0
        ? valorConocido(moneda, total)
        : {
            moneda,
            valor: total,
            confianza: {
              nivel: quietos.length === 0 ? 1 : conValor.length / quietos.length,
              motivos: [`${sinValor} de ${quietos.length} productos quietos no tienen costo cargado`],
            },
            falta: null,
          };
    });
  },
};

export const DEFINICIONES_INVENTARIO: DefinicionKPI[] = [
  ...DEFINICIONES_INVENTARIO_BASE,
  ROTACION_INVENTARIO,
  DIAS_DE_INVENTARIO,
  STOCK_QUIETO,
];
