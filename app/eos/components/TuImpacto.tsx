"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * "Tu mes con EOS": las mismas cuatro cifras que ya calcula
 * `lib/impacto/informe.ts` para el correo mensual, del mes EN CURSO. Cuarta
 * pieza de la reorganización de Personal maquetada y aprobada en el canal de
 * diseño (sidebar #256, detalle colapsable #258, progreso de 14 días #261).
 *
 * "Ver el informe completo" reusa el mismo patrón de colapsar/expandir que
 * ya tiene el detalle de Hoy, en vez de abrir una pantalla nueva: las
 * líneas que muestra son las mismas que arma `lineasDelInforme`, la función
 * que ya redacta el correo.
 */

type Datos = {
  hayImpacto: boolean;
  nombreMes?: string;
  anotadas?: number;
  documentos?: number;
  minutosAhorrados?: number;
  avisos?: number;
  lineas?: string[];
};

/**
 * Formato corto para la tarjeta, no el de `lib/impacto/informe.ts`
 * (`tiempoEnPalabras`, "unas 2 horas"): ese texto es para una oración de
 * correo, y acá tiene que entrar en el ancho de una sola cifra.
 */
function tiempoCorto(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `${horas} ${horas === 1 ? "hora" : "horas"}`;
}

export default function TuImpacto() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    let vigente = true;
    fetch("/api/impacto/mes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fallo"))))
      .then((d: Datos) => {
        if (vigente) setDatos(d);
      })
      .catch(() => {
        if (vigente) setDatos(null);
      });
    return () => {
      vigente = false;
    };
  }, []);

  if (!datos || !datos.hayImpacto) return null;

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="card-title">Tu {datos.nombreMes} con EOS</span>
        <button type="button" className="tu-impacto-ver" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
          {abierto ? "Ocultar el informe" : "Ver el informe completo"}
          <ChevronDown size={13} className={abierto ? "fin-chevron-open" : ""} />
        </button>
      </div>

      <div className="tu-impacto-grid">
        <div className="tu-impacto-dato">
          <span className="tu-impacto-numero">{tiempoCorto(datos.minutosAhorrados ?? 0)}</span>
          <span className="tu-impacto-etiqueta">que no pasaste anotando</span>
        </div>
        <div className="tu-impacto-dato">
          <span className="tu-impacto-numero">{datos.anotadas}</span>
          <span className="tu-impacto-etiqueta">cosas anotadas</span>
        </div>
        <div className="tu-impacto-dato">
          <span className="tu-impacto-numero">{datos.avisos}</span>
          <span className="tu-impacto-etiqueta">{datos.avisos === 1 ? "aviso a tiempo" : "avisos a tiempo"}</span>
        </div>
        <div className="tu-impacto-dato">
          <span className="tu-impacto-numero">{datos.documentos}</span>
          <span className="tu-impacto-etiqueta">{datos.documentos === 1 ? "documento armado" : "documentos armados"}</span>
        </div>
      </div>

      {abierto && (
        <ul className="tu-impacto-lineas">
          {(datos.lineas ?? []).map((linea, i) => (
            <li key={i}>{linea}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
