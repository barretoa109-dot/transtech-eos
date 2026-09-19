"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Conectar el WhatsApp Business de la empresa.
 *
 * Manda los datos a `POST /api/crm/whatsapp/canal`, que prueba el token contra Meta
 * ANTES de guardar nada, lo pasa a Vault y devuelve solo lo que hace falta para
 * terminar en Meta (el token de verificación del webhook).
 *
 * El token y el secreto de la app se escriben acá una vez y no vuelven a mostrarse:
 * la pantalla no tiene forma de leerlos de nuevo, a propósito.
 */

export function urlDelWebhook(): string {
  return typeof window === "undefined" ? "/api/whatsapp/webhook" : `${window.location.origin}/api/whatsapp/webhook`;
}

export function Copiable({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1600);
    } catch {
      /* sin portapapeles: la persona puede seleccionar el texto a mano */
    }
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <small style={{ color: "var(--muted)", display: "block" }}>{etiqueta}</small>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <code style={{ flex: 1, overflowWrap: "anywhere", fontSize: 12 }}>{valor}</code>
        <button type="button" className="ghost-btn" onClick={copiar} aria-label={`Copiar ${etiqueta}`}>
          {copiado ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

/** Los pasos que quedan del lado de Meta. Se muestran al conectar y en los ajustes. */
export function InstruccionesWebhook({ verifyToken, conAppPropia }: { verifyToken: string; conAppPropia: boolean }) {
  return (
    <div className="card" style={{ background: "var(--panel)" }}>
      <div className="card-title">Último paso, en Meta</div>
      <p className="prose" style={{ fontSize: 13 }}>
        Para que los mensajes de tus clientes lleguen a EOS, en tu app de Meta andá a{" "}
        <strong>WhatsApp → Configuración → Webhook</strong> y pegá estos dos datos:
      </p>
      <Copiable etiqueta="URL de devolución de llamada" valor={urlDelWebhook()} />
      <Copiable etiqueta="Token de verificación" valor={verifyToken} />
      <p className="prose" style={{ fontSize: 13 }}>
        Después suscribite a los campos <strong>messages</strong> y <strong>message_template_status_update</strong>.
        {conAppPropia
          ? " Como cargaste el secreto de tu app, EOS valida con él los mensajes que le llegan."
          : " Si usás una app de Meta propia, volvé a conectar el canal y cargá también el secreto de esa app: sin él, EOS no puede validar que los mensajes vengan de Meta."}
      </p>
    </div>
  );
}

type Props = { onConectado: () => void; reconexion?: boolean };

export default function ConectarWhatsApp({ onConectado, reconexion = false }: Props) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [token, setToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [campoConError, setCampoConError] = useState("");
  const [listo, setListo] = useState<{ verify_token: string; conAppPropia: boolean } | null>(null);

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;

    setEnviando(true);
    setError("");
    setCampoConError("");

    try {
      const respuesta = await fetch("/api/crm/whatsapp/canal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          token,
          app_secret: appSecret,
          nombre_visible: nombre,
        }),
      });

      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) {
        setError(datos?.error || "No pudimos conectar el número.");
        setCampoConError(datos?.campo || "");
        return;
      }

      // El token ya está en Vault: se borra de la memoria de la pantalla.
      setToken("");
      setAppSecret("");
      setListo({ verify_token: datos.webhook.verify_token, conAppPropia: Boolean(appSecret) });
      onConectado();
    } catch {
      setError("No pudimos comunicarnos con el servidor. Reintentá en un momento.");
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <>
        <div className="card">
          <div className="card-title">✓ Número conectado</div>
          <p className="prose">
            Ya podés contestarles a tus clientes desde acá. Falta un último paso para que también
            <strong> te lleguen</strong> sus mensajes.
          </p>
        </div>
        <InstruccionesWebhook verifyToken={listo.verify_token} conAppPropia={listo.conAppPropia} />
      </>
    );
  }

  const conError = (campo: string) => (campoConError === campo ? { borderColor: "var(--red)" } : undefined);

  return (
    <form className="card" onSubmit={conectar}>
      <div className="card-title">{reconexion ? "Volver a conectar tu WhatsApp" : "Conectá el WhatsApp de tu empresa"}</div>
      <p className="prose">
        Este es el WhatsApp con el que tus <strong>clientes</strong> te escriben, distinto del que usás
        para hablar con EOS. Necesitás una cuenta de <strong>WhatsApp Business</strong> en Meta. EOS prueba
        el token antes de guardar nada, y lo guarda cifrado: no vuelve a mostrarse.
      </p>

      <div className="neg-form" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <label className="neg-field">
          <span>ID del número de teléfono</span>
          <input
            className="neg-input"
            style={conError("phone_number_id")}
            inputMode="numeric"
            placeholder="Ej. 109876543210987"
            value={phoneNumberId}
            onChange={(ev) => setPhoneNumberId(ev.target.value.replace(/[^\d]/g, ""))}
            required
          />
          <small style={{ color: "var(--muted)" }}>Meta → WhatsApp Manager → Configuración de la API.</small>
        </label>

        <label className="neg-field">
          <span>ID de la cuenta de WhatsApp Business</span>
          <input
            className="neg-input"
            style={conError("waba_id")}
            inputMode="numeric"
            placeholder="Ej. 123456789012345"
            value={wabaId}
            onChange={(ev) => setWabaId(ev.target.value.replace(/[^\d]/g, ""))}
          />
          <small style={{ color: "var(--muted)" }}>Se necesita para crear plantillas de mensaje. Podés cargarlo después.</small>
        </label>

        <label className="neg-field">
          <span>Token de acceso</span>
          <input
            className="neg-input"
            style={conError("token")}
            type="password"
            autoComplete="off"
            placeholder="EAAG…"
            value={token}
            onChange={(ev) => setToken(ev.target.value)}
            required
          />
          <small style={{ color: "var(--muted)" }}>
            Un token permanente (de usuario del sistema) con permiso <em>whatsapp_business_messaging</em>. Pegalo entero.
          </small>
        </label>

        <label className="neg-field">
          <span>Secreto de la app de Meta (opcional)</span>
          <input
            className="neg-input"
            style={conError("app_secret")}
            type="password"
            autoComplete="off"
            value={appSecret}
            onChange={(ev) => setAppSecret(ev.target.value)}
          />
          <small style={{ color: "var(--muted)" }}>
            Solo si usás tu propia app de Meta: con él EOS comprueba que los mensajes que recibe vengan de Meta.
          </small>
        </label>

        <label className="neg-field">
          <span>Nombre para mostrar (opcional)</span>
          <input className="neg-input" value={nombre} maxLength={120} onChange={(ev) => setNombre(ev.target.value)} />
        </label>
      </div>

      {error && (
        <p className="neg-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="reco-btn" disabled={enviando || !phoneNumberId || !token}>
        {enviando ? "Probando el acceso…" : "Conectar"}
      </button>
    </form>
  );
}
