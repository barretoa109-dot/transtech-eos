"use client";

import { useState } from "react";
import { Building2, Pencil, Phone } from "lucide-react";
import Confirmar from "./Confirmar";
import type { Contacto } from "./tipos";

/**
 * Una fila de la agenda, editable en el lugar.
 *
 * El campo que más se corrige es el RUC, y casi siempre tarde: el cliente lo
 * trae recién el día que pide factura. Sin poder editarlo había que crear un
 * contacto nuevo, y desde ahí las ventas del mismo cliente quedan repartidas
 * entre dos fichas.
 *
 * El dígito verificador se deja vacío a propósito. El servidor lo calcula solo
 * cuando no viene, y si el que se escribe no cierra con el RUC devuelve el
 * error antes de guardar — que es mejor que descubrirlo cuando SIFEN rechaza
 * una factura ya entregada.
 */

type Props = { contacto: Contacto; onCambio: () => void };

export default function FilaContacto({ contacto, onCambio }: Props) {
  const [editando, setEditando] = useState(false);

  /** La baja es lógica: el historial que ya lo nombra no se toca. */
  async function darDeBaja() {
    const respuesta = await fetch(`/api/erp/contactos/${contacto.id}`, { method: "DELETE" });

    if (!respuesta.ok) {
      const datos = await respuesta.json().catch(() => null);
      window.alert(datos?.error || "No pudimos darlo de baja.");
      return;
    }

    onCambio();
  }

  const rol =
    contacto.es_proveedor && contacto.es_cliente
      ? "cliente y proveedor"
      : contacto.es_proveedor
        ? "proveedor"
        : "cliente";

  return (
    <div className="neg-fila">
      <div className="crm-contacto-icono" aria-hidden="true">
        <Building2 size={16} />
      </div>
      <div className="neg-fila-texto">
        <strong>{contacto.nombre}</strong>
        <small>
          {contacto.ruc
            ? `RUC ${contacto.ruc}${contacto.ruc_dv !== null ? `-${contacto.ruc_dv}` : ""}`
            : "Sin RUC"}
          {contacto.telefono ? ` · ${contacto.telefono}` : ""}
        </small>
      </div>

      <span className="neg-estado">{rol}</span>

      {contacto.telefono && !editando && (
        <a className="chip crm-contacto-accion" href={`tel:${contacto.telefono}`} aria-label={`Llamar a ${contacto.nombre}`}>
          <Phone size={11} /> Llamar
        </a>
      )}

      {/*
        Igual que en el producto: la ruta de baja existía y nadie la
        llamaba. Un contacto cargado con el nombre mal escrito se quedaba
        para siempre, y el segundo intento creaba el duplicado.
      */}
      {!editando && (
        <Confirmar
          etiqueta="Dar de baja"
          peligro
          consecuencia={
            `"${contacto.nombre}" deja de aparecer al cargar ventas y compras. ` +
            "Los documentos que ya lo tienen siguen mostrándolo. No se borra nada."
          }
          confirmar="Sí, darlo de baja"
          onConfirmar={() => void darDeBaja()}
        />
      )}

      {editando ? (
        <Editar
          contacto={contacto}
          onCerrar={() => setEditando(false)}
          onListo={() => {
            setEditando(false);
            onCambio();
          }}
        />
      ) : (
        <button type="button" className="chip crm-contacto-accion" onClick={() => setEditando(true)}>
          <Pencil size={11} style={{ display: "inline", marginRight: 3, verticalAlign: -1 }} />
          Editar
        </button>
      )}
    </div>
  );
}

function Editar({
  contacto,
  onCerrar,
  onListo,
}: {
  contacto: Contacto;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [nombre, setNombre] = useState(contacto.nombre);
  const [ruc, setRuc] = useState(contacto.ruc ?? "");
  const [telefono, setTelefono] = useState(contacto.telefono ?? "");
  const [esCliente, setEsCliente] = useState(contacto.es_cliente);
  const [esProveedor, setEsProveedor] = useState(contacto.es_proveedor);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!nombre.trim()) {
      setError("El contacto necesita un nombre.");
      return;
    }

    if (!esCliente && !esProveedor) {
      setError("Marcá al menos si te compra o si te vende.");
      return;
    }

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch(`/api/erp/contactos/${contacto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          ruc: ruc.trim(),
          telefono: telefono.trim(),
          es_cliente: esCliente,
          es_proveedor: esProveedor,
        }),
      });

      const datos = await respuesta.json().catch(() => null);

      // El error del RUC llega redactado desde el servidor y dice qué dígito
      // esperaba: mostrarlo entero le ahorra al usuario adivinar.
      if (!respuesta.ok) throw new Error(datos?.error || "No se pudo guardar.");

      onListo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fila-editor">
      <div className="fila-editor-campos">
        <input
          className="neg-input"
          value={nombre}
          maxLength={160}
          autoFocus
          placeholder="Nombre"
          onChange={(e) => setNombre(e.target.value)}
        />

        <input
          className="neg-input neg-cantidad"
          value={ruc}
          maxLength={20}
          placeholder="RUC"
          onChange={(e) => {
            setRuc(e.target.value);
            if (error) setError("");
          }}
        />

        <input
          className="neg-input neg-cantidad"
          value={telefono}
          maxLength={40}
          placeholder="Teléfono"
          onChange={(e) => setTelefono(e.target.value)}
        />
      </div>

      <div className="chip-row">
        <button
          type="button"
          className={`chip${esCliente ? " active" : ""}`}
          onClick={() => setEsCliente((v) => !v)}
        >
          Me compra
        </button>
        <button
          type="button"
          className={`chip${esProveedor ? " active" : ""}`}
          onClick={() => setEsProveedor((v) => !v)}
        >
          Me vende
        </button>
      </div>

      {error && <p className="anular-error" role="alert">{error}</p>}

      <div className="anular-acciones">
        <button type="button" className="chip active" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="chip" disabled={guardando} onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
