import { formatearMonto } from "../finanzas/formato.ts";

/**
 * Cómo va el negocio, contado en dos párrafos.
 *
 * ============================================================
 * POR QUÉ TEXTO Y NO JSON
 * ============================================================
 *
 * Esto va dentro de un prompt. Un JSON con llaves y comillas gasta el doble de
 * tokens que la misma información escrita, y obliga al modelo a interpretar una
 * estructura antes de entender un número. Escrito en castellano se lee igual
 * que el resto del prompt y cuesta la mitad.
 *
 * Además obliga a decidir acá el formato de cada monto. Si se mandara el número
 * pelado, el modelo elegiría cómo mostrarlo y escribiría "Gs. 1,250,000" o
 * "1.25M" según el día. Formateado una sola vez, sale siempre igual y sale como
 * se escriben los montos en Paraguay.
 */

export type ContextoNegocio = {
  mes?: string;
  finanzas?: Array<{
    moneda: string;
    ingresos_mes: number;
    gastos_mes: number;
    neto_mes: number;
  }>;
  /*
   * La plata de la PERSONA, separada de la del negocio desde la v137.
   *
   * Misma forma que `finanzas` a propósito: es la misma pregunta hecha sobre
   * el otro ámbito, y dos formas distintas para lo mismo obligarían a mirar
   * cuál es cuál cada vez que se toca esto.
   */
  personal?: Array<{
    moneda: string;
    ingresos_mes: number;
    gastos_mes: number;
    neto_mes: number;
  }>;
  /*
   * La posición de la persona, desde la v158/v159.
   *
   * Es lo que contesta "cuánto tengo", "cuándo vence", "cuánto debo" y "cuánto
   * me falta" — las cuatro preguntas más frecuentes que recibe un asistente de
   * finanzas, y las cuatro que EOS no podía contestar sobre datos que él mismo
   * había escrito. Ver `textoPosicion` más abajo.
   *
   * Todo opcional: quien no cargó nada no tiene bloque, y el modelo no lee
   * ceros que leería como hechos.
   */
  posicion?: {
    cuentas?: Array<{ nombre: string; moneda?: string; saldo?: number | null; al?: string | null }>;
    tarjetas?: Array<{
      nombre: string;
      moneda?: string;
      cierra?: number | null;
      vence?: number | null;
      resumen?: number | null;
      minimo?: number | null;
      resumen_al?: string | null;
    }>;
    deudas?: Array<{
      acreedor: string;
      moneda?: string;
      saldo?: number | null;
      cuota?: number | null;
      dia?: number | null;
    }>;
    objetivos?: Array<{
      titulo: string;
      ambito?: string;
      moneda?: string;
      objetivo?: number | null;
      actual?: number | null;
      para?: string | null;
    }>;
  };
  erp?: {
    ventas_mes?: { cantidad: number; por_moneda?: MontoPorMoneda[] };
    /*
     * `por_cobrar_monedas` y no `por_cobrar` a propósito.
     *
     * La v94 deja las claves viejas donde estaban —con sus totales mezclados—
     * para que el código todavía desplegado siga funcionando mientras el nuevo
     * sale. `por_cobrar` no puede ser un número y una lista al mismo tiempo,
     * así que la lista se llama distinto. Cuando el código viejo ya no exista,
     * una migración corta borra las viejas y estas recuperan el nombre bueno.
     */
    por_cobrar_monedas?: MontoPorMoneda[];
    por_pagar_monedas?: MontoPorMoneda[];
    bajo_minimo?: Array<{ nombre: string; stock: number }>;
    mas_vendidos?: string[];
    /*
     * El catálogo, que hasta la v158 el modelo no veía.
     *
     * El prompt le pide que no adivine nombres y que pregunte cuál es cuando
     * hay varios parecidos. Sin esta lista, esa regla le pedía razonar sobre
     * algo que nunca había visto: escribía un nombre parecido pero no el
     * guardado —y la venta moría al resolverlo— o preguntaba cuál de todos
     * cuando había uno solo.
     */
    catalogo?: Array<{ nombre: string; precio?: number; sin_costo?: boolean }>;
    /** Cuántos hay en total. La lista viene recortada a 40; ver la v158. */
    catalogo_total?: number;
  };
  crm?: {
    oportunidades_abiertas?: { cantidad: number; por_moneda?: MontoPorMoneda[] };
    ganadas_mes?: number;
    actividades_pendientes?: number;
  };
};

/**
 * Toda cifra de plata del contexto viene así: una fila por moneda.
 *
 * Antes eran números sueltos que la base sumaba entre monedas y esto imprimía
 * con "PYG" escrito a mano. El resultado era que EOS le contestaba al usuario
 * una cifra que no existe en ninguna moneda — y con la seguridad de una
 * respuesta, que es lo que la vuelve peligrosa. Ver la migración v94.
 */
export type MontoPorMoneda = { moneda: string; total?: number; monto?: number };

/**
 * El resultado de una RPC cruza una frontera sin garantías de runtime: durante
 * un despliegue puede convivir código nuevo con la forma anterior del JSON.
 * Un valor escalar legado no debe derribar todo el chat por intentar mapearlo.
 */
function lista<T>(valor: unknown): T[] {
  return Array.isArray(valor) ? (valor as T[]) : [];
}

/** "Gs. 1.250.000" o, con dos monedas, "Gs. 1.250.000 y USD 300". */
function montos(filas: unknown): string | null {
  const conPlata = lista<MontoPorMoneda>(filas)
    .map((f) => ({ moneda: f.moneda, valor: Number(f.total ?? f.monto ?? 0) }))
    .filter((f) => f.valor > 0);

  if (conPlata.length === 0) return null;

  return conPlata.map((f) => formatearMonto(f.valor, f.moneda)).join(" y ");
}

/**
 * El catálogo, escrito para que el modelo use el nombre EXACTO.
 *
 * ============================================================
 * POR QUÉ EL NOMBRE VA COMPLETO Y SIN ABREVIAR
 * ============================================================
 *
 * Todo lo que el modelo escriba distinto lo tiene que adivinar el resolver
 * del otro lado, y adivinar es de donde salen las ventas perdidas. Con la
 * lista adelante puede copiar el nombre tal cual está guardado y la
 * resolución deja de ser una apuesta.
 *
 * ============================================================
 * "SIN COSTO" NO ES UN DETALLE
 * ============================================================
 *
 * Es la diferencia entre que EOS calcule un margen que no puede calcular y
 * que pida el costo una vez. Marcarlo acá cuesta cuatro caracteres por
 * producto y evita la respuesta más molesta que puede dar un asistente: un
 * número inventado con cara de exacto.
 *
 * ============================================================
 * Y SE DICE CUÁNTOS QUEDARON AFUERA
 * ============================================================
 *
 * La lista viene recortada a 40. Un modelo que cree estar viendo el catálogo
 * entero cuando ve la mitad afirma que un producto no existe — y eso es peor
 * que no haberle mostrado nada.
 */
export type ProductoDelCatalogo = { nombre: string; precio?: number; sin_costo?: boolean };

export function textoCatalogo(catalogo: unknown, total?: number): string {
  const items = lista<ProductoDelCatalogo>(catalogo).filter(
    (p) => typeof p?.nombre === "string" && p.nombre.trim() !== "",
  );
  if (items.length === 0) return "";

  const lineas = items.map((p) => {
    const precio = Number(p.precio ?? 0);
    const detalle = precio > 0 ? ` — ${formatearMonto(precio, "PYG")}` : "";
    // "sin costo" y no "costo: null": el modelo lee castellano, no esquemas.
    return `  ${p.nombre}${detalle}${p.sin_costo ? " (sin costo cargado)" : ""}`;
  });

  const faltan = Number(total ?? 0) - items.length;

  const pie =
    faltan > 0
      ? `\n  …y ${faltan} más que no entran acá: si te nombran uno que no está en esta lista, puede existir igual.`
      : "";

  return (
    "Su catálogo (usá estos nombres EXACTOS al registrar una venta o una compra):\n" +
    lineas.join("\n") +
    pie
  );
}

/*
 * Cuando no hay nada cargado se devuelve cadena vacía y el prompt no lleva
 * sección de negocio.
 *
 * Un bloque que dice "ventas del mes: Gs. 0, por cobrar: Gs. 0" es peor que no
 * mandar nada: el modelo lo lee como un hecho y arranca a hablar de un negocio
 * parado cuando en realidad la persona todavía no cargó nada.
 */
export function textoContexto(contexto: ContextoNegocio | null | undefined): string {
  if (!contexto) return "";

  const partes: string[] = [];

  const finanzas = lista<NonNullable<ContextoNegocio["finanzas"]>[number]>(
    contexto.finanzas,
  ).filter(
    (f) => f.ingresos_mes > 0 || f.gastos_mes > 0,
  );

  if (finanzas.length > 0) {
    // Cada moneda en su renglón, sin sumar entre monedas: un total que mezcla
    // guaraníes con dólares a una cotización inventada se ve preciso y está mal.
    const lineas = finanzas.map(
      (f) =>
        `  ${f.moneda}: entró ${formatearMonto(f.ingresos_mes, f.moneda)}, ` +
        `salió ${formatearMonto(f.gastos_mes, f.moneda)}, ` +
        `queda ${formatearMonto(f.neto_mes, f.moneda)}`,
    );

    partes.push(`Movimientos del mes (NEGOCIO):\n${lineas.join("\n")}`);
  }

  /*
   * Y lo personal, con su rótulo.
   *
   * Los dos bloques tienen la misma forma y dicen cosas incompatibles, así que
   * el rótulo no es decorativo: sin él, el modelo lee dos listas de números
   * parecidos y contesta sobre la que encuentra primero. Con "NEGOCIO" y "VOS"
   * escritos, puede contestar "en tu negocio entraron X, y a vos te entraron
   * Y", que es la respuesta correcta a la mitad de las preguntas que le hacen.
   */
  const personal = lista<NonNullable<ContextoNegocio["personal"]>[number]>(
    contexto.personal,
  ).filter((f) => f.ingresos_mes > 0 || f.gastos_mes > 0);

  if (personal.length > 0) {
    const lineas = personal.map(
      (f) =>
        `  ${f.moneda}: entró ${formatearMonto(f.ingresos_mes, f.moneda)}, ` +
        `salió ${formatearMonto(f.gastos_mes, f.moneda)}, ` +
        `queda ${formatearMonto(f.neto_mes, f.moneda)}`,
    );

    partes.push(`Movimientos del mes (VOS, personal):\n${lineas.join("\n")}`);
  }

  const erp = contexto.erp;

  if (erp) {
    const linea: string[] = [];

    if (erp.ventas_mes && erp.ventas_mes.cantidad > 0) {
      const vendido = montos(erp.ventas_mes.por_moneda);
      const cuantas = `${erp.ventas_mes.cantidad} ${erp.ventas_mes.cantidad === 1 ? "venta" : "ventas"}`;

      linea.push(vendido ? `${cuantas} por ${vendido}` : cuantas);
    }

    const porCobrar = montos(erp.por_cobrar_monedas);
    if (porCobrar) linea.push(`le deben ${porCobrar}`);

    const porPagar = montos(erp.por_pagar_monedas);
    if (porPagar) linea.push(`debe ${porPagar}`);

    if (linea.length > 0) partes.push(`Negocio este mes: ${linea.join("; ")}.`);

    const masVendidos = lista<string>(erp.mas_vendidos);
    if (masVendidos.length > 0) {
      partes.push(`Lo que más sale: ${masVendidos.join(", ")}.`);
    }

    const bajoMinimo = lista<NonNullable<NonNullable<ContextoNegocio["erp"]>["bajo_minimo"]>[number]>(
      erp.bajo_minimo,
    );
    if (bajoMinimo.length > 0) {
      const items = bajoMinimo.map((p) => `${p.nombre} (${p.stock})`);
      partes.push(`Por faltar: ${items.join(", ")}.`);
    }

    // Vacío cuando no hay catálogo: un renglón en blanco en el prompt no
    // dice nada y se paga igual.
    const catalogo = textoCatalogo(erp.catalogo, erp.catalogo_total);
    if (catalogo) partes.push(catalogo);
  }

  const crm = contexto.crm;

  if (crm) {
    const linea: string[] = [];

    if (crm.oportunidades_abiertas && crm.oportunidades_abiertas.cantidad > 0) {
      const enJuego = montos(crm.oportunidades_abiertas.por_moneda);
      const cuantas = `${crm.oportunidades_abiertas.cantidad} abiertas`;

      linea.push(enJuego ? `${cuantas} por ${enJuego}` : cuantas);
    }

    if (crm.ganadas_mes && crm.ganadas_mes > 0) {
      linea.push(`${crm.ganadas_mes} ganadas este mes`);
    }

    if (crm.actividades_pendientes && crm.actividades_pendientes > 0) {
      // "Para hoy o antes" y no "pendientes": lo de la semana que viene no
      // amerita que el asistente lo mencione sin que se lo pregunten.
      linea.push(
        `${crm.actividades_pendientes} ${
          crm.actividades_pendientes === 1 ? "tarea" : "tareas"
        } de seguimiento para hoy o antes`,
      );
    }

    if (linea.length > 0) partes.push(`Oportunidades: ${linea.join("; ")}.`);
  }

  const posicion = textoPosicion(contexto.posicion);
  if (posicion) partes.push(posicion);

  return partes.join("\n");
}

/** `2026-09-10` a `10/09`. En una lista de ocho, el año no aporta. */
function diaMes(iso: string | null | undefined): string {
  if (typeof iso !== "string" || iso.length < 10) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * Lo que la persona tiene, debe y quiere.
 *
 * ============================================================
 * EL AGUJERO QUE ESTO TAPA
 * ============================================================
 *
 * Hasta el 10 de septiembre de 2026 el modelo recibía el catálogo, las ventas,
 * la cartera y los totales del mes —de los dos ámbitos— y NADA de la posición
 * de la persona. Reproducido contra producción, dos mensajes seguidos:
 *
 *   > tengo 3 millones en Ueno y mi tarjeta vence el 5
 *   Anoté ₲ 3.000.000 en Ueno. Cuenta nueva. Cargué Visa.
 *
 *   > ¿cuánta plata tengo y cuándo vence mi tarjeta?
 *   Voy a consultar tus saldos…
 *
 * Y no consultaba nada, porque no había nada que consultar. EOS acababa de
 * escribir ese dato y en el mensaje siguiente ya no lo sabía.
 *
 * ============================================================
 * EL TOTAL SE CALCULA ACÁ, POR MONEDA
 * ============================================================
 *
 * Si fueran solo los renglones sueltos, el modelo sumaría — y sumaría también
 * los dólares con los guaraníes, que es el error más caro que puede cometer
 * con estos datos. El total por moneda va escrito, y no hay ninguno que los
 * cruce.
 *
 * ============================================================
 * CADA SALDO CON SU FECHA
 * ============================================================
 *
 * Un saldo declarado hace tres semanas no es el de hoy. Sin la fecha al lado,
 * el modelo no tiene forma de saberlo y lo va a presentar como el saldo
 * actual. Es la misma regla que ya sostiene la pantalla.
 */
export function textoPosicion(posicion: ContextoNegocio["posicion"]): string {
  if (!posicion) return "";

  const partes: string[] = [];

  const cuentas = lista<NonNullable<NonNullable<ContextoNegocio["posicion"]>["cuentas"]>[number]>(
    posicion.cuentas,
  ).filter((c) => typeof c.saldo === "number");

  if (cuentas.length > 0) {
    const monedas = [...new Set(cuentas.map((c) => c.moneda || "PYG"))];

    const lineas = monedas.map((moneda) => {
      const suyas = cuentas.filter((c) => (c.moneda || "PYG") === moneda);
      const total = suyas.reduce((a, c) => a + (c.saldo ?? 0), 0);
      const detalle = suyas
        .map((c) => {
          const cuando = diaMes(c.al);
          return `${c.nombre} ${formatearMonto(c.saldo ?? 0, moneda)}${cuando ? ` (${cuando})` : ""}`;
        })
        .join(", ");

      return suyas.length === 1
        ? `  ${detalle}`
        : `  ${formatearMonto(total, moneda)} en total: ${detalle}`;
    });

    partes.push(`Lo que tenés (VOS, según lo que declaraste):\n${lineas.join("\n")}`);
  }

  const tarjetas = lista<NonNullable<NonNullable<ContextoNegocio["posicion"]>["tarjetas"]>[number]>(
    posicion.tarjetas,
  );

  if (tarjetas.length > 0) {
    const lineas = tarjetas.map((t) => {
      const datos: string[] = [];
      if (t.vence) datos.push(`vence el ${t.vence}`);
      if (t.cierra) datos.push(`cierra el ${t.cierra}`);

      if (typeof t.resumen === "number") {
        const cuando = diaMes(t.resumen_al);
        datos.push(
          `resumen ${formatearMonto(t.resumen, t.moneda || "PYG")}${cuando ? ` del ${cuando}` : ""}`,
        );
      }

      if (typeof t.minimo === "number") {
        datos.push(`mínimo ${formatearMonto(t.minimo, t.moneda || "PYG")}`);
      }

      // Sin nada cargado se nombra igual: que la tarjeta EXISTA ya es el dato
      // que evita que el modelo diga que no tiene ninguna.
      return `  ${t.nombre}${datos.length > 0 ? ` — ${datos.join(", ")}` : ""}`;
    });

    partes.push(`Sus tarjetas:\n${lineas.join("\n")}`);
  }

  const deudas = lista<NonNullable<NonNullable<ContextoNegocio["posicion"]>["deudas"]>[number]>(
    posicion.deudas,
  ).filter((d) => typeof d.saldo === "number" && d.saldo > 0);

  if (deudas.length > 0) {
    const lineas = deudas.map((d) => {
      const moneda = d.moneda || "PYG";
      const cuota =
        typeof d.cuota === "number"
          ? `, cuota ${formatearMonto(d.cuota, moneda)}${d.dia ? ` el ${d.dia}` : ""}`
          : "";
      return `  ${d.acreedor}: ${formatearMonto(d.saldo ?? 0, moneda)}${cuota}`;
    });

    partes.push(`Lo que debe (VOS, personal):\n${lineas.join("\n")}`);
  }

  const objetivos = lista<
    NonNullable<NonNullable<ContextoNegocio["posicion"]>["objetivos"]>[number]
  >(posicion.objetivos);

  if (objetivos.length > 0) {
    const lineas = objetivos.map((o) => {
      const moneda = o.moneda || "PYG";
      const meta =
        typeof o.objetivo === "number" && o.objetivo > 0
          ? `: ${formatearMonto(o.objetivo, moneda)}`
          : "";
      const lleva =
        typeof o.actual === "number" && o.actual > 0
          ? ` (lleva ${formatearMonto(o.actual, moneda)})`
          : "";
      const cuando = o.para ? ` para el ${diaMes(o.para)}` : "";
      const donde = o.ambito === "negocio" ? " [negocio]" : "";

      return `  ${o.titulo}${meta}${cuando}${lleva}${donde}`;
    });

    partes.push(`Lo que quiere lograr:\n${lineas.join("\n")}`);
  }

  return partes.join("\n");
}
