"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { DIAS_AVISO_VENCIMIENTO } from "@/lib/modulos/catalogo";

/**
 * Qué funciones tiene contratadas el usuario, y hasta cuándo.
 *
 * ============================================================
 * POR QUÉ ESTO NO PUEDE FALTAR
 * ============================================================
 *
 * Desde que el plan lo arma el usuario, "Plan Pro" dejó de significar algo:
 * alguien puede estar pagando el panel, el briefing y el ERP, y ninguna de esas
 * tres cosas se llama "Pro". Una pantalla de cuenta que muestre el nombre de un
 * plan interno le está diciendo al usuario algo que no se corresponde con lo
 * que compró ni con lo que paga.
 *
 * Y hay un motivo más duro: los módulos VENCEN. Si el único lugar donde eso se
 * puede ver es el cobro que no entró, el usuario se entera de que se le venció
 * el ERP cuando abre el ERP y no está. Por eso el aviso sale diez días antes
 * —alcanza para renovar sin apuro y no es tanto como para volverse ruido— y por
 * eso vive en la pantalla de cuenta, que es donde alguien va a buscar
 * justamente esto.
 */

type Modulo = {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  contratado: boolean;
  vencimiento?: string | null;
  dias_restantes?: number | null;
  por_vencer?: boolean;
  origen?: string;
};

export default function MisModulos() {
  const [modulos, setModulos] = useState<Modulo[] | null>(null);

  useEffect(() => {
    let activo = true;

    fetch("/api/modulos", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("No disponible"))))
      .then((payload) => {
        if (activo) setModulos(Array.isArray(payload.modulos) ? payload.modulos : []);
      })
      .catch(() => {
        /* La tarjeta simplemente no se muestra. */
      });

    return () => {
      activo = false;
    };
  }, []);

  if (modulos === null) return null;

  const activos = modulos.filter((m) => m.contratado);
  const porVencerPronto = activos.filter((m) => m.por_vencer === true);

  return (
    <div className="card">
      <div className="card-title">Tu EOS</div>
      <div className="card-sub">
        {activos.length === 0
          ? "Todavía no tenés funciones activas."
          : `${activos.length} ${activos.length === 1 ? "función activa" : "funciones activas"}`}
      </div>

      {activos.length === 0 ? (
        <p className="prose">
          EOS se arma por partes: elegís las funciones que vas a usar y pagás solo esas.
        </p>
      ) : (
        <div className="mod-lista">
          {activos.map((m) => {
            const dias = m.dias_restantes ?? null;
            const avisa = m.por_vencer === true;

            return (
              <div className={`mod-fila ${avisa ? "is-avisa" : ""}`} key={m.codigo}>
                <span className={`mod-punto ${avisa ? "is-avisa" : ""}`}>
                  {avisa ? <AlertTriangle size={12} /> : <Check size={12} />}
                </span>

                <span className="mod-nombre">{m.nombre}</span>

                <span className="mod-vence">
                  {/*
                    Sin vencimiento son las cortesías y el uso interno del
                    ecosistema. Decir "sin vencimiento" es más honesto que dejar
                    el espacio vacío, que se lee como un dato que falta.
                  */}
                  {dias === null
                    ? m.origen === "cortesia"
                      ? "de cortesía"
                      : "sin vencimiento"
                    : dias <= 0
                      ? "vencida"
                      : `vence en ${dias} ${dias === 1 ? "día" : "días"}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {porVencerPronto.length > 0 && (
        <p className="prose" style={{ marginTop: 10, color: "var(--amber)", fontSize: 13 }}>
          {porVencerPronto.length === 1
            ? `${porVencerPronto[0].nombre} vence pronto.`
            : `${porVencerPronto.length} funciones vencen dentro de ${DIAS_AVISO_VENCIMIENTO} días.`}{" "}
          Renovalas antes de que dejen de andar.
        </p>
      )}

      <Link className="reco-btn" href="/planes" style={{ display: "inline-flex", marginTop: 12 }}>
        {activos.length === 0 ? "Armar mi EOS" : "Cambiar mis funciones"}
      </Link>
    </div>
  );
}
