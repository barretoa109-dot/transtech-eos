"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";

/**
 * Cómo viene EOS, en una pantalla.
 *
 * ============================================================
 * QUÉ MIRAR PRIMERO
 * ============================================================
 *
 * Lo de arriba es lo que puede estar roto ahora mismo: avisos de pago sin
 * procesar, acciones trabadas, briefings que fallaron. Si algo de eso está en
 * rojo, alguien pagó y no recibió lo suyo, o le pidió algo a EOS y quedó a
 * medias.
 *
 * Lo informativo va abajo y nunca se pone rojo. Las acciones con error, por
 * ejemplo, en su mayoría son el sistema haciendo lo correcto: negarse a vender
 * un producto ambiguo, rechazar un cliente que no existe. Ponerlas en rojo
 * enseñaría a ignorar el rojo.
 */

type Chequeo = { nombre: string; ok: boolean; detalle: string };

type Reporte = {
  sano: boolean;
  verificado_en: string;
  chequeos: Chequeo[];
  fallos: Chequeo[];
};

/* Los que informan en vez de vigilar: se muestran aparte y sin color. */
const INFORMATIVOS = /\(informativo\)/i;

export default function SaludPage() {
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // Ningún `setState` antes del primer `await`: al montar el estado ya
  // arranca así, y hacerlo costaba un render extra en cascada.
  const cargar = useCallback(async () => {
    try {
      const respuesta = await fetch("/api/admin/salud", { cache: "no-store" });

      if (respuesta.status === 404) {
        setError("Esta pantalla es solo para administradores.");
        return;
      }

      if (!respuesta.ok) throw new Error("No se pudo consultar.");

      setReporte((await respuesta.json()) as Reporte);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo consultar.");
    } finally {
      setCargando(false);
    }
  }, []);

  /** Volver a consultar a mano sí muestra el spinner otra vez. */
  const recargar = useCallback(() => {
    setCargando(true);
    void cargar();
  }, [cargar]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const vigilados = (reporte?.chequeos ?? []).filter((c) => !INFORMATIVOS.test(c.nombre));
  const informativos = (reporte?.chequeos ?? []).filter((c) => INFORMATIVOS.test(c.nombre));

  return (
    <main className="salud">
      <header className="cabecera">
        <div>
          <h1>Salud de EOS</h1>
          {reporte && (
            <p className="momento">
              Verificado {new Date(reporte.verificado_en).toLocaleString("es-PY")}
            </p>
          )}
        </div>

        {/*
          El ícono va envuelto en un span y no lleva la clase él mismo.
          styled-jsx no alcanza a los componentes: la clase llegaría al SVG de
          lucide sin el atributo de alcance, y la animación no se aplicaría.
          Peor todavía, en desarrollo a veces parece andar y sólo falla en el
          build de producción.
        */}
        <button type="button" onClick={recargar} disabled={cargando}>
          <span className={cargando ? "girando" : ""}>
            <RefreshCw size={15} />
          </span>
          {cargando ? "Revisando…" : "Revisar de nuevo"}
        </button>
      </header>

      {error && <p className="aviso-error" role="alert">{error}</p>}

      {cargando && !reporte && (
        <p className="cargando">
          <span className="girando">
            <Loader2 size={18} />
          </span>{" "}
          Revisando todo…
        </p>
      )}

      {reporte && (
        <>
          <div className={reporte.sano ? "veredicto sano" : "veredicto roto"}>
            {reporte.sano ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
            <div>
              <strong>{reporte.sano ? "Todo funcionando" : "Hay algo roto"}</strong>
              <span>
                {reporte.sano
                  ? `${vigilados.length} comprobaciones en verde`
                  : `${reporte.fallos.length} de ${vigilados.length} fallaron`}
              </span>
            </div>
          </div>

          <ul className="lista">
            {vigilados.map((c) => (
              <li key={c.nombre} className={c.ok ? "ok" : "mal"}>
                {c.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                <span className="nombre">{c.nombre}</span>
                <span className="detalle">{c.detalle}</span>
              </li>
            ))}
          </ul>

          {informativos.length > 0 && (
            <section className="informativo">
              <h2>Para mirar, no para preocuparse</h2>
              <ul className="lista">
                {informativos.map((c) => (
                  <li key={c.nombre} className="neutro">
                    <span className="nombre">{c.nombre.replace(/\s*\(informativo\)/i, "")}</span>
                    <span className="detalle">{c.detalle}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <style jsx>{`
        .salud {
          max-width: 760px;
          margin: 0 auto;
          padding: 48px 22px 80px;
          font-family: var(--font-inter), Inter, system-ui, sans-serif;
          color: #07132a;
        }
        .cabecera {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 800;
        }
        .momento {
          margin: 4px 0 0;
          font-size: 13px;
          color: #6b7280;
        }
        .cabecera button {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-radius: 999px;
          border: 1px solid #e5e9f0;
          background: #fff;
          font-size: 13.5px;
          font-weight: 600;
          color: #07132a;
          cursor: pointer;
        }
        .cabecera button:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .girando {
          display: inline-flex;
          animation: girar 1s linear infinite;
        }
        @keyframes girar {
          to {
            transform: rotate(360deg);
          }
        }
        .cargando {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 30px;
          color: #6b7280;
        }
        .aviso-error {
          margin-top: 24px;
          padding: 14px 16px;
          border-radius: 12px;
          background: #fdeaea;
          color: #a12b2b;
          font-size: 14px;
        }
        .veredicto {
          display: flex;
          align-items: center;
          gap: 14px;
          margin: 28px 0 22px;
          padding: 18px 20px;
          border-radius: 14px;
        }
        .veredicto div {
          display: flex;
          flex-direction: column;
        }
        .veredicto strong {
          font-size: 16px;
        }
        .veredicto span {
          font-size: 13px;
          opacity: 0.8;
        }
        .veredicto.sano {
          background: #e6f7f1;
          color: #0b6b52;
        }
        .veredicto.roto {
          background: #fdeaea;
          color: #a12b2b;
        }
        .lista {
          list-style: none;
          margin: 0;
          padding: 0;
          border: 1px solid #e5e9f0;
          border-radius: 14px;
          overflow: hidden;
        }
        .lista li {
          display: grid;
          grid-template-columns: 20px minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          border-bottom: 1px solid #f1f5fb;
          font-size: 14px;
        }
        .lista li:last-child {
          border-bottom: none;
        }
        .lista li.neutro {
          grid-template-columns: minmax(0, 1fr) auto;
        }
        .lista li.ok {
          color: #0b6b52;
        }
        .lista li.mal {
          color: #a12b2b;
          background: #fdf3f3;
        }
        .nombre {
          font-weight: 600;
          color: #07132a;
        }
        .detalle {
          font-size: 13px;
          color: #6b7280;
          text-align: right;
        }
        .informativo {
          margin-top: 34px;
        }
        .informativo h2 {
          margin: 0 0 12px;
          font-size: 14px;
          font-weight: 700;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
      `}</style>
    </main>
  );
}
