"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Tarjeta = {
  id: string;
  card_masked_number: string | null;
  card_brand: string | null;
  card_type: string | null;
  expiration_date: string | null;
  es_principal: boolean;
};

type Plan = {
  codigo: string;
  nombre: string;
  precio: number;
};

const PLANES: Record<string, { nombre: string; mensual: number; anual: number }> = {
  personal: { nombre: "EOS Personal", mensual: 99000, anual: 990000 },
  pro: { nombre: "EOS Pro", mensual: 249000, anual: 2490000 },
  business: { nombre: "EOS Business", mensual: 699000, anual: 6990000 },
};

const ESTILOS_IFRAME = {
  "form-background-color": "#ffffff",
  "button-background-color": "#1656bd",
  "button-text-color": "#ffffff",
  "button-border-color": "#1656bd",
  "input-background-color": "#f7fafc",
  "input-text-color": "#071226",
  "input-placeholder-color": "#94a3b8",
};

function guaranies(monto: number) {
  return `Gs. ${monto.toLocaleString("es-PY")}`;
}

declare global {
  interface Window {
    Bancard?: any;
  }
}

export default function PagoTarjeta() {
  const router = useRouter();
  const params = useSearchParams();

  const codigoPlan = (params.get("plan") || "pro").toLowerCase();
  const periodicidad = params.get("periodicidad") === "anual" ? "anual" : "mensual";

  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  const [seleccionada, setSeleccionada] = useState<string>("");
  const [cargando, setCargando] = useState(true);
  const [registrando, setRegistrando] = useState(false);
  const [pagando, setPagando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [exito, setExito] = useState<null | { plan: string; dias: number | null }>(null);

  const contenedorIframe = useRef<HTMLDivElement | null>(null);
  const [iframeActivo, setIframeActivo] = useState(false);
  /*
   * El desafío 3DS lo dibuja el banco emisor, no Bancard, y es mucho más
   * alto que el formulario de catastro: en 380px el botón de confirmar
   * queda abajo del pliegue y hay que scrollear DENTRO del iframe para
   * encontrarlo. Quien no lo descubre, abandona el pago con el código ya
   * escrito. No podemos medir el contenido porque es cross-origin, así
   * que se le da altura suficiente de entrada.
   */
  const [desafio3ds, setDesafio3ds] = useState(false);
  const [telefono, setTelefono] = useState("");
  const [pideTelefono, setPideTelefono] = useState(false);

  const definicion = PLANES[codigoPlan] || PLANES.pro;
  const plan: Plan = {
    codigo: codigoPlan,
    nombre: definicion.nombre,
    precio: periodicidad === "anual" ? definicion.anual : definicion.mensual,
  };

  const cargarTarjetas = useCallback(async () => {
    try {
      const res = await fetch("/api/pagos/bancard/tarjetas", { cache: "no-store" });

      if (res.status === 401) {
        router.replace(`/login?next=/pago/tarjeta?plan=${codigoPlan}`);
        return;
      }

      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "No pudimos cargar tus tarjetas.");

      const lista: Tarjeta[] = data.tarjetas || [];

      setTarjetas(lista);
      setSeleccionada((actual) => {
        if (actual && lista.some((t) => t.id === actual)) return actual;
        const principal = lista.find((t) => t.es_principal) || lista[0];
        return principal ? principal.id : "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar tus tarjetas.");
    } finally {
      setCargando(false);
    }
  }, [codigoPlan, router]);

  useEffect(() => {
    cargarTarjetas();
  }, [cargarTarjetas]);


  const sincronizar = useCallback(async () => {
    setAviso("Confirmando la tarjeta con Bancard...");

    try {
      const res = await fetch("/api/pagos/bancard/tarjetas/sincronizar", {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "No pudimos confirmar la tarjeta.");

      const lista: Tarjeta[] = data.tarjetas || [];

      setTarjetas(lista);
      setSeleccionada(lista.find((t) => t.es_principal)?.id || lista[0]?.id || "");
      setIframeActivo(false);
      setAviso("Tarjeta registrada correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos confirmar la tarjeta.");
      setAviso("");
    }
  }, []);

  /*
   * El iframe de Bancard avisa el resultado del catastro por postMessage.
   * Los datos reales de la tarjeta no vienen en ese mensaje: hay que
   * pedirlos después con la sincronización.
   */
  useEffect(() => {
    function alRecibirMensaje(evento: MessageEvent) {
      const dato =
        typeof evento.data === "string"
          ? (() => {
              try {
                return JSON.parse(evento.data);
              } catch {
                return null;
              }
            })()
          : evento.data;

      const estado = dato?.status || dato?.message?.status;

      if (estado === "add_new_card_success") {
        sincronizar();
      }

      if (estado === "add_new_card_fail") {
        setIframeActivo(false);
        setAviso("");
        setError(
          dato?.description ||
            "Bancard no pudo registrar la tarjeta. Verificá los datos e intentá otra vez.",
        );
      }
    }

    window.addEventListener("message", alRecibirMensaje);

    return () => window.removeEventListener("message", alRecibirMensaje);
  }, [sincronizar]);

  /*
   * Bancard puede cerrar el catastro redirigiendo a return_url en lugar
   * de sólo emitir el postMessage. Si volvemos con ?tarjeta=, hay que
   * sincronizar igual, o la tarjeta queda registrada en Bancard pero
   * "pendiente" de nuestro lado.
   */
  const tarjetaDeVuelta = params.get("tarjeta");
  const yaSincronizado = useRef(false);

  useEffect(() => {
    if (!tarjetaDeVuelta || yaSincronizado.current) return;

    yaSincronizado.current = true;
    sincronizar();
  }, [tarjetaDeVuelta, sincronizar]);

  /*
   * Vuelta del pago ocasional: Bancard redirige con ?ref=. El pago lo
   * confirma el webhook, así que acá sólo se consulta cómo quedó.
   */
  const refPago = params.get("ref");
  const cancelado = params.get("cancelado");
  const yaConsultado = useRef(false);

  useEffect(() => {
    if (!refPago || yaConsultado.current) return;

    yaConsultado.current = true;

    if (cancelado) {
      setAviso("Cancelaste el pago. Podés intentarlo de nuevo cuando quieras.");
      return;
    }

    let cancelada = false;

    (async () => {
      setAviso("Confirmando tu pago...");

      // El webhook puede tardar un instante en llegar.
      for (let intento = 0; intento < 6 && !cancelada; intento += 1) {
        const res = await fetch(
          `/api/pagos/bancard/estado?ref=${encodeURIComponent(refPago)}`,
          { cache: "no-store" },
        );
        const data = await res.json().catch(() => null);

        if (data?.estado === "pagado") {
          setExito({ plan: data.plan || plan.codigo, dias: data.dias_acreditados ?? null });
          return;
        }

        if (data?.estado === "rechazado") {
          setAviso("");
          setError("El pago no pudo completarse. Probá con otra tarjeta.");
          return;
        }

        await new Promise((r) => setTimeout(r, 1500));
      }

      if (!cancelada) {
        setAviso(
          "Estamos confirmando tu pago con Bancard. Si no se actualiza en unos minutos, escribinos.",
        );
      }
    })();

    return () => {
      cancelada = true;
    };
  }, [refPago, cancelado, plan.codigo]);

  async function cargarScriptBancard(baseUrl: string) {
    if (window.Bancard) return;

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${baseUrl}/checkout/javascript/dist/bancard-checkout-4.0.0.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar el formulario de Bancard."));
      document.body.appendChild(script);
    });
  }

  async function registrarTarjeta() {
    setError("");
    setAviso("");
    setRegistrando(true);

    try {
      const res = await fetch("/api/pagos/bancard/tarjetas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: plan.codigo,
          periodicidad,
          ...(telefono ? { telefono } : {}),
        }),
      });
      const data = await res.json();

      // Bancard exige el teléfono y la cuenta puede no tenerlo cargado.
      if (res.status === 400 && data?.code === "telefono_requerido") {
        setPideTelefono(true);
        setError("Ingresá tu número de teléfono para continuar.");
        return;
      }

      if (!res.ok) throw new Error(data?.error || "No pudimos iniciar el registro.");

      setPideTelefono(false);

      await cargarScriptBancard(data.iframe_base_url);

      setDesafio3ds(false);
      setIframeActivo(true);

      // El contenedor recién existe después de renderizar.
      setTimeout(() => {
        if (!window.Bancard?.Cards?.createForm) {
          setError("No se pudo cargar el formulario de Bancard.");
          setIframeActivo(false);
          return;
        }

        window.Bancard.Cards.createForm(
          "bancard-iframe",
          data.process_id,
          ESTILOS_IFRAME,
        );
      }, 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos iniciar el registro.");
    } finally {
      setRegistrando(false);
    }
  }

  /*
   * Pago ocasional: la tarjeta se carga en el iframe de Bancard y no
   * queda guardada. El resultado lo confirma el webhook, así que al
   * volver se consulta el estado de la solicitud.
   */
  async function pagarSinGuardar() {
    setError("");
    setAviso("");
    setPagando(true);

    try {
      const res = await fetch("/api/pagos/bancard/ocasional", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: plan.codigo, periodicidad }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "No pudimos iniciar el pago.");

      await cargarScriptBancard(data.iframe_base_url);

      setDesafio3ds(false);
      setIframeActivo(true);

      setTimeout(() => {
        if (!window.Bancard?.Checkout?.createForm) {
          setError("No se pudo cargar el formulario de Bancard.");
          setIframeActivo(false);
          return;
        }

        window.Bancard.Checkout.createForm(
          "bancard-iframe",
          data.process_id,
          ESTILOS_IFRAME,
        );
      }, 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos iniciar el pago.");
    } finally {
      setPagando(false);
    }
  }

  async function pagar() {
    if (!seleccionada) {
      setError("Elegí una tarjeta para pagar.");
      return;
    }

    setError("");
    setAviso("");
    setPagando(true);

    try {
      const res = await fetch("/api/pagos/bancard/cobrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: plan.codigo,
          periodicidad,
          tarjeta_id: seleccionada,
        }),
      });

      const data = await res.json();

      // Verificación adicional del banco emisor.
      if (res.ok && data?.requiere_3ds && data?.process_id) {
        await cargarScriptBancard(data.iframe_base_url);

        setDesafio3ds(true);
        setIframeActivo(true);

        setTimeout(() => {
          window.Bancard?.Charge3DS?.createForm(
            "bancard-iframe",
            data.process_id,
            ESTILOS_IFRAME,
          );
        }, 60);

        setAviso("Tu banco pide una verificación adicional.");
        return;
      }

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || "No pudimos procesar el pago.");
      }

      setExito({ plan: data.plan || plan.codigo, dias: data.dias_acreditados ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos procesar el pago.");
    } finally {
      setPagando(false);
    }
  }

  if (exito) {
    return (
      <main className="pago-tarjeta">
        <div className="tarjeta-panel exito">
          <div className="check">✓</div>
          <h1>Pago confirmado</h1>
          <p>
            Tu plan <strong>{exito.plan}</strong> quedó activo
            {exito.dias ? ` por ${exito.dias} días` : ""}.
          </p>
          <button type="button" onClick={() => router.push("/eos/chat")}>
            Ir a EOS
          </button>
        </div>
        <EstilosPago />
      </main>
    );
  }

  return (
    <main className="pago-tarjeta">
      <div className="tarjeta-panel">
        <p className="eyebrow">PAGO CON TARJETA</p>
        <h1>{plan.nombre}</h1>
        <p className="monto">
          {guaranies(plan.precio)}
          <span> / {periodicidad === "anual" ? "año" : "mes"}</span>
        </p>

        {error && <div className="alerta error">{error}</div>}
        {aviso && <div className="alerta info">{aviso}</div>}

        {cargando ? (
          <p className="cargando">Cargando tus tarjetas...</p>
        ) : (
          <>
            {tarjetas.length > 0 && !iframeActivo && (
              <div className="lista-tarjetas">
                {tarjetas.map((tarjeta) => (
                  <label
                    key={tarjeta.id}
                    className={seleccionada === tarjeta.id ? "tarjeta activa" : "tarjeta"}
                  >
                    <input
                      type="radio"
                      name="tarjeta"
                      checked={seleccionada === tarjeta.id}
                      onChange={() => setSeleccionada(tarjeta.id)}
                    />
                    <span className="marca">{tarjeta.card_brand || "Tarjeta"}</span>
                    <span className="numero">
                      {tarjeta.card_masked_number || "•••• ••••"}
                    </span>
                    {tarjeta.expiration_date && (
                      <span className="vence">{tarjeta.expiration_date}</span>
                    )}
                  </label>
                ))}
              </div>
            )}

            {iframeActivo && (
              <div className="iframe-wrap">
                <div
                  id="bancard-iframe"
                  className={desafio3ds ? "desafio" : ""}
                  ref={contenedorIframe}
                />
                <button
                  type="button"
                  className="secundario"
                  onClick={() => {
                    setIframeActivo(false);
                    setAviso("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            )}

            {pideTelefono && !iframeActivo && (
              <div className="campo-telefono">
                <label htmlFor="telefono-bancard">Teléfono</label>
                <input
                  id="telefono-bancard"
                  type="tel"
                  inputMode="tel"
                  placeholder="0981 123 456"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                />
              </div>
            )}

            {!iframeActivo && (
              <div className="acciones">
                {tarjetas.length > 0 && (
                  <button
                    type="button"
                    className="principal"
                    onClick={pagar}
                    disabled={pagando || !seleccionada}
                  >
                    {pagando ? "Procesando..." : `Pagar ${guaranies(plan.precio)}`}
                  </button>
                )}

                <button
                  type="button"
                  className={tarjetas.length > 0 ? "secundario" : "principal"}
                  onClick={registrarTarjeta}
                  disabled={registrando || (pideTelefono && !telefono.trim())}
                >
                  {registrando
                    ? "Abriendo formulario..."
                    : tarjetas.length > 0
                      ? "Usar otra tarjeta"
                      : "Registrar mi tarjeta"}
                </button>

                <button
                  type="button"
                  className="enlace"
                  onClick={pagarSinGuardar}
                  disabled={pagando}
                >
                  Pagar sin guardar mi tarjeta
                </button>
              </div>
            )}

            <p className="nota">
              Tus datos de tarjeta los procesa Bancard en su entorno seguro (PCI).
              TransTech nunca los ve ni los guarda.
            </p>

            <a className="alternativa" href={`/pago?plan=${plan.codigo}&periodicidad=${periodicidad}`}>
              Prefiero pagar por transferencia
            </a>
          </>
        )}
      </div>

      <EstilosPago />
    </main>
  );
}

function EstilosPago() {
  return (
    <style jsx global>{`
      .pago-tarjeta {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px 20px;
        background: linear-gradient(180deg, #ffffff 0%, #f5f9ff 52%, #edf4ff 100%);
        font-family: Inter, Arial, Helvetica, sans-serif;
        color: #071226;
      }
      .tarjeta-panel {
        width: 100%;
        max-width: 480px;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 22px;
        padding: 32px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
      }
      .tarjeta-panel .eyebrow {
        margin: 0;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.16em;
        color: #1656bd;
      }
      .tarjeta-panel h1 {
        margin: 10px 0 4px;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .tarjeta-panel .monto {
        margin: 0 0 22px;
        font-size: 26px;
        font-weight: 800;
      }
      .tarjeta-panel .monto span {
        font-size: 14px;
        font-weight: 600;
        color: #64748b;
      }
      .alerta {
        border-radius: 12px;
        padding: 12px 14px;
        font-size: 14px;
        line-height: 1.5;
        margin-bottom: 16px;
      }
      .alerta.error {
        background: rgba(220, 38, 38, 0.08);
        border: 1px solid rgba(220, 38, 38, 0.25);
        color: #b91c1c;
      }
      .alerta.info {
        background: rgba(22, 86, 189, 0.08);
        border: 1px solid rgba(22, 86, 189, 0.22);
        color: #1656bd;
      }
      .cargando {
        color: #64748b;
      }
      .lista-tarjetas {
        display: grid;
        gap: 10px;
        margin-bottom: 20px;
      }
      .lista-tarjetas .tarjeta {
        display: flex;
        align-items: center;
        gap: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 14px;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
      }
      .lista-tarjetas .tarjeta.activa {
        border-color: #1656bd;
        background: #f2f7ff;
      }
      .lista-tarjetas .marca {
        font-weight: 700;
        font-size: 13px;
      }
      .lista-tarjetas .numero {
        font-family: ui-monospace, monospace;
        font-size: 13px;
        color: #475569;
      }
      .lista-tarjetas .vence {
        margin-left: auto;
        font-size: 12px;
        color: #94a3b8;
      }
      .campo-telefono {
        display: grid;
        gap: 6px;
        margin-bottom: 16px;
      }
      .campo-telefono label {
        font-size: 13px;
        font-weight: 700;
      }
      .campo-telefono input {
        min-height: 48px;
        border: 1px solid #cbd5f5;
        border-radius: 12px;
        padding: 0 14px;
        font-size: 15px;
        color: #071226;
        background: #f7fafc;
      }
      .iframe-wrap {
        margin-bottom: 18px;
      }
      #bancard-iframe {
        min-width: 320px;
        min-height: 380px;
      }
      #bancard-iframe iframe {
        width: 100%;
        min-height: 380px;
        border: 0;
      }
      #bancard-iframe.desafio,
      #bancard-iframe.desafio iframe {
        min-height: 640px;
      }
      .acciones {
        display: grid;
        gap: 10px;
      }
      .pago-tarjeta button {
        min-height: 50px;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 800;
        cursor: pointer;
        border: 1px solid transparent;
        transition: transform 0.12s, background 0.15s;
      }
      .pago-tarjeta button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .pago-tarjeta button.principal {
        background: #1656bd;
        color: #fff;
      }
      .pago-tarjeta button.principal:not(:disabled):hover {
        background: #113f8c;
      }
      .pago-tarjeta button.enlace {
        background: transparent;
        border: 0;
        min-height: 36px;
        font-size: 13px;
        font-weight: 700;
        color: #64748b;
        text-decoration: underline;
      }
      .pago-tarjeta button.enlace:not(:disabled):hover {
        color: #1656bd;
      }
      .pago-tarjeta button.secundario {
        background: #fff;
        color: #1656bd;
        border-color: #cbd5f5;
        width: 100%;
      }
      .nota {
        margin: 18px 0 0;
        font-size: 12px;
        line-height: 1.6;
        color: #64748b;
      }
      .alternativa {
        display: inline-block;
        margin-top: 14px;
        font-size: 13px;
        font-weight: 700;
        color: #1656bd;
        text-decoration: none;
      }
      .tarjeta-panel.exito {
        text-align: center;
      }
      .tarjeta-panel.exito .check {
        width: 62px;
        height: 62px;
        margin: 0 auto 14px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: rgba(22, 163, 74, 0.12);
        color: #16a34a;
        font-size: 30px;
        font-weight: 800;
      }
      .tarjeta-panel.exito button {
        margin-top: 18px;
        width: 100%;
        background: #1656bd;
        color: #fff;
      }
    `}</style>
  );
}
