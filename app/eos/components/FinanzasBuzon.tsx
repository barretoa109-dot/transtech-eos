"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Mail } from "lucide-react";

type Buzon =
  | { disponible: false }
  | {
      disponible: true;
      direccion: string;
      activo: boolean;
      correos_recibidos: number;
      ultimo_correo_en: string | null;
    };

/**
 * La dirección a la que el usuario reenvía los avisos de su banco.
 *
 * Doctrina, principio 1: cargar un movimiento a mano tiene que ser la
 * excepción. El usuario configura una regla de reenvío UNA vez y EOS se
 * alimenta solo; por eso el texto insiste en que es una sola configuración y
 * no una tarea recurrente.
 */
export default function FinanzasBuzon() {
  const [buzon, setBuzon] = useState<Buzon | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    fetch("/api/finanzas/buzon", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setBuzon)
      .catch(() => setBuzon({ disponible: false }));
  }, []);

  if (!buzon || !buzon.disponible) return null;

  async function copiar(direccion: string) {
    try {
      await navigator.clipboard.writeText(direccion);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles el usuario todavía puede seleccionar el
      // texto a mano: no vale la pena mostrarle un error por esto.
    }
  }

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="fin-badge fin-badge-neutral">
          <Mail size={14} />
          INGESTA AUTOMÁTICA
        </span>
      </div>

      <p className="prose" style={{ marginTop: 10 }}>
        Reenviá a esta dirección los avisos que te manda tu banco. Configurala una vez como regla de
        reenvío automático en tu correo y no vuelvas a cargar un movimiento a mano.
      </p>

      <div className="field-row" style={{ marginTop: 12, gap: 8 }}>
        <code style={{ fontSize: 13, wordBreak: "break-all", flex: 1 }}>{buzon.direccion}</code>
        <button
          type="button"
          className="fin-editar"
          onClick={() => void copiar(buzon.direccion)}
          aria-label="Copiar mi dirección de ingesta"
          title="Copiar"
        >
          {copiado ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      <div className="fin-sub" style={{ marginTop: 10 }}>
        {buzon.correos_recibidos === 0
          ? "Todavía no llegó ningún correo."
          : `${buzon.correos_recibidos} correo${buzon.correos_recibidos === 1 ? "" : "s"} procesado${
              buzon.correos_recibidos === 1 ? "" : "s"
            }.`}
      </div>
    </div>
  );
}
