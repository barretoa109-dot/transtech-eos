/**
 * Cuando el modelo pide BUSCAR_WEB (01/10/2026).
 *
 * Mensaje → el modelo entiende qué quiere la persona y qué dato actual falta →
 * pide BUSCAR_WEB con una consulta pública → el servidor la limpia, controla
 * límite y caché, e investiga aislado → el MISMO modelo responde con la
 * conversación + los hallazgos → el servidor controla citas y enlaces.
 *
 * Garantías:
 * - Una sola investigación por mensaje.
 * - Lo que conteste la síntesis NUNCA ejecuta acciones: sus acciones se tiran.
 *   Una página web no puede disparar un pago, un mensaje ni un registro.
 * - Las acciones del mensaje original (las que pidió la persona) siguen su
 *   camino normal; BUSCAR_WEB nunca llega al worker.
 * - Si no se pudo buscar, se dice; nunca "busqué" sin haber buscado.
 */
import { nombreDelPais, paisDe } from "../busqueda/consulta.ts";
import type { ResultadoBusqueda } from "../busqueda/servicio.ts";
import { bloqueParaSintesis, respuestaConFuentes, respuestaSinBusqueda, respuestaSinEvidencia } from "../busqueda/sintesis.ts";
import type { ParteOpenAI } from "./prompt.ts";
import { ACCIONES_DEL_GATEWAY, SIN_INTERPRETAR, SIN_RESPUESTA, type RespuestaGateway } from "./respuesta.ts";

export type DepsBusqueda = {
  buscar?: (datos: Record<string, unknown>) => Promise<ResultadoBusqueda>;
  alBuscar?: () => void;
  /** Vuelve a llamar al modelo con contenido extra; null si falló. */
  sintetizar: (contenido: ParteOpenAI[]) => Promise<RespuestaGateway | null>;
};

export function pidioBusqueda(cuerpo: RespuestaGateway): boolean {
  return cuerpo.acciones.some((a) => ACCIONES_DEL_GATEWAY.has(a.tipo));
}

function sinAccionesDelGateway(cuerpo: RespuestaGateway): void {
  const resto = cuerpo.acciones.filter((a) => !ACCIONES_DEL_GATEWAY.has(a.tipo));
  cuerpo.acciones = resto;
  cuerpo.requiere_worker = resto.length > 0;
  cuerpo.accion = resto.length > 0 ? resto[0].tipo : "RESPONDER";
}

/** Resuelve la búsqueda sobre `cuerpo` (lo modifica). Devuelve el costo de la investigación en USD. */
export async function resolverBusqueda(
  cuerpo: RespuestaGateway,
  contenido: ParteOpenAI[],
  deps: DepsBusqueda,
): Promise<number> {
  const pedido = cuerpo.acciones.find((a) => a.tipo === "BUSCAR_WEB");
  sinAccionesDelGateway(cuerpo);
  if (!pedido) return 0;

  if (!deps.buscar) {
    cuerpo.respuesta = respuestaSinBusqueda("no_disponible");
    cuerpo.metadata.busqueda = { ok: false, codigo: "no_disponible" };
    return 0;
  }

  deps.alBuscar?.();
  const antes = Date.now();
  let resultado: ResultadoBusqueda;
  try {
    resultado = await deps.buscar(pedido.datos);
  } catch {
    cuerpo.respuesta = respuestaSinBusqueda("error_proveedor");
    cuerpo.metadata.busqueda = { ok: false, codigo: "error_proveedor", ms: Date.now() - antes };
    return 0;
  }

  const inv = resultado.investigacion;
  if (!inv.ok) {
    cuerpo.respuesta =
      inv.codigo === "sin_resultados"
        ? respuestaSinEvidencia({ nombrePais: nombreDelPais(paisDe(pedido.datos.pais)) }, resultado.consulta)
        : respuestaSinBusqueda(inv.codigo);
    cuerpo.metadata.busqueda = { ok: false, codigo: inv.codigo, ms: inv.ms, costo_usd: inv.costoUsd };
    return inv.costoUsd;
  }

  const antesSintesis = Date.now();
  const sintesis = await deps.sintetizar([
    ...contenido,
    { type: "input_text", text: bloqueParaSintesis(inv, resultado.consulta) },
  ]);

  const legible =
    sintesis && sintesis.respuesta !== SIN_INTERPRETAR && sintesis.respuesta !== SIN_RESPUESTA ? sintesis : null;

  // Sin síntesis, los hallazgos tal cual: siguen siendo lo que se encontró, con sus fuentes.
  cuerpo.respuesta = respuestaConFuentes(legible ? legible.respuesta : inv.hallazgos, inv);

  if (legible) {
    cuerpo.tokens_entrada += legible.tokens_entrada;
    cuerpo.tokens_entrada_cacheados += legible.tokens_entrada_cacheados;
    cuerpo.tokens_salida += legible.tokens_salida;
  }

  cuerpo.metadata.busqueda = {
    ok: true,
    codigo: "ok",
    ms: inv.ms,
    costo_usd: inv.costoUsd,
    fuentes: inv.fuentes.length,
    desde_cache: inv.desdeCache,
    modelo: inv.modelo,
    sintesis: legible ? "ok" : "hallazgos",
    sintesis_ms: Date.now() - antesSintesis,
    // Acciones que la síntesis haya querido mandar: se tiran, solo se cuentan.
    acciones_descartadas: sintesis ? sintesis.acciones.length : 0,
  };
  return inv.costoUsd;
}
