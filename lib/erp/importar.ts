import { numero } from "../documentos/especificacion.ts";

/**
 * Traer un catálogo desde la planilla que la persona ya tiene.
 *
 * ============================================================
 * SIN ESTO EL ERP ES TEÓRICO
 * ============================================================
 *
 * Una despensa con 400 productos no los va a cargar uno por uno. Nunca. El ERP
 * queda impecable para quien empieza de cero e inservible para quien ya tiene
 * su catálogo en una planilla — que son todos.
 *
 * Es la diferencia entre "me interesa" y "ya tengo mis datos adentro" el mismo
 * día que lo compra.
 *
 * ============================================================
 * LA PLANILLA DE NADIE SE PARECE A LA NUESTRA
 * ============================================================
 *
 * Nadie tiene una columna llamada `precio_venta`. Tienen "PRECIO", "Precio de
 * venta", "P. VENTA", "pvp" o "Precio Gs.". Exigir nuestros nombres sería
 * pedirle a alguien que reescriba su planilla antes de poder usarla, que es
 * exactamente el trabajo que veníamos a ahorrarle.
 *
 * Por eso las columnas se reconocen por sinónimos, sin acentos y sin
 * puntuación. Lo que no se reconoce se INFORMA en vez de descartarse en
 * silencio: quien importa tiene que poder ver qué se entendió antes de que
 * nada toque su catálogo.
 */

export type CampoProducto = "nombre" | "codigo" | "precio" | "costo" | "stock" | "iva" | "unidad";

/*
 * Los sinónimos, en el orden en que se prueban.
 *
 * El primero de cada lista es el más específico a propósito: "precio de venta"
 * tiene que ganarle a "precio" cuando la planilla trae las dos columnas, porque
 * si no el costo entraría como precio de venta y todo el catálogo quedaría
 * vendiéndose a pérdida.
 */
const SINONIMOS: Record<CampoProducto, string[]> = {
  nombre: ["nombre del producto", "descripcion del producto", "producto", "descripcion", "detalle", "articulo", "item", "nombre"],
  codigo: ["codigo de barras", "codigo interno", "cod barra", "codigo", "cod", "sku", "referencia", "ref"],
  precio: ["precio de venta", "precio venta", "p venta", "precio publico", "pvp", "precio final", "precio gs", "precio", "venta"],
  costo: ["precio de costo", "costo unitario", "precio compra", "costo", "compra"],
  stock: ["stock actual", "existencia", "existencias", "cantidad", "stock", "saldo"],
  iva: ["iva", "impuesto", "tasa"],
  unidad: ["unidad de medida", "unidad", "medida", "um"],
};

/** Sin acentos, sin puntuación y sin espacios de más. */
export function normalizarEncabezado(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Qué columna de la planilla corresponde a cada campo.
 *
 * Devuelve el índice, o `null` si esa columna no está. Una columna sólo se usa
 * para UN campo: si "precio" ya se llevó la columna 3, el costo tiene que
 * buscar en otra.
 */
export function detectarColumnas(encabezados: unknown[]): Record<CampoProducto, number | null> {
  const limpios = encabezados.map(normalizarEncabezado);
  const usadas = new Set<number>();

  const mapa = {} as Record<CampoProducto, number | null>;

  /*
   * El orden importa: primero los campos cuyos sinónimos son más específicos.
   * `nombre` va último porque "descripcion" y "detalle" son tan genéricos que
   * se comerían columnas de otros campos si eligiera primero.
   */
  const orden: CampoProducto[] = ["codigo", "precio", "costo", "stock", "iva", "unidad", "nombre"];

  for (const campo of orden) {
    mapa[campo] = null;

    for (const sinonimo of SINONIMOS[campo]) {
      // Exacto primero: una columna que se llama justo así no deja lugar a dudas.
      let i = limpios.findIndex((h, idx) => !usadas.has(idx) && h === sinonimo);

      if (i < 0) {
        i = limpios.findIndex((h, idx) => !usadas.has(idx) && h.includes(sinonimo));
      }

      if (i >= 0) {
        mapa[campo] = i;
        usadas.add(i);
        break;
      }
    }
  }

  return mapa;
}

export type ProductoImportado = {
  fila: number;
  nombre: string;
  codigo: string | null;
  precio_venta: number;
  costo: number | null;
  stock_actual: number;
  iva: 0 | 5 | 10;
  unidad: string;
  controla_stock: boolean;
};

export type Problema = { fila: number; motivo: string };

/**
 * Convierte las filas en productos, y cuenta qué no pudo.
 *
 * Nunca tira una fila sin decirlo. Una importación que descarta en silencio
 * hace que alguien crea que cargó 400 productos y tenga 380 — y lo descubra
 * vendiendo.
 */
export function filasAProductos(
  encabezados: unknown[],
  filas: unknown[][],
): { productos: ProductoImportado[]; problemas: Problema[]; columnas: Record<CampoProducto, number | null> } {
  const columnas = detectarColumnas(encabezados);
  const productos: ProductoImportado[] = [];
  const problemas: Problema[] = [];

  if (columnas.nombre === null) {
    return {
      productos: [],
      problemas: [
        {
          fila: 1,
          motivo:
            "No encontramos una columna con el nombre del producto. Debería llamarse " +
            "Producto, Nombre, Descripción o Artículo.",
        },
      ],
      columnas,
    };
  }

  const leer = (fila: unknown[], campo: CampoProducto) => {
    const i = columnas[campo];
    return i === null ? null : fila[i];
  };

  filas.forEach((fila, indice) => {
    // +2: la primera fila son los encabezados y las planillas cuentan desde 1.
    const numeroFila = indice + 2;

    const nombre = String(leer(fila, "nombre") ?? "").trim().slice(0, 200);

    // Una fila sin nombre casi siempre es una fila vacía del final de la
    // planilla, no un error del usuario. No se cuenta como problema.
    if (!nombre) return;

    const precio = numero(leer(fila, "precio"));

    if (precio === null) {
      problemas.push({ fila: numeroFila, motivo: `"${nombre}" no tiene un precio que se entienda.` });
      return;
    }

    if (precio < 0) {
      problemas.push({ fila: numeroFila, motivo: `"${nombre}" tiene un precio negativo.` });
      return;
    }

    const stock = numero(leer(fila, "stock"));
    const costo = numero(leer(fila, "costo"));
    const ivaCrudo = numero(leer(fila, "iva"));

    /*
     * El IVA se toma sólo si es una de las tres tasas paraguayas. Cualquier otra
     * cosa —un 21 copiado de una planilla argentina, un 0.1 escrito como
     * fracción— se trata como 10, que es la tasa general, y no se inventa una
     * tasa que no existe en Paraguay.
     */
    const iva: 0 | 5 | 10 = ivaCrudo === 0 || ivaCrudo === 5 || ivaCrudo === 10 ? ivaCrudo : 10;

    productos.push({
      fila: numeroFila,
      nombre,
      codigo: String(leer(fila, "codigo") ?? "").trim().slice(0, 60) || null,
      precio_venta: Math.round(precio),
      costo: costo === null || costo < 0 ? null : Math.round(costo),
      stock_actual: stock === null || stock < 0 ? 0 : stock,
      iva,
      unidad: String(leer(fila, "unidad") ?? "").trim().slice(0, 20) || "unidad",

      /*
       * Sólo lleva stock quien trajo una columna de stock.
       *
       * Prenderlo para todos dejaría a un negocio de servicios con inventario
       * en cero y avisos de "bajo mínimo" sobre cosas que no son mercadería.
       */
      controla_stock: columnas.stock !== null,
    });
  });

  return { productos, problemas, columnas };
}

/** Nombres repetidos dentro de la misma planilla, que casi siempre son un error. */
export function repetidos(productos: ProductoImportado[]): string[] {
  const vistos = new Map<string, number>();

  for (const p of productos) {
    const clave = p.nombre.toLowerCase();
    vistos.set(clave, (vistos.get(clave) ?? 0) + 1);
  }

  return [...vistos.entries()].filter(([, n]) => n > 1).map(([nombre]) => nombre);
}
