"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

type Respuesta =
  | {
      configurado: true;
      nombreMes: string;
      lineas: string[];
      minutosAhorrados: number;
      tiempoEnPalabras: string;
      anotadas: number;
      avisos: number;
      documentos: number;
    }
  | { error: string };

/**
 * Tu impacto, dentro de la app.
 *
 * El correo mensual (`lib/impacto/informe.ts`) ya le cuenta esto a cada
 * cuenta una vez al mes: cuánto anotó, cuánto cobró, qué avisos le
 * llegaron antes de que el problema pasara. Pero solo vivía en la bandeja
 * de entrada — alguien podía usar EOS todos los días y nunca ver, en el
 * momento, la prueba de que le está funcionando.
 *
 * Esta pantalla pide ese mismo cálculo (`/api/finanzas/impacto`) para el
 * mes en curso, a pedido. No repite el umbral `MINIMO_DE_COSAS` del
 * correo —ese existe para no mandar un correo flaco que decepcione a
 * quien no lo pidió— porque acá nadie la ve sin entrar a buscarla.
 */
export default function FinanzasImpacto() {
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vigente = true;
    fetch("/api/finanzas/impacto", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Respuesta>) : Promise.reject(new Error())))
      .then((datos) => {
        if (vigente) setData(datos);
      })
      .catch(() => {
        if (vigente) setError(true);
      });
    return () => {
      vigente = false;
    };
  }, []);

  if (error || (data && "error" in data)) {
    return (
      <div className="card">
        <p className="neg-load-error" role="alert">
          No pudimos calcular tu impacto en este momento. Volvé a entrar en un rato.
        </p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="card">
        <p className="neg-loading" role="status">
          Calculando lo que hicimos juntos este mes…
        </p>
      </div>
    );
  }

  if (data.lineas.length === 0) {
    return (
      <div className="card">
        <span className="fin-badge fin-badge-neutral">
          <ShieldCheck size={14} />
          TU {data.nombreMes.toUpperCase()} CON EOS
        </span>
        <p className="prose" style={{ marginTop: 12 }}>
          Todavía no hay nada que contar este mes. En cuanto anotes algo o EOS registre un movimiento, va a
          aparecer acá.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <span className="fin-badge fin-badge-neutral">
        <ShieldCheck size={14} />
        TU {data.nombreMes.toUpperCase()} CON EOS
      </span>

      {data.minutosAhorrados > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="fin-main-label">Tiempo que no pasaste anotando</div>
          <div className="fin-main-value" style={{ fontSize: 28 }}>
            {data.tiempoEnPalabras}
          </div>
        </div>
      )}

      <ul className="impacto-lista">
        {data.lineas.map((linea, i) => (
          <li key={i}>{linea}</li>
        ))}
      </ul>

      <p className="prose" style={{ marginTop: 14, fontSize: 12.5, opacity: 0.75 }}>
        Cada línea sale de lo que anotaste o de un aviso que de verdad te mandé — nada se inventa ni se
        redondea para arriba. Este resumen también te llega por correo, una vez que termine el mes; acá
        queda siempre a mano, actualizado a hoy.
      </p>
    </div>
  );
}
