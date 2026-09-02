"use client";

import {
  avisoDeConfianza,
  flechaDe,
  formatearValor,
  formatearVariacion,
  textoSinValor,
  tonoDeVariacion,
} from "@/lib/kpi/formato";
import type { ResultadoKPI } from "@/lib/kpi/tipos";

/**
 * Un indicador, dicho en una tarjeta.
 *
 * ============================================================
 * POR QUÉ NO MUESTRA UN CERO CUANDO NO SABE
 * ============================================================
 *
 * Es la regla que atraviesa todo este módulo. Un margen en blanco porque
 * ninguna venta tiene el costo cargado NO es un margen de 0%: la primera
 * respuesta le dice al usuario qué le falta hacer, la segunda le dice que su
 * negocio no gana nada. Por eso el valor ausente se dibuja como un guion y
 * abajo va el motivo que trajo la propia definición.
 *
 * ============================================================
 * POR QUÉ LA FLECHA NO SE PINTA POR SU SIGNO
 * ============================================================
 *
 * Que los gastos suban 20% y que las ventas suban 20% son la misma flecha
 * para arriba y noticias opuestas. El color sale de `tonoDeVariacion`, que
 * cruza la tendencia con la `direccion` declarada por cada indicador — nunca
 * del signo solo.
 *
 * Todo el formateo vive en `lib/kpi/formato.ts` y está testeado ahí; acá no
 * se decide ni un decimal, para que el mismo indicador se lea igual en esta
 * tarjeta, en Rentabilidad y —cuando exista— adentro de una respuesta del
 * chat.
 */
export default function TarjetaKPI({
  kpi,
  retraso,
  abierto,
  onAbrir,
}: {
  kpi: ResultadoKPI;
  retraso?: number;
  abierto?: boolean;
  onAbrir?: () => void;
}) {
  const variacion = formatearVariacion(kpi);
  const tono = tonoDeVariacion(kpi.tendencia, kpi.direccion);
  const aviso = avisoDeConfianza(kpi);

  // `.d.up`/`.d.down` ya existen en eosApp.css con verde y rojo, pero ahí el
  // nombre habla de la flecha. Acá lo que decide el color es si es buena o
  // mala noticia, así que se mapea explícitamente en vez de asumir que subir
  // es verde.
  const claseTono = tono === "bueno" ? "up" : tono === "malo" ? "down" : "";

  /*
   * Es un <button> y no un <div onClick>.
   *
   * Un div con onClick no recibe foco con Tab, no responde a Enter ni a la
   * barra espaciadora, y un lector de pantalla lo anuncia como texto suelto.
   * La tarjeta ya se ve clickeable; con esto también lo es para quien no usa
   * mouse. El punto 48 de la lista de lanzamiento pide justamente esta
   * auditoría, así que no vale la pena estrenar deuda nueva.
   */
  return (
    <button
      type="button"
      className={`kpi-card kpi-estado-${kpi.estado}${abierto ? " is-abierto" : ""}`}
      style={retraso !== undefined ? { animationDelay: `${retraso}s` } : undefined}
      onClick={onAbrir}
      aria-expanded={abierto ?? false}
    >
      <div className="l">{kpi.nombre}</div>

      {kpi.valor === null ? (
        <>
          <div className="v kpi-sin-valor">—</div>
          <div className="kpi-falta">{textoSinValor(kpi)}</div>
        </>
      ) : (
        <>
          <div className="v" title={`${kpi.nombre}: ${formatearValor(kpi.valor, kpi.unidad, kpi.moneda)}`}>
            {formatearValor(kpi.valor, kpi.unidad, kpi.moneda)}
          </div>
          {/* Sin "vs. período anterior" en cada tarjeta: el subtítulo del
              panel ya dice contra qué se compara, y repetirlo veinte veces
              es ruido que además envuelve a tres líneas en un teléfono. El
              `title` lo deja disponible para quien lo necesite. */}
          {variacion && (
            <div className={`d ${claseTono}`} title="Comparado con el período anterior de igual largo">
              <span aria-hidden="true">{flechaDe(kpi.tendencia)}</span>
              <span>{variacion}</span>
            </div>
          )}
        </>
      )}

      {aviso && <div className="kpi-confianza">{aviso}</div>}
    </button>
  );
}
