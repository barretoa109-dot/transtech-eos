"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Power, RefreshCw, ShieldCheck } from "lucide-react";

/**
 * Los agentes, en una pantalla (solo para ADMIN_EMAILS).
 *
 * Lo primero es lo que espera al dueño: los escalamientos abiertos. Después,
 * cada agente con su interruptor, su versión y lo que hizo en la semana.
 *
 * Un agente prendido con una versión distinta de la aprobada NO corre: la
 * base lo frena y escala. Por eso la tarjeta lo dice en vez de mostrar
 * "prendido" a secas.
 */

type FilaAgente = {
  agente: string;
  activo: boolean;
  version_aprobada: string | null;
  aprobado_por: string | null;
  aprobado_en: string | null;
  corridas_7d: number;
  errores_7d: number;
  mensajes_7d: number;
  bloqueados_tope_7d: number;
  costo_mes_usd: number;
};

type Caso = {
  id: string;
  agente: string;
  usuario_id: string | null;
  motivo: string;
  prioridad: "urgente" | "normal";
  contexto: Record<string, unknown>;
  creado_en: string;
};

type Panel = {
  tope_semanal: number;
  tope_sistema?: number;
  agentes: FilaAgente[];
  escalamientos: Caso[];
  versiones_desplegadas: Record<string, string>;
};

const NOMBRES: Record<string, string> = {
  reportes: "Reportes",
  cobranza: "Cobranza",
  activacion: "Activación",
  soporte: "Soporte",
  retencion: "Retención",
  contenido: "Contenido",
  sistema: "Avisos automáticos",
};

export default function AgentesPage() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [tope, setTope] = useState("");
  const [topeSistema, setTopeSistema] = useState("");

  /*
   * Los `setState` van en el `.then`, no en el cuerpo del efecto: así lo pide
   * react-hooks/set-state-in-effect, y es lo correcto (se actualiza cuando
   * llega la respuesta, no al montar).
   */
  const cargar = useCallback(
    () =>
      fetch("/api/admin/agentes", { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error(r.status === 404 ? "No encontrado." : "No se pudo cargar.");
          return (await r.json()) as Panel;
        })
        .then(
          (datos) => {
            setPanel(datos);
            setTope(String(datos.tope_semanal));
            setTopeSistema(String(datos.tope_sistema ?? ""));
            setError("");
          },
          (e: unknown) => setError(e instanceof Error ? e.message : "No se pudo cargar."),
        )
        .finally(() => setCargando(false)),
    [],
  );

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function hacer(clave: string, cuerpo: Record<string, unknown>) {
    setOcupado(clave);
    try {
      const r = await fetch("/api/admin/agentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const datos = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(datos.error || "No se pudo.");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo.");
    } finally {
      setOcupado("");
    }
  }

  return (
    <main className="agentes">
      <header className="cabecera">
        <div>
          <h1>Agentes de EOS</h1>
          <p className="momento">Prender, apagar y aprobar rige al instante, sin deploy.</p>
        </div>
        <button type="button" onClick={() => void cargar()} disabled={cargando}>
          <span className={cargando ? "girando" : ""}>
            <RefreshCw size={15} />
          </span>
          Actualizar
        </button>
      </header>

      {error && (
        <p className="aviso-error" role="alert">
          {error}
        </p>
      )}

      {cargando && !panel && (
        <p className="cargando">
          <span className="girando">
            <Loader2 size={18} />
          </span>{" "}
          Cargando…
        </p>
      )}

      {panel && (
        <>
          <section>
            <h2>Escalamientos abiertos ({panel.escalamientos.length})</h2>
            {panel.escalamientos.length === 0 && <p className="vacio">Nada esperando.</p>}
            <ul className="casos">
              {panel.escalamientos.map((c) => (
                <li key={c.id} className={c.prioridad}>
                  <div className="caso-cabecera">
                    <strong>{NOMBRES[c.agente] ?? c.agente}</strong>
                    <span className="etiqueta">{c.prioridad}</span>
                    <span className="momento">{new Date(c.creado_en).toLocaleString("es-PY")}</span>
                  </div>
                  <p>{c.motivo}</p>
                  {c.usuario_id && <p className="detalle">Cuenta {c.usuario_id}</p>}
                  {Object.keys(c.contexto ?? {}).length > 0 && (
                    <pre className="detalle">{JSON.stringify(c.contexto, null, 2)}</pre>
                  )}
                  <textarea
                    placeholder="Qué hiciste o qué respondiste (opcional)"
                    value={respuestas[c.id] ?? ""}
                    onChange={(e) => setRespuestas((r) => ({ ...r, [c.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    disabled={ocupado === c.id}
                    onClick={() => void hacer(c.id, { accion: "resolver", id: c.id, respuesta: respuestas[c.id] ?? "" })}
                  >
                    Marcar resuelto
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Agentes</h2>
            <ul className="tarjetas">
              {panel.agentes.map((a) => {
                // `sistema` no es un agente: no tiene versión que aprobar (v268).
                const esSistema = a.agente === "sistema";
                const desplegada = panel.versiones_desplegadas[a.agente];
                const aprobada = esSistema || a.version_aprobada === desplegada;
                const estado = !a.activo ? "Apagado" : aprobada ? "Prendido" : "Prendido, pero frenado: versión sin aprobar";
                return (
                  <li key={a.agente} className={a.activo && aprobada ? "prendido" : a.activo ? "frenado" : "apagado"}>
                    <div className="caso-cabecera">
                      <strong>{NOMBRES[a.agente] ?? a.agente}</strong>
                      <span className="etiqueta">{estado}</span>
                    </div>
                    <p className="detalle">
                      7 días: {a.corridas_7d} corridas · {a.errores_7d} errores · {a.mensajes_7d} mensajes ·{" "}
                      {a.bloqueados_tope_7d} frenados por el tope · mes: USD {Number(a.costo_mes_usd).toFixed(4)}
                    </p>
                    {esSistema ? (
                      <p className="detalle">
                        El push de las franjas, el correo motivacional y los de la primera semana. Apagado, no sale ninguno.
                      </p>
                    ) : (
                      <p className="detalle">
                        Versión desplegada {desplegada} ·{" "}
                        {a.version_aprobada
                          ? `aprobada ${a.version_aprobada}${a.aprobado_por ? ` por ${a.aprobado_por}` : ""}`
                          : "nunca aprobada"}
                      </p>
                    )}
                    <div className="acciones">
                      <button
                        type="button"
                        disabled={ocupado === a.agente}
                        onClick={() => void hacer(a.agente, { accion: a.activo ? "apagar" : "prender", agente: a.agente })}
                      >
                        <Power size={14} /> {a.activo ? "Apagar" : "Prender"}
                      </button>
                      {!aprobada && (
                        <button
                          type="button"
                          disabled={ocupado === a.agente}
                          onClick={() => {
                            if (window.confirm(`¿Aprobar la versión ${desplegada} de ${NOMBRES[a.agente]}? Revisá antes sus reglas y prompts en agentes/${a.agente}/.`)) {
                              void hacer(a.agente, { accion: "aprobar", agente: a.agente });
                            }
                          }}
                        >
                          <ShieldCheck size={14} /> Aprobar esta versión
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h2>Tope semanal por persona</h2>
            <p className="detalle">
              Mensajes en 7 días, sumando los agentes y los avisos automáticos. Las respuestas de Soporte a una pregunta no cuentan.
            </p>
            <div className="acciones">
              <input type="number" min={0} max={50} value={tope} onChange={(e) => setTope(e.target.value)} />
              <button type="button" disabled={ocupado === "tope"} onClick={() => void hacer("tope", { accion: "tope", tope: Number(tope) })}>
                Guardar
              </button>
            </div>
            <p className="detalle">
              De ese tope, cuántos pueden ser avisos automáticos (el resto queda para los agentes). Lo motivacional sale como mucho uno cada 3 días.
            </p>
            <div className="acciones">
              <input type="number" min={0} max={50} value={topeSistema} onChange={(e) => setTopeSistema(e.target.value)} />
              <button
                type="button"
                disabled={ocupado === "tope_sistema"}
                onClick={() => void hacer("tope_sistema", { accion: "tope_sistema", tope: Number(topeSistema) })}
              >
                Guardar
              </button>
            </div>
          </section>
        </>
      )}

      <style jsx>{`
        .agentes {
          max-width: 760px;
          margin: 0 auto;
          padding: 48px 16px 80px;
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
        h2 {
          margin: 32px 0 12px;
          font-size: 17px;
          font-weight: 700;
        }
        .momento,
        .detalle,
        .vacio {
          margin: 4px 0 0;
          font-size: 13px;
          color: #6b7280;
          overflow-wrap: anywhere;
        }
        pre.detalle {
          white-space: pre-wrap;
          font-size: 12px;
        }
        button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid #e5e9f0;
          background: #fff;
          font-size: 13px;
          font-weight: 600;
          color: #07132a;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .casos,
        .tarjetas {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 12px;
        }
        .casos li,
        .tarjetas li {
          border: 1px solid #e5e9f0;
          border-radius: 16px;
          padding: 14px 16px;
          background: #fff;
        }
        .casos li.urgente,
        .tarjetas li.frenado {
          border-color: #fca5a5;
        }
        .tarjetas li.prendido {
          border-color: #86efac;
        }
        .caso-cabecera {
          display: flex;
          gap: 10px;
          align-items: baseline;
          flex-wrap: wrap;
        }
        .etiqueta {
          font-size: 12px;
          font-weight: 600;
          color: #475569;
        }
        textarea {
          width: 100%;
          min-height: 60px;
          margin: 10px 0 8px;
          padding: 8px 10px;
          border: 1px solid #e5e9f0;
          border-radius: 10px;
          font: inherit;
          font-size: 13px;
          box-sizing: border-box;
        }
        input {
          width: 80px;
          padding: 8px 10px;
          border: 1px solid #e5e9f0;
          border-radius: 10px;
          font: inherit;
        }
        .acciones {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          flex-wrap: wrap;
        }
        .aviso-error {
          color: #b91c1c;
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
      `}</style>
    </main>
  );
}
