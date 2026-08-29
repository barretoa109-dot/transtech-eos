"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, Star, Trash2 } from "lucide-react";

/**
 * Las tarjetas guardadas, y cómo sacarlas.
 *
 * ============================================================
 * POR QUÉ FALTABA Y POR QUÉ IMPORTA
 * ============================================================
 *
 * EOS sabía catastrar una tarjeta y cobrarle, pero no había ninguna pantalla
 * donde verlas ni eliminarlas. La ruta de borrado existía —borra en Bancard y
 * en nuestra base— y no la alcanzaba nadie.
 *
 * Lo detectó la certificación de Bancard: pudieron catastrar y pagar, y al ir a
 * dar de baja la tarjeta no encontraron dónde. Es un requisito para cerrar la
 * certificación, pero antes que eso es lo correcto: alguien que dejó guardado
 * un medio de pago tiene que poder retirarlo sin pedirle permiso a nadie.
 *
 * ============================================================
 * SIN NÚMEROS DE TARJETA, NUNCA
 * ============================================================
 *
 * Lo único que se muestra es lo que Bancard nos devuelve: la marca, los cuatro
 * últimos dígitos y el vencimiento. El número completo no pasa por nuestros
 * servidores ni existe en nuestra base — lo procesa Bancard en su entorno.
 */

type Tarjeta = {
  id: string;
  card_masked_number: string | null;
  card_brand: string | null;
  card_type: string | null;
  expiration_date: string | null;
  es_principal: boolean;
};

export default function MisTarjetas() {
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [borrando, setBorrando] = useState("");
  const [confirmando, setConfirmando] = useState("");
  const [error, setError] = useState("");

  /*
   * No toca `cargando` al empezar: arranca en true para la primera carga, y
   * después de borrar la lista se refresca sola sin parpadear. Poner el estado
   * de forma síncrona acá además dispara renders en cascada desde el efecto.
   */
  const cargar = useCallback(async () => {
    try {
      const respuesta = await fetch("/api/pagos/bancard/tarjetas", { cache: "no-store" });

      if (!respuesta.ok) throw new Error("No pudimos cargar tus tarjetas.");

      const datos = await respuesta.json();
      setTarjetas(datos.tarjetas ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar tus tarjetas.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function eliminar(id: string) {
    setBorrando(id);
    setError("");

    try {
      const respuesta = await fetch(`/api/pagos/bancard/tarjetas/${id}`, { method: "DELETE" });

      if (!respuesta.ok) {
        const datos = await respuesta.json().catch(() => null);
        throw new Error(datos?.error || "No pudimos eliminar la tarjeta.");
      }

      setConfirmando("");
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos eliminar la tarjeta.");
    } finally {
      setBorrando("");
    }
  }

  return (
    <div className="card">
      <div className="card-title">Tarjetas guardadas</div>

      {cargando ? (
        <p className="empty-note">Cargando…</p>
      ) : tarjetas.length === 0 ? (
        <p className="empty-note">
          No tenés ninguna tarjeta guardada. Se guarda sola la primera vez que pagás, y podés
          sacarla desde acá cuando quieras.
        </p>
      ) : (
        <div className="neg-lista">
          {tarjetas.map((t) => (
            <div className="neg-fila" key={t.id}>
              <div className="neg-fila-texto">
                <strong>
                  <CreditCard size={13} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
                  {t.card_masked_number ?? "Tarjeta guardada"}
                </strong>
                <small>
                  {t.card_brand ?? "—"}
                  {t.expiration_date ? ` · vence ${t.expiration_date}` : ""}
                </small>
              </div>

              {/*
                La principal es la que se usa para renovar sola cada mes. Decirlo
                importa: alguien que borra "una tarjeta cualquiera" puede estar
                borrando la que mantiene su EOS andando.
              */}
              {t.es_principal && (
                <span className="neg-estado is-ok">
                  <Star size={12} /> renueva con esta
                </span>
              )}

              {confirmando === t.id ? (
                <div className="anular-caja">
                  <p className="anular-aviso">
                    {t.es_principal
                      ? "Es la tarjeta con la que se renueva tu EOS. Si la sacás y no queda otra, la próxima renovación no va a poder cobrarse."
                      : "Se elimina de Bancard y de EOS. Podés volver a guardarla cuando quieras."}
                  </p>

                  <div className="anular-acciones">
                    <button
                      type="button"
                      className="chip is-danger"
                      disabled={borrando === t.id}
                      onClick={() => eliminar(t.id)}
                    >
                      {borrando === t.id ? "Eliminando…" : "Sí, eliminarla"}
                    </button>

                    <button
                      type="button"
                      className="chip"
                      disabled={borrando === t.id}
                      onClick={() => setConfirmando("")}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="chip is-danger"
                  onClick={() => setConfirmando(t.id)}
                >
                  <Trash2 size={12} style={{ display: "inline", marginRight: 3, verticalAlign: -2 }} />
                  Eliminar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="anular-error">{error}</p>}

      {borrando && (
        <p className="empty-note">
          <span style={{ display: "inline-flex", verticalAlign: -3, marginRight: 6 }}>
            <Loader2 size={13} />
          </span>
          Avisándole a Bancard…
        </p>
      )}
    </div>
  );
}
