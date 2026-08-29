"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";

/**
 * Traer el catálogo desde la planilla que ya tenés.
 *
 * ============================================================
 * PRIMERO SE MUESTRA LO QUE ENTENDIÓ, DESPUÉS SE IMPORTA
 * ============================================================
 *
 * Lo que más se equivoca al leer una planilla no es un precio suelto: es la
 * COLUMNA. Si trae costo y precio de venta y se toma la equivocada, el catálogo
 * entero queda vendiéndose a pérdida y nadie lo nota hasta cerrar el mes.
 *
 * Por eso lo primero y más visible de la vista previa es qué columna se usó
 * para cada cosa. Recién debajo van los productos y las filas que no se
 * pudieron leer.
 *
 * Nada toca el catálogo hasta que se aprieta "Importar".
 */

type Interpretacion = { campo: string; columna: string | null };

type Vista = {
  interpretacion: Interpretacion[];
  cuantos: number;
  muestra: Array<{
    nombre: string;
    precio_venta: number;
    costo: number | null;
    stock_actual: number;
    iva: number;
  }>;
  problemas: Array<{ fila: number; motivo: string }>;
  repetidos: string[];
};

const ETIQUETAS: Record<string, string> = {
  nombre: "Nombre",
  codigo: "Código",
  precio: "Precio de venta",
  costo: "Costo",
  stock: "Stock",
  iva: "IVA",
  unidad: "Unidad",
};

export default function ImportarProductos({ onImportado }: { onImportado: () => void }) {
  const entrada = useRef<HTMLInputElement | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");

  async function enviar(confirmar: boolean) {
    if (!archivo) return;

    setTrabajando(true);
    setError("");

    try {
      const cuerpo = new FormData();
      cuerpo.append("archivo", archivo);
      if (confirmar) cuerpo.append("confirmar", "1");

      const respuesta = await fetch("/api/erp/importar", { method: "POST", body: cuerpo });
      const datos = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        setError(datos?.error || "No pudimos leer la planilla.");
        return;
      }

      if (confirmar) {
        setListo(`Se importaron ${datos.importados} productos.`);
        setVista(null);
        setArchivo(null);
        if (entrada.current) entrada.current.value = "";
        onImportado();
      } else {
        setVista(datos as Vista);
      }
    } catch {
      setError("No pudimos leer la planilla.");
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">Traer desde una planilla</div>

      {listo ? (
        <>
          <p className="empty-note">{listo}</p>
          <button type="button" className="chip" onClick={() => setListo("")}>
            Importar otra
          </button>
        </>
      ) : (
        <>
          <p className="empty-note">
            Subí tu Excel o CSV como lo tenés. No hace falta que renombres nada: buscamos las
            columnas por su nombre y te mostramos qué entendimos antes de guardar.
          </p>

          <input
            ref={entrada}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="neg-input"
            onChange={(e) => {
              setArchivo(e.target.files?.[0] ?? null);
              setVista(null);
              setError("");
            }}
          />

          {archivo && !vista && (
            <button
              type="button"
              className="reco-btn"
              disabled={trabajando}
              style={{ display: "inline-flex", marginTop: 10 }}
              onClick={() => enviar(false)}
            >
              <FileSpreadsheet size={13} style={{ marginRight: 6 }} />
              {trabajando ? "Leyendo…" : "Ver qué entendimos"}
            </button>
          )}

          {vista && (
            <div className="fila-editor" style={{ marginTop: 14 }}>
              <p className="fila-editor-nota">
                <strong>Revisá esto primero.</strong> Si una columna está tomada al revés, todo el
                catálogo va a quedar mal.
              </p>

              <ul className="paquete-incluye" style={{ margin: 0 }}>
                {vista.interpretacion.map((i) => (
                  <li key={i.campo}>
                    {ETIQUETAS[i.campo] ?? i.campo}:{" "}
                    <strong>{i.columna ?? "no encontramos esta columna"}</strong>
                  </li>
                ))}
              </ul>

              <p className="fila-editor-nota">
                <strong>{vista.cuantos}</strong>{" "}
                {vista.cuantos === 1 ? "producto listo" : "productos listos"} para importar.
              </p>

              {vista.muestra.length > 0 && (
                <div className="neg-lista">
                  {vista.muestra.map((p, i) => (
                    <div className="neg-fila" key={`${p.nombre}-${i}`}>
                      <div className="neg-fila-texto">
                        <strong>{p.nombre}</strong>
                        <small>
                          IVA {p.iva}%{p.costo !== null ? ` · costo ${p.costo.toLocaleString("es-PY")}` : ""}
                          {` · stock ${p.stock_actual}`}
                        </small>
                      </div>
                      <span className="neg-fila-monto">
                        Gs. {p.precio_venta.toLocaleString("es-PY")}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {vista.repetidos.length > 0 && (
                <p className="anular-error">
                  Hay nombres repetidos en tu planilla: {vista.repetidos.slice(0, 5).join(", ")}
                  {vista.repetidos.length > 5 ? "…" : ""}
                </p>
              )}

              {vista.problemas.length > 0 && (
                <>
                  <p className="fila-editor-nota">
                    Estas filas no las pudimos leer y no se van a importar:
                  </p>
                  <ul className="paquete-incluye" style={{ margin: 0 }}>
                    {vista.problemas.slice(0, 8).map((p) => (
                      <li key={p.fila}>
                        Fila {p.fila}: {p.motivo}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="anular-acciones">
                <button
                  type="button"
                  className="chip active"
                  disabled={trabajando || vista.cuantos === 0}
                  onClick={() => enviar(true)}
                >
                  <Upload size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                  {trabajando ? "Importando…" : `Importar ${vista.cuantos}`}
                </button>

                <button
                  type="button"
                  className="chip"
                  disabled={trabajando}
                  onClick={() => setVista(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {error && <p className="anular-error">{error}</p>}
        </>
      )}
    </div>
  );
}
