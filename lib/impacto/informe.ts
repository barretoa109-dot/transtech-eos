import { formatearMonto } from "../finanzas/formato.ts";
import { envolverEmailDeMarca, escaparHtml, primerNombre } from "../email/marca.ts";

/**
 * El Informe de impacto: lo que EOS hizo por una cuenta en un mes, con sus
 * números (fila R1 de docs/estrategia/hoja-de-ruta-impacto-2026-09-27.md).
 *
 * Todos los productos dicen que ahorran tiempo y plata. Este informe es la
 * prueba, cuenta por cuenta, y por eso tiene tres reglas que no se negocian:
 *
 *  - NINGÚN NÚMERO SE INVENTA. Cada línea sale de filas de la base que se
 *    pueden señalar. Si un dato no existe, la línea no aparece: un informe
 *    más corto es mejor que uno inflado, porque el día que el cliente
 *    descubre un número falso deja de creerle a todos los demás.
 *  - EL ÚNICO SUPUESTO ESTÁ A LA VISTA. Las horas ahorradas se estiman con
 *    `MINUTOS_POR_REGISTRO`, y el propio correo dice cuántos minutos se
 *    contaron. Es deliberadamente bajo (fila R2).
 *  - NO SE ATRIBUYE DE MÁS. "Cobraste Gs. X de ventas que te debían" es un
 *    hecho; "EOS te hizo cobrar Gs. X" sería una atribución que todavía no se
 *    puede medir. Se escribe el hecho.
 *
 * Todo lo de este archivo es puro. La lectura de la base y el envío viven en
 * `enviar.ts`.
 */

/** Minutos que se cuentan como ahorrados por cada cosa que EOS anotó (R2). */
export const MINUTOS_POR_REGISTRO = 2;

/**
 * Acciones que NO cuentan como "cosa anotada".
 *
 *  - RESPONDER: contestar no dejó nada registrado.
 *  - GUARDAR_MEMORIA: una nota de texto. Es justo el verbo que tapó durante
 *    semanas a los que faltaban (ver la memoria del proyecto "el verbo que
 *    falta"); contarlo como trabajo hecho premiaría ese error.
 *  - GENERAR_*: son documentos, y van en su propia línea.
 */
const NO_ANOTA = new Set(["RESPONDER", "GUARDAR_MEMORIA"]);

type Grupo = { singular: string; plural: string };

const GRUPOS: Record<string, Grupo> = {
  ventas: { singular: "venta", plural: "ventas" },
  compras: { singular: "compra o gasto", plural: "compras y gastos" },
  productos: { singular: "cambio de productos o stock", plural: "cambios de productos y stock" },
  cobros: { singular: "cobro o pago", plural: "cobros y pagos" },
  clientes: { singular: "cliente u oportunidad", plural: "clientes y oportunidades" },
  tareas: { singular: "tarea", plural: "tareas" },
  personal: { singular: "movimiento personal", plural: "movimientos personales" },
  otras: { singular: "corrección u otra cosa", plural: "correcciones y otras cosas" },
};

const GRUPO_DE: Record<string, keyof typeof GRUPOS> = {
  REGISTRAR_VENTA: "ventas",
  REGISTRAR_COMPRA: "compras",
  REGISTRAR_GASTO_FIJO: "compras",
  REGISTRAR_COMPRA_TARJETA: "compras",
  CREAR_PRODUCTO: "productos",
  ACTUALIZAR_PRODUCTO: "productos",
  AJUSTAR_STOCK: "productos",
  REGISTRAR_COBRO: "cobros",
  REGISTRAR_PAGO_COMPRA: "cobros",
  REGISTRAR_PAGO_DEUDA: "cobros",
  CREAR_CONTACTO: "clientes",
  REGISTRAR_OPORTUNIDAD: "clientes",
  CREAR_TAREA: "tareas",
  REGISTRAR_MOVIMIENTO_PERSONAL: "personal",
  DECLARAR_SALDO: "personal",
  REGISTRAR_DEUDA: "personal",
  REGISTRAR_TARJETA: "personal",
  REGISTRAR_TRANSFERENCIA: "personal",
  CREAR_OBJETIVO: "personal",
};

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "setiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export type Periodo = {
  /** YYYY-MM: la clave del informe. */
  clave: string;
  /** Primer día del mes, YYYY-MM-DD. */
  desde: string;
  /** Último día del mes, YYYY-MM-DD. */
  hasta: string;
  /** "setiembre", como se dice en Paraguay. */
  nombreMes: string;
};

/** El mes calendario anterior al de `hoy` (YYYY-MM-DD). */
export function mesAnterior(hoy: string): Periodo {
  const [anio, mes] = hoy.split("-").map(Number);
  const a = mes === 1 ? anio - 1 : anio;
  const m = mes === 1 ? 12 : mes - 1;
  const mm = String(m).padStart(2, "0");
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();

  return {
    clave: `${a}-${mm}`,
    desde: `${a}-${mm}-01`,
    hasta: `${a}-${mm}-${String(ultimo).padStart(2, "0")}`,
    nombreMes: MESES[m - 1],
  };
}

/** Lo que se lee de la base para una cuenta y un mes. Montos en guaraníes. */
export type HechosDelMes = {
  /** El nombre de la acción de cada comando completado en el mes. */
  acciones: string[];
  /** Ventas vivas (emitidas o cobradas) con fecha dentro del mes, en PYG. */
  ventas: { total: number }[];
  /** Ventas a crédito cuyo cobro se registró dentro del mes, en PYG. */
  cobrosDeCredito: { total: number }[];
  /** Ventas a crédito todavía sin cobrar al momento del informe, en PYG. */
  porCobrar: { total: number; contacto_id: string | null }[];
  /**
   * Los avisos que llegaron en el mes, por tipo (eos_avisos_historial_v217).
   * Opcional: un informe sin la historia de avisos sigue siendo un informe.
   */
  avisos?: { tipo: string }[];
};

export type Impacto = {
  periodo: string;
  anotadas: number;
  /** Cantidad por grupo, de mayor a menor. Solo los grupos con algo. */
  porGrupo: { grupo: string; cantidad: number }[];
  documentos: number;
  minutosAhorrados: number;
  ventas: { cantidad: number; total: number };
  cobrado: { cantidad: number; total: number };
  porCobrar: { clientes: number; total: number };
  /** Avisos que llegaron antes de que el problema pasara, por tema. */
  avisos: { total: number; porTema: { tema: string; cantidad: number }[] };
};

/** De qué fue cada aviso, en palabras del dueño. Los de un mismo tema se juntan. */
const TEMA_DEL_AVISO: Record<string, string> = {
  inventario_bajo: "stock",
  stock_por_agotarse: "stock",
  pagos_a_proveedores: "pagos a proveedores",
  cobros_demorados: "cobros atrasados",
  gasto_anormal: "gastos fuera de lo normal",
  faltante: "plata que iba a faltar",
  seguimientos_crm: "clientes para seguir",
};

function sumar(filas: { total: number }[]): number {
  return filas.reduce((s, f) => s + (Number.isFinite(f.total) ? f.total : 0), 0);
}

export function calcularImpacto(periodo: string, hechos: HechosDelMes): Impacto {
  let anotadas = 0;
  let documentos = 0;
  const conteo = new Map<string, number>();

  for (const accion of hechos.acciones) {
    if (NO_ANOTA.has(accion)) continue;
    if (accion.startsWith("GENERAR_")) {
      documentos += 1;
      continue;
    }
    anotadas += 1;
    const grupo = GRUPO_DE[accion] ?? "otras";
    conteo.set(grupo, (conteo.get(grupo) ?? 0) + 1);
  }

  const porGrupo = [...conteo.entries()]
    .map(([grupo, cantidad]) => ({ grupo, cantidad }))
    // "otras" siempre al final: nunca es lo que más le importa a nadie.
    .sort((a, b) => (a.grupo === "otras" ? 1 : b.grupo === "otras" ? -1 : b.cantidad - a.cantidad));

  // Un cliente sin contacto cargado cuenta como uno más: son ventas a alguien.
  const clientes = new Set(hechos.porCobrar.map((v, i) => v.contacto_id ?? `sin-contacto-${i}`));

  return {
    periodo,
    anotadas,
    porGrupo,
    documentos,
    minutosAhorrados: anotadas * MINUTOS_POR_REGISTRO,
    ventas: { cantidad: hechos.ventas.length, total: sumar(hechos.ventas) },
    cobrado: { cantidad: hechos.cobrosDeCredito.length, total: sumar(hechos.cobrosDeCredito) },
    porCobrar: { clientes: hechos.porCobrar.length > 0 ? clientes.size : 0, total: sumar(hechos.porCobrar) },
    avisos: contarAvisos(hechos.avisos ?? []),
  };
}

function contarAvisos(avisos: { tipo: string }[]): Impacto["avisos"] {
  const porTema = new Map<string, number>();
  for (const a of avisos) {
    const tema = TEMA_DEL_AVISO[a.tipo] ?? "tu negocio";
    porTema.set(tema, (porTema.get(tema) ?? 0) + 1);
  }
  return {
    total: avisos.length,
    porTema: [...porTema.entries()].map(([tema, cantidad]) => ({ tema, cantidad })).sort((a, b) => b.cantidad - a.cantidad),
  };
}

/**
 * Cuántas cosas anotadas hacen falta para que el informe valga un correo.
 *
 * Medido contra producción el 27/09/2026: con setiembre, 4 de 6 cuentas
 * activas habrían recibido "Anoté 2 cosas por vos… unos 4 minutos". Eso no
 * demuestra impacto: invita a pensar "¿eso es todo?", y es justo el mensaje
 * por mandar que la doctrina de EOS prohíbe. Por debajo de esto, silencio.
 */
export const MINIMO_DE_COSAS = 10;

/** Hay impacto que valga un correo: sin esto no se manda nada. */
export function tieneAlgoQueContar(i: Impacto): boolean {
  return i.anotadas >= MINIMO_DE_COSAS || i.cobrado.cantidad > 0;
}

/** "unas 7 horas" o "unos 40 minutos". Redondea para ABAJO: nunca de más. */
export function tiempoEnPalabras(minutos: number): string {
  if (minutos < 60) return `unos ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  return horas === 1 ? "más de una hora" : `unas ${horas} horas`;
}

function cantidadDe(n: number, g: Grupo): string {
  return `${n} ${n === 1 ? g.singular : g.plural}`;
}

const gs = (n: number) => formatearMonto(n, "PYG");

/** Las líneas del informe, en el orden en que se leen. Solo las que tienen dato. */
export function lineasDelInforme(i: Impacto): string[] {
  const lineas: string[] = [];

  if (i.anotadas > 0) {
    const detalle = i.porGrupo
      .slice(0, 3)
      .map((g) => cantidadDe(g.cantidad, GRUPOS[g.grupo] ?? GRUPOS.otras))
      .join(", ");
    const cosas = i.anotadas === 1 ? "1 cosa" : `${i.anotadas} cosas`;
    lineas.push(`Anoté ${cosas} por vos: ${detalle}.`);
    lineas.push(
      `Eso es ${tiempoEnPalabras(i.minutosAhorrados)} que no pasaste anotando (contamos ${MINUTOS_POR_REGISTRO} minutos por cada cosa).`,
    );
  }

  if (i.ventas.cantidad > 0) {
    const ventas = i.ventas.cantidad === 1 ? "1 venta" : `${i.ventas.cantidad} ventas`;
    lineas.push(`Quedaron registradas ${ventas} por ${gs(i.ventas.total)}.`);
  }

  if (i.cobrado.cantidad > 0) {
    lineas.push(`Cobraste ${gs(i.cobrado.total)} de ventas que te debían.`);
  }

  if (i.porCobrar.total > 0) {
    const quienes = i.porCobrar.clientes === 1 ? "1 cliente" : `${i.porCobrar.clientes} clientes`;
    lineas.push(
      `Hoy te deben ${gs(i.porCobrar.total)} entre ${quienes}. Preguntame "¿quién me debe?" y te paso la lista.`,
    );
  }

  /*
   * negocio-02: lo que EOS vio venir. Solo avisos que LLEGARON (no los que
   * quedaron fuera del tope ni los que no tuvieron canal).
   */
  if (i.avisos.total > 0) {
    const veces = i.avisos.total === 1 ? "1 vez" : `${i.avisos.total} veces`;
    const temas = i.avisos.porTema.map((t) => (t.cantidad === 1 ? t.tema : `${t.tema} (${t.cantidad})`)).join(", ");
    lineas.push(`Te avisé ${veces} de algo antes de que pasara: ${temas}.`);
  }

  if (i.documentos > 0) {
    const docs = i.documentos === 1 ? "1 documento" : `${i.documentos} documentos`;
    lineas.push(`Te armé ${docs} (Excel, PDF o Word).`);
  }

  return lineas;
}

export function redactarInforme(params: {
  impacto: Impacto;
  nombreMes: string;
  nombre: string | null | undefined;
  appUrl: string;
  urlBaja: string;
}): { asunto: string; html: string; texto: string } {
  const { impacto, nombreMes, appUrl, urlBaja } = params;
  const nombre = primerNombre(params.nombre);
  const saludo = nombre ? `Hola ${nombre},` : "Hola,";
  const intro = `Esto es lo que hicimos juntos en ${nombreMes}, con tus números:`;
  const lineas = lineasDelInforme(impacto);
  const cierre = "Todo sale de lo que me contaste. Si algo no te cierra, decímelo y lo reviso.";
  const urlChat = `${appUrl}/eos/chat`;

  const asunto = `Lo que EOS hizo por vos en ${nombreMes}`;

  const html = envolverEmailDeMarca({
    eyebrow: "TU MES CON EOS",
    titulo: `Tu ${nombreMes} con EOS`,
    // Cada línea es un párrafo con viñeta y no un <ul>: el envoltorio mete
    // cada párrafo en un <p>, y una lista dentro de un <p> es HTML inválido
    // que algunos clientes de correo desarman.
    parrafos: [saludo, intro, ...lineas.map((l) => `• ${l}`), cierre].map(escaparHtml),
    ctaTexto: "Hablar con EOS",
    ctaUrl: urlChat,
    pieHtml: `<p style="margin:24px 0 0;color:#94a3b8;line-height:1.6;font-size:12px;">Te mandamos este resumen una vez por mes porque usaste EOS en ${escaparHtml(nombreMes)}. Si no lo querés recibir, <a href="${urlBaja}" style="color:#94a3b8;">darte de baja</a> lleva un clic.</p>`,
  });

  const texto = [
    saludo,
    "",
    intro,
    "",
    ...lineas.map((l) => `- ${l}`),
    "",
    cierre,
    "",
    `Hablar con EOS: ${urlChat}`,
    "",
    `Si no querés recibir este resumen, date de baja acá: ${urlBaja}`,
  ].join("\n");

  return { asunto, html, texto };
}
