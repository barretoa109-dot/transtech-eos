"use client";

import { useState } from "react";

import Emisor from "./negocio/Emisor";
import MiEmpresa from "./MiEmpresa";
import { SubNav } from "./SeccionNav";
import { useEtiquetaEspacio } from "./EspacioContext";
import type { FuncionOcultable } from "./espacios";

/**
 * Ajustes del negocio (05/10/2026).
 *
 * Junta lo que se configura una vez y era de la empresa pero vivía repartido:
 * los datos del emisor (antes el engranaje de Facturación, dentro de Negocio)
 * y los datos de la empresa con su equipo (antes solo en el Perfil, que sigue
 * mostrándolos). Y suma lo nuevo de la v232: qué funciones usa este negocio.
 */
type Parte = "funciones" | "empresa" | "emisor";

const PARTES = [
  { clave: "funciones" as const, etiqueta: "Funciones", detalle: "Qué muestra el menú de este negocio" },
  { clave: "empresa" as const, etiqueta: "Empresa y equipo", detalle: "Nombre, RUC y quién entra a este negocio" },
  { clave: "emisor" as const, etiqueta: "Facturación", detalle: "Lo que va impreso en cada comprobante" },
];

const FUNCIONES: { clave: FuncionOcultable; nombre: string; detalle: string }[] = [
  {
    clave: "catalogo",
    nombre: "Catálogo e inventario",
    detalle: "Productos con precio, foto y stock. Sin catálogo, las ventas se anotan por concepto.",
  },
  {
    clave: "clientes",
    nombre: "Clientes",
    detalle: "Contactos, seguimientos, oportunidades y conversaciones de WhatsApp.",
  },
];

type Props = {
  empresaId: string | null;
  funcionesOcultas: FuncionOcultable[];
  puedoAdministrar: boolean;
  onFuncionesCambiadas: (ocultas: FuncionOcultable[]) => void;
};

export default function AjustesNegocio({ empresaId, funcionesOcultas, puedoAdministrar, onFuncionesCambiadas }: Props) {
  const etiquetaEspacio = useEtiquetaEspacio();
  const [parte, setParte] = useState<Parte>("funciones");
  const [guardando, setGuardando] = useState<FuncionOcultable | null>(null);
  const [error, setError] = useState("");

  async function alternar(funcion: FuncionOcultable) {
    if (!empresaId || guardando) return;

    const nuevas = funcionesOcultas.includes(funcion)
      ? funcionesOcultas.filter((f) => f !== funcion)
      : [...funcionesOcultas, funcion];

    setGuardando(funcion);
    setError("");

    try {
      const r = await fetch("/api/empresa/funciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa_id: empresaId, funciones_ocultas: nuevas }),
      });
      const datos = await r.json().catch(() => null);
      if (!r.ok) throw new Error(datos?.error || "No se pudo guardar el cambio.");
      onFuncionesCambiadas((datos?.funciones_ocultas ?? nuevas) as FuncionOcultable[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el cambio.");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="view" id="view-ajustes-negocio">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">{etiquetaEspacio}</div>
          <div className="page-title">Ajustes del negocio</div>
          <div className="page-sub">Lo que se configura una vez. Lo que cambies acá vale solo para este negocio.</div>
        </div>

        <SubNav subs={PARTES} sub={parte} onSub={setParte} ariaLabel="Partes de Ajustes del negocio" />

        {parte === "funciones" && (
          <div className="card">
            <div className="card-title">Funciones de este negocio</div>
            <div className="card-sub">
              Lo que apagás sale del menú de este negocio. No se borra nada ni cambia lo que pagás, y se vuelve a
              prender cuando quieras.
            </div>

            <div className="funciones-lista">
              {FUNCIONES.map((f) => {
                const prendida = !funcionesOcultas.includes(f.clave);
                return (
                  <div className="funcion-fila" key={f.clave}>
                    <div>
                      <div className="funcion-nombre">{f.nombre}</div>
                      <div className="funcion-detalle">{f.detalle}</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={prendida}
                      aria-label={f.nombre}
                      className={`interruptor${prendida ? " is-on" : ""}`}
                      disabled={!puedoAdministrar || !empresaId || guardando !== null}
                      onClick={() => void alternar(f.clave)}
                    />
                  </div>
                );
              })}
            </div>

            {!puedoAdministrar && (
              <p className="empty-note" style={{ marginTop: 10 }}>
                Solo el dueño o un administrador del negocio cambian esto.
              </p>
            )}
            {error && (
              <p className="neg-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {parte === "empresa" && <MiEmpresa />}
        {parte === "emisor" && <Emisor />}
      </div>
    </div>
  );
}
