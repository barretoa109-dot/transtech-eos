"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

/**
 * Los datos con los que el usuario factura.
 *
 * ============================================================
 * POR QUÉ ESTA PANTALLA DICE LO QUE NO PUEDE HACER
 * ============================================================
 *
 * Emitir una factura electrónica en Paraguay son cinco pasos, y dos de ellos no
 * dependen del software: el certificado digital lo compra el contribuyente a un
 * prestador habilitado, y el RUC lo habilita la SET.
 *
 * Una pantalla de configuración que no diga eso deja creer que completando el
 * formulario ya se está facturando electrónicamente. El que lo crea le va a
 * entregar comprobantes a sus clientes pensando que son facturas, y se va a
 * enterar de que no lo eran cuando tenga el problema con la SET encima.
 *
 * Por eso el estado del módulo va arriba, antes que el formulario.
 *
 * ============================================================
 * EL CERTIFICADO NO SE SUBE ACÁ
 * ============================================================
 *
 * Y no hay campo para hacerlo. Un `.p12` guardado en la base es la llave con la
 * que se puede facturar a nombre de otro: el día que se filtre un backup, se
 * filtró la identidad tributaria de todos. Cuando llegue el paso de la firma,
 * el certificado va a vivir en un almacén de secretos.
 */

type Config = {
  ruc: string;
  ruc_dv: number;
  razon_social: string;
  nombre_fantasia: string | null;
  tipo_contribuyente: number;
  timbrado_numero: string | null;
  timbrado_inicio: string | null;
  timbrado_fin: string | null;
  establecimiento: string;
  punto_expedicion: string;
  direccion: string | null;
  telefono: string | null;
  ambiente: string;
};

const VACIA = {
  ruc: "",
  ruc_dv: "",
  razon_social: "",
  nombre_fantasia: "",
  timbrado_numero: "",
  timbrado_inicio: "",
  timbrado_fin: "",
  establecimiento: "001",
  punto_expedicion: "001",
  direccion: "",
  telefono: "",
  tipo_contribuyente: "1",
};

export default function Emisor() {
  const [campos, setCampos] = useState(VACIA);
  const [configurado, setConfigurado] = useState(false);
  const [sinModulo, setSinModulo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [guardado, setGuardado] = useState(false);

  const cargar = useCallback(() => {
    return fetch("/api/facturacion/config", { cache: "no-store" })
      .then(async (respuesta) => {
        if (respuesta.status === 403) {
          setSinModulo(true);
          return;
        }

        const data = await respuesta.json().catch(() => null);
        const config = data?.config as Config | null;

        setConfigurado(Boolean(data?.configurado));

        if (config) {
          setCampos({
            ruc: config.ruc ?? "",
            ruc_dv: String(config.ruc_dv ?? ""),
            razon_social: config.razon_social ?? "",
            nombre_fantasia: config.nombre_fantasia ?? "",
            timbrado_numero: config.timbrado_numero ?? "",
            timbrado_inicio: config.timbrado_inicio ?? "",
            timbrado_fin: config.timbrado_fin ?? "",
            establecimiento: config.establecimiento ?? "001",
            punto_expedicion: config.punto_expedicion ?? "001",
            direccion: config.direccion ?? "",
            telefono: config.telefono ?? "",
            tipo_contribuyente: String(config.tipo_contribuyente ?? 1),
          });
        }
      })
      .catch((err) => console.error("No se pudo leer la configuración de facturación:", err))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function actualizar(campo: keyof typeof VACIA, valor: string) {
    setCampos((actual) => ({ ...actual, [campo]: valor }));
    setGuardado(false);
  }

  async function guardar() {
    if (guardando) return;

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/facturacion/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...campos,
          ruc_dv: campos.ruc_dv === "" ? undefined : Number(campos.ruc_dv),
          tipo_contribuyente: Number(campos.tipo_contribuyente),
        }),
      });

      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(resultado?.error || "No se pudo guardar.");

      setConfigurado(true);
      setGuardado(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  if (sinModulo) {
    return (
      <div className="card">
        <div className="card-title">La facturación electrónica se contrata aparte</div>
        <p className="prose">
          Emite documentos electrónicos sobre las ventas que ya cargás, sin volver a tipear nada.
        </p>
        <a className="reco-btn" href="/planes" style={{ display: "inline-flex", marginTop: 12 }}>
          Ver cómo sumarla
        </a>
      </div>
    );
  }

  if (cargando) return <p className="empty-note">Cargando…</p>;

  return (
    <>
      {/*
        El estado va ARRIBA del formulario, no abajo. Completar estos campos no
        habilita a facturar electrónicamente, y alguien tiene que decirlo antes
        de que la persona apriete guardar y se quede tranquila.
      */}
      <div className="card fin-card">
        <div className="fin-head">
          <span className="fin-badge fin-badge-atencion">
            <ShieldCheck size={14} />
            FACTURACIÓN — EN PREPARACIÓN
          </span>
        </div>

        <p className="prose" style={{ marginTop: 10 }}>
          Con estos datos EOS ya arma tus comprobantes: numeración correlativa, código de control
          (CDC) y el papel imprimible para tu cliente.
        </p>

        <p className="prose" style={{ marginTop: 8 }}>
          <strong>Todavía no son facturas electrónicas ante la SET.</strong> Para eso faltan dos
          cosas que no dependen de EOS: tu <strong>certificado digital</strong>, que se compra a un
          prestador habilitado, y la <strong>habilitación de tu RUC</strong> como facturador
          electrónico. Cuando las tengas, los mismos comprobantes se firman y se envían a SIFEN sin
          volver a cargar nada.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Datos del emisor</div>
        <div className="card-sub">
          Van impresos en cada comprobante y adentro del código de control.
        </div>

        <div className="neg-form">
          <input
            className="neg-input"
            placeholder="Razón social"
            value={campos.razon_social}
            maxLength={200}
            onChange={(e) => actualizar("razon_social", e.target.value)}
          />
          <input
            className="neg-input"
            placeholder="Nombre de fantasía"
            value={campos.nombre_fantasia}
            maxLength={200}
            onChange={(e) => actualizar("nombre_fantasia", e.target.value)}
          />
          <input
            className="neg-input"
            placeholder="RUC"
            inputMode="numeric"
            value={campos.ruc}
            onChange={(e) => actualizar("ruc", e.target.value.replace(/[^\d]/g, ""))}
          />
          <input
            className="neg-input neg-cantidad"
            placeholder="DV"
            inputMode="numeric"
            maxLength={1}
            value={campos.ruc_dv}
            onChange={(e) => actualizar("ruc_dv", e.target.value.replace(/[^\d]/g, ""))}
          />
          <select
            className="neg-input"
            value={campos.tipo_contribuyente}
            onChange={(e) => actualizar("tipo_contribuyente", e.target.value)}
          >
            <option value="1">Persona física</option>
            <option value="2">Persona jurídica</option>
          </select>
        </div>

        <div className="neg-form">
          <input
            className="neg-input"
            placeholder="Timbrado"
            inputMode="numeric"
            value={campos.timbrado_numero}
            onChange={(e) => actualizar("timbrado_numero", e.target.value.replace(/[^\d]/g, ""))}
          />
          <input
            className="neg-input"
            type="date"
            title="Inicio de vigencia del timbrado"
            value={campos.timbrado_inicio}
            onChange={(e) => actualizar("timbrado_inicio", e.target.value)}
          />
          <input
            className="neg-input"
            type="date"
            title="Fin de vigencia del timbrado"
            value={campos.timbrado_fin}
            onChange={(e) => actualizar("timbrado_fin", e.target.value)}
          />
          <input
            className="neg-input neg-cantidad"
            placeholder="Est."
            maxLength={3}
            value={campos.establecimiento}
            onChange={(e) => actualizar("establecimiento", e.target.value.replace(/[^\d]/g, ""))}
          />
          <input
            className="neg-input neg-cantidad"
            placeholder="Punto"
            maxLength={3}
            value={campos.punto_expedicion}
            onChange={(e) => actualizar("punto_expedicion", e.target.value.replace(/[^\d]/g, ""))}
          />
        </div>

        <div className="neg-form">
          <input
            className="neg-input"
            placeholder="Dirección"
            value={campos.direccion}
            maxLength={300}
            onChange={(e) => actualizar("direccion", e.target.value)}
          />
          <input
            className="neg-input"
            placeholder="Teléfono"
            value={campos.telefono}
            maxLength={40}
            onChange={(e) => actualizar("telefono", e.target.value)}
          />
        </div>

        {error && <p className="neg-error" role="alert">{error}</p>}
        {guardado && (
          <p className="prose" style={{ color: "var(--green)", fontSize: 13 }}>
            Guardado. Ya podés emitir comprobantes desde la pestaña Ventas.
          </p>
        )}

        <button type="button" className="reco-btn" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : configurado ? "Actualizar datos" : "Guardar datos"}
        </button>
      </div>
    </>
  );
}
