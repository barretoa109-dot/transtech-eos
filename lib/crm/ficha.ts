/**
 * La ficha de un cliente: lo que se le puede cargar, y su historia.
 *
 * Todo puro: recibe filas y devuelve filas. Lo que lee de la base vive en la ruta.
 */

// --------------------------------------------------------------- los campos nuevos

export const ESTADOS_RELACION = ["prospecto", "activo", "inactivo"] as const;
export type EstadoRelacion = (typeof ESTADOS_RELACION)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Son campos de la v185: si la base todavía no los tiene, hay que poder decirlo. */
export const CAMPOS_FICHA = ["empresa", "estado_relacion", "proxima_interaccion_en", "responsable_id"] as const;

function fechaValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

/**
 * Lee los campos de la ficha que vinieron en el cuerpo. Solo devuelve los que vinieron:
 * rellenar lo ausente borraría datos intactos.
 *
 * `null` o texto vacío BORRA el campo (menos el estado, que siempre tiene un valor).
 * El responsable se valida acá solo en su forma; que sea de la empresa lo decide la ruta.
 */
export function leerCamposFicha(cuerpo: Record<string, unknown>): { cambios: Record<string, unknown>; error: string | null } {
  const cambios: Record<string, unknown> = {};

  if (cuerpo.empresa !== undefined) {
    const texto = String(cuerpo.empresa ?? "").trim().slice(0, 160);
    cambios.empresa = texto || null;
  }

  if (cuerpo.estado_relacion !== undefined) {
    const estado = String(cuerpo.estado_relacion);
    if (!(ESTADOS_RELACION as readonly string[]).includes(estado)) {
      return { cambios: {}, error: "El estado tiene que ser prospecto, activo o inactivo." };
    }
    cambios.estado_relacion = estado;
  }

  if (cuerpo.proxima_interaccion_en !== undefined) {
    const texto = String(cuerpo.proxima_interaccion_en ?? "").trim();
    if (texto === "") {
      cambios.proxima_interaccion_en = null;
    } else if (!fechaValida(texto)) {
      return { cambios: {}, error: "La fecha del próximo contacto no es válida." };
    } else {
      cambios.proxima_interaccion_en = texto;
    }
  }

  if (cuerpo.responsable_id !== undefined) {
    const valor = cuerpo.responsable_id;
    if (valor === null || valor === "") {
      cambios.responsable_id = null;
    } else if (typeof valor === "string" && UUID.test(valor)) {
      cambios.responsable_id = valor;
    } else {
      return { cambios: {}, error: "El responsable no es válido." };
    }
  }

  return { cambios, error: null };
}

// ------------------------------------------------------------------- el historial

export type MensajeFila = {
  direccion: "entrante" | "saliente";
  tipo: string;
  texto: string | null;
  estado: string;
  motivo: string | null;
  origen: string;
  ocurrio_en: string;
};
export type ActividadFila = { id: string; tipo: string; detalle: string; fecha: string; hecha: boolean };
export type OportunidadFila = {
  id: string;
  titulo: string;
  etapa: string;
  monto: number;
  moneda: string;
  creado_en: string;
  cerrada_en: string | null;
  motivo_perdida: string | null;
};
export type VentaFila = { id: string; fecha: string; total: number; moneda: string; estado: string; numero_comprobante: string | null };

export type TipoHistorial =
  | "mensaje_recibido"
  | "mensaje_enviado"
  | "mensaje_no_salio"
  | "actividad"
  | "pendiente"
  | "oportunidad_creada"
  | "oportunidad_ganada"
  | "oportunidad_perdida"
  | "venta";

export type EntradaHistorial = {
  clave: string;
  /** ISO. Lo que se ordena. */
  cuando: string;
  tipo: TipoHistorial;
  titulo: string;
  detalle: string | null;
};

export const MAX_HISTORIAL = 60;

const ACTIVIDAD: Record<string, string> = {
  llamada: "Llamada",
  reunion: "Reunión",
  correo: "Correo",
  whatsapp: "WhatsApp",
  nota: "Nota",
  tarea: "Tarea",
};

function monto(valor: number, moneda: string): string {
  const n = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(valor);
  return moneda === "PYG" ? `₲ ${n}` : `${moneda} ${n}`;
}

/** Un día sin hora (`2026-09-15`) se ordena al mediodía UTC: no cambia de día en Paraguay. */
const alMediodia = (dia: string) => (dia.length <= 10 ? `${dia}T12:00:00.000Z` : dia);

const recortar = (t: string | null, max: number) => (t && t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

export function armarHistorial(f: {
  mensajes: MensajeFila[];
  actividades: ActividadFila[];
  oportunidades: OportunidadFila[];
  ventas: VentaFila[];
}): EntradaHistorial[] {
  const entradas: EntradaHistorial[] = [];

  f.mensajes.forEach((m, i) => {
    const salio = ["enviado", "entregado", "leido"].includes(m.estado);
    const texto = m.texto ?? (m.tipo === "plantilla" ? "Plantilla" : `(${m.tipo})`);

    if (m.direccion === "entrante") {
      entradas.push({ clave: `msg:${i}:${m.ocurrio_en}`, cuando: m.ocurrio_en, tipo: "mensaje_recibido", titulo: "Escribió por WhatsApp", detalle: recortar(texto, 200) });
    } else if (salio) {
      entradas.push({
        clave: `msg:${i}:${m.ocurrio_en}`,
        cuando: m.ocurrio_en,
        tipo: "mensaje_enviado",
        titulo: m.origen === "eos_autonomo" ? "EOS le escribió por WhatsApp" : "Le escribiste por WhatsApp",
        detalle: recortar(texto, 200),
      });
    } else {
      // Lo que NO salió también es historia, y con su motivo: es lo que evita creer que ya se le escribió.
      entradas.push({
        clave: `msg:${i}:${m.ocurrio_en}`,
        cuando: m.ocurrio_en,
        tipo: "mensaje_no_salio",
        titulo: m.estado === "pendiente_aprobacion" ? "Mensaje esperando aprobación" : "Un mensaje NO salió",
        detalle: m.motivo ? recortar(m.motivo, 200) : recortar(texto, 200),
      });
    }
  });

  for (const a of f.actividades) {
    entradas.push({
      clave: `act:${a.id}`,
      cuando: alMediodia(a.fecha),
      tipo: a.hecha ? "actividad" : "pendiente",
      titulo: `${a.hecha ? "" : "Pendiente · "}${ACTIVIDAD[a.tipo] ?? "Actividad"}`,
      detalle: recortar(a.detalle, 200),
    });
  }

  for (const o of f.oportunidades) {
    entradas.push({
      clave: `op:${o.id}:creada`,
      cuando: o.creado_en,
      tipo: "oportunidad_creada",
      titulo: `Nueva oportunidad: ${o.titulo}`,
      detalle: o.monto > 0 ? monto(o.monto, o.moneda) : null,
    });

    if ((o.etapa === "ganada" || o.etapa === "perdida") && o.cerrada_en) {
      entradas.push({
        clave: `op:${o.id}:cierre`,
        cuando: o.cerrada_en,
        tipo: o.etapa === "ganada" ? "oportunidad_ganada" : "oportunidad_perdida",
        titulo: `${o.etapa === "ganada" ? "Ganada" : "Perdida"}: ${o.titulo}`,
        detalle: o.etapa === "perdida" && o.motivo_perdida ? `Motivo: ${recortar(o.motivo_perdida, 160)}` : o.monto > 0 ? monto(o.monto, o.moneda) : null,
      });
    }
  }

  for (const v of f.ventas) {
    if (v.estado === "anulada") continue;
    entradas.push({
      clave: `venta:${v.id}`,
      cuando: alMediodia(v.fecha),
      tipo: "venta",
      titulo: `Venta${v.numero_comprobante ? ` ${v.numero_comprobante}` : ""}`,
      detalle: `${monto(v.total, v.moneda)}${v.estado === "cobrada" ? " · cobrada" : ""}`,
    });
  }

  return entradas.sort((a, b) => Date.parse(b.cuando) - Date.parse(a.cuando)).slice(0, MAX_HISTORIAL);
}

// --------------------------------------------------------------------- el resumen

export type ResumenFicha = {
  /** ISO del último contacto real (mensaje que salió o llegó, o actividad hecha). */
  ultimo_contacto: string | null;
  /** Días desde nuestro último mensaje que salió, si el cliente no contestó después. */
  sin_respuesta_dias: number | null;
  ventas: { cantidad: number; por_moneda: Record<string, number> };
  oportunidades_abiertas: { cantidad: number; por_moneda: Record<string, number> };
};

const MS_DIA = 86_400_000;

export function resumenDeFicha(
  f: { mensajes: MensajeFila[]; actividades: ActividadFila[]; oportunidades: OportunidadFila[]; ventas: VentaFila[] },
  ahora: Date,
): ResumenFicha {
  const contactos: number[] = [];
  let ultimoEntrante = -Infinity;
  let ultimoSaliente = -Infinity;

  for (const m of f.mensajes) {
    const t = Date.parse(m.ocurrio_en);
    if (Number.isNaN(t)) continue;

    if (m.direccion === "entrante") {
      contactos.push(t);
      ultimoEntrante = Math.max(ultimoEntrante, t);
    } else if (["enviado", "entregado", "leido"].includes(m.estado)) {
      contactos.push(t);
      ultimoSaliente = Math.max(ultimoSaliente, t);
    }
  }

  for (const a of f.actividades) {
    if (!a.hecha) continue;
    const t = Date.parse(alMediodia(a.fecha));
    if (!Number.isNaN(t) && t <= ahora.getTime()) contactos.push(t);
  }

  const ventas: ResumenFicha["ventas"] = { cantidad: 0, por_moneda: {} };
  for (const v of f.ventas) {
    if (v.estado === "anulada") continue;
    ventas.cantidad += 1;
    ventas.por_moneda[v.moneda] = (ventas.por_moneda[v.moneda] ?? 0) + v.total;
  }

  const abiertas: ResumenFicha["oportunidades_abiertas"] = { cantidad: 0, por_moneda: {} };
  for (const o of f.oportunidades) {
    if (o.etapa === "ganada" || o.etapa === "perdida") continue;
    abiertas.cantidad += 1;
    abiertas.por_moneda[o.moneda] = (abiertas.por_moneda[o.moneda] ?? 0) + o.monto;
  }

  return {
    ultimo_contacto: contactos.length ? new Date(Math.max(...contactos)).toISOString() : null,
    sin_respuesta_dias:
      ultimoSaliente > ultimoEntrante ? Math.max(0, Math.floor((ahora.getTime() - ultimoSaliente) / MS_DIA)) : null,
    ventas,
    oportunidades_abiertas: abiertas,
  };
}

// ------------------------------------------------- una base a medio actualizar

/** Las columnas de la ficha (v185), para pedirlas junto a las de siempre. */
export const COLUMNAS_FICHA = CAMPOS_FICHA.join(",");

/**
 * ¿El error es "esa columna todavía no existe"? Pasa mientras el código nuevo y la migración
 * v185 no están los dos en producción: leer sin las columnas nuevas es mejor que romper la lista.
 * Escribirlas, en cambio, NO se hace en silencio: se avisa que todavía no se puede.
 */
export function faltaLaFicha(error: unknown): boolean {
  const codigo = String((error as { code?: unknown } | null)?.code ?? "");
  return codigo === "42703" || codigo === "PGRST204";
}
