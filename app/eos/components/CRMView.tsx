"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, Handshake, MessageCircle, TrendingUp, Users } from "lucide-react";
import ConversacionesWA from "./ConversacionesWA";
import SeguimientosCRM from "./SeguimientosCRM";
import FichaCliente from "./FichaCliente";
import Embudo from "./negocio/Embudo";
import FilaContacto from "./negocio/FilaContacto";
import type { Contacto } from "./negocio/tipos";

/**
 * El CRM, separado del ERP.
 *
 * ============================================================
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ============================================================
 *
 * Hasta acá, Contactos y el embudo de oportunidades vivían como dos pestañas
 * más dentro de `NegocioView.tsx`, bajo el título "Tu ERP y tu CRM". A nivel
 * de base y de motor de indicadores, ERP y CRM ya estaban separados desde
 * siempre (`eos_erp_*` vs `eos_crm_*`, y hasta el módulo que se factura es
 * distinto: "crm" existe como anexo propio desde el 25 de agosto). Lo único
 * que faltaba separar era la pantalla, y eso es lo que hace este archivo.
 *
 * No se movió lógica de negocio: `Embudo` ya era su propio componente y
 * seguía viviendo en `./negocio/Embudo.tsx` (se sigue reutilizando tal cual,
 * solo cambia quién lo renderiza). Lo único que se trasladó fue el
 * formulario+lista de contactos, que vivía como una función interna de
 * `NegocioView.tsx` (`Clientes`) y ahora es la pestaña "Contactos" de acá.
 *
 * ============================================================
 * POR QUÉ SIGUE USANDO `/api/erp/contactos`
 * ============================================================
 *
 * Esa ruta no es "de ERP" en el sentido de que solo sirva al ERP: acepta a
 * cualquiera con el módulo `crm` O `erp` (`exigirAlgunModulo(["crm","erp"])`,
 * ver `app/api/erp/contactos/route.ts`), porque un contacto es el mismo
 * objeto en la venta, en la compra y en el embudo (ver `negocio/tipos.ts`).
 * Cambiarle el nombre a la ruta para que "sonara" a CRM sería tocar una API
 * que ya funciona para ambos módulos, sin ganar nada — exactamente lo que el
 * encargo pide evitar.
 */

type Pestania = "seguimientos" | "oportunidades" | "contactos" | "conversaciones";

const PESTANIAS: { clave: Pestania; etiqueta: string; detalle: string; icono: typeof TrendingUp }[] = [
  { clave: "seguimientos", etiqueta: "Para retomar", detalle: "A quién escribirle hoy", icono: BellRing },
  { clave: "oportunidades", etiqueta: "Oportunidades", detalle: "Embudo y seguimiento", icono: TrendingUp },
  { clave: "contactos", etiqueta: "Contactos", detalle: "Clientes y proveedores", icono: Users },
  { clave: "conversaciones", etiqueta: "Conversaciones", detalle: "WhatsApp con tus clientes", icono: MessageCircle },
];

type CRMViewProps = {
  /** Abre el chat completo — misma convención que en NegocioView/GastosView. */
  onOpenChat?: () => void;
  /** Con qué pestaña abrir, si algo de afuera lo pide (ver chat/page.tsx). */
  pestaniaInicial?: Pestania;
};

export default function CRMView({ onOpenChat, pestaniaInicial }: CRMViewProps) {
  const [pestania, setPestania] = useState<Pestania>(pestaniaInicial ?? "seguimientos");
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [sinModulo, setSinModulo] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  const resumen = useMemo(
    () => ({
      contactos: contactos.length,
      clientes: contactos.filter((c) => c.es_cliente).length,
    }),
    [contactos],
  );

  const cargar = useCallback(() => {
    return fetch("/api/erp/contactos", { cache: "no-store" })
      .then(async (respuesta) => {
        if (respuesta.status === 401) throw new Error("SESSION_EXPIRED");

        // 403 acá significa "ni CRM ni ERP contratados": sin ninguno de los
        // dos módulos no hay ni un contacto que mostrar. Igual que en
        // NegocioView, no es un error: es una invitación.
        if (respuesta.status === 403) {
          setSinModulo(true);
          return;
        }

        if (!respuesta.ok) throw new Error("CRM_UNAVAILABLE");

        const datos = await respuesta.json().catch(() => null);
        setSinModulo(false);
        setError("");
        setContactos(datos?.contactos ?? []);
      })
      .catch((err) => {
        console.error("No se pudo cargar el CRM:", err);
        setError(
          err instanceof Error && err.message === "SESSION_EXPIRED"
            ? "Tu sesión venció. Volvé a iniciar sesión para cargar tus datos reales."
            : "No pudimos cargar tus contactos. No los mostramos vacíos porque podrían existir: reintentá la carga.",
        );
      })
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (sinModulo) {
    return (
      <div className="view" id="view-crm">
        <div className="page page-in">
          <div className="page-header">
            <div className="page-eyebrow">CRM</div>
            <div className="page-title">Tu gestión comercial</div>
            <div className="page-sub">Clientes, oportunidades y seguimiento, conectados con EOS.</div>
          </div>

          <div className="card">
            <div className="card-title">Todavía no lo tenés activo</div>
            <p className="prose">
              Con el CRM, EOS lleva tu embudo de ventas y lo que quedó pendiente con cada
              cliente, sobre el mismo contexto que ya tiene de vos.
            </p>
            <a className="reco-btn" href="/planes" style={{ display: "inline-flex", marginTop: 12 }}>
              Ver cómo sumarlo
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view" id="view-crm">
      <div className="page page-in">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="page-header">
            <div className="page-eyebrow">CRM</div>
            <div className="page-title">Tu gestión comercial</div>
            <div className="page-sub">Clientes, oportunidades y seguimiento, conectados con EOS.</div>
          </div>
          {onOpenChat && (
            <button type="button" className="ghost-btn" onClick={onOpenChat} style={{ flexShrink: 0 }}>
              Preguntale a EOS
            </button>
          )}
        </div>

        {!cargando && !error && (
          <div className="neg-resumen" aria-label="Resumen comercial">
            <button type="button" className="neg-resumen-card is-primary" onClick={() => setPestania("oportunidades")}>
              <Handshake size={17} />
              <span>Oportunidades</span>
              <strong>Ver embudo</strong>
              <small>Seguimiento y avance</small>
            </button>
            <button type="button" className="neg-resumen-card" onClick={() => setPestania("contactos")}>
              <Users size={17} />
              <span>Contactos</span>
              <strong>{resumen.contactos}</strong>
              <small>{resumen.clientes} clientes</small>
            </button>
          </div>
        )}

        <div className="neg-nav-groups" role="navigation" aria-label="Áreas del CRM">
          <div className="neg-nav-group">
            <div className="neg-nav">
              {PESTANIAS.map((p) => (
                <button
                  key={p.clave}
                  type="button"
                  className={`neg-nav-item ${pestania === p.clave ? "active" : ""}`}
                  onClick={() => setPestania(p.clave)}
                  aria-current={pestania === p.clave ? "page" : undefined}
                >
                  <span>{p.etiqueta}</span>
                  <small>{p.detalle}</small>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="neg-load-error" role="alert">
            <div>
              <strong>No mostramos vacío si no pudimos verificar los datos</strong>
              <p>{error}</p>
              <button type="button" className="chip" onClick={() => { setError(""); setCargando(true); void cargar(); }}>
                Reintentar
              </button>
            </div>
          </div>
        )}

        {cargando ? (
          <p className="empty-note">Cargando tu CRM…</p>
        ) : error ? null : pestania === "seguimientos" ? (
          <SeguimientosCRM onIrAConversaciones={() => setPestania("conversaciones")} />
        ) : pestania === "oportunidades" ? (
          <Embudo contactos={contactos} />
        ) : pestania === "conversaciones" ? (
          <ConversacionesWA />
        ) : (
          <Contactos contactos={contactos} onCambio={() => void cargar()} />
        )}
      </div>
    </div>
  );
}

/* ============================================================
   CONTACTOS
   ============================================================
   Movido tal cual desde `NegocioView.tsx` (era la función `Clientes`):
   mismo formulario, misma validación de RUC en el servidor, mismo
   `FilaContacto` para editar. Solo cambió dónde vive. */

function Contactos({ contactos, onCambio }: { contactos: Contacto[]; onCambio: () => void }) {
  // Con una ficha abierta, la ficha reemplaza a la lista: es la misma pestaña, un nivel más adentro.
  const [fichaId, setFichaId] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [ruc, setRuc] = useState("");
  const [rucDv, setRucDv] = useState("");
  const [telefono, setTelefono] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!nombre.trim() || guardando) return;

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/erp/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          ruc: ruc || null,
          ruc_dv: rucDv === "" ? undefined : Number(rucDv),
          telefono: telefono || null,
        }),
      });

      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(resultado?.error || "No se pudo guardar.");

      setNombre("");
      setRuc("");
      setRucDv("");
      setTelefono("");
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  if (fichaId) {
    return <FichaCliente contactoId={fichaId} onVolver={() => { setFichaId(null); onCambio(); }} />;
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Nuevo cliente</div>
        <div className="card-sub">
          El RUC se valida al guardarlo: un dígito mal no se descubre hasta que la factura se
          rechaza, y para entonces el cliente ya se llevó el comprobante.
        </div>

        <div className="neg-form">
          <input
            className="neg-input"
            placeholder="Nombre o razón social"
            value={nombre}
            maxLength={160}
            onChange={(e) => setNombre(e.target.value)}
          />
          <input
            className="neg-input"
            placeholder="RUC (opcional)"
            inputMode="numeric"
            value={ruc}
            onChange={(e) => setRuc(e.target.value.replace(/[^\d]/g, ""))}
          />
          <input
            className="neg-input neg-cantidad"
            placeholder="DV"
            inputMode="numeric"
            maxLength={1}
            value={rucDv}
            onChange={(e) => setRucDv(e.target.value.replace(/[^\d]/g, ""))}
          />
          <input
            className="neg-input"
            placeholder="Teléfono"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
          />
        </div>

        {error && <p className="neg-error" role="alert">{error}</p>}

        <button type="button" className="reco-btn" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Agregar"}
        </button>
      </div>

      <div className="card">
        <div className="card-title">Tu gente</div>

        {contactos.length === 0 ? (
          <p className="empty-note">Todavía no cargaste clientes.</p>
        ) : (
          <div className="neg-lista">
            {contactos.map((c) => (
              <FilaContacto key={c.id} contacto={c} onCambio={onCambio} onFicha={(x) => setFichaId(x.id)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
