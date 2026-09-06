"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, FileText, FileType } from "lucide-react";

/**
 * "Llevate tu balance."
 *
 * El archivo que sale de acá NO es una plantilla para llenar: son los
 * movimientos del usuario, ya cargados, en el período que él eligió. Esa es
 * toda la diferencia con `app/descargar`, que sigue existiendo para el caso
 * distinto de "dame una planilla para arrancar mi negocio".
 *
 * Dos decisiones:
 *
 *  - SE PIDE EL PERÍODO ANTES QUE EL FORMATO. El período cambia qué dice el
 *    documento; el formato solo cambia cómo se ve. Preguntar primero por
 *    "Excel o PDF" invierte la importancia de las dos preguntas.
 *  - LA DESCARGA VA POR `fetch`, NO POR UN ENLACE. Un `<a href>` que recibe un
 *    401 o un "todavía no configuraste tus finanzas" abre una pestaña con un
 *    JSON crudo en la cara del usuario. Así el error se puede leer y decir en
 *    castellano, acá mismo.
 *
 * El selector de moneda solo aparece con más de una: `/api/informes` antes
 * mezclaba TODOS los movimientos del período sin filtrar, así que una cuenta
 * con guaraníes y dólares terminaba con un balance que sumaba las dos monedas
 * como si fueran una sola. Ahora el servidor filtra por una, y acá se elige
 * cuál — sin preguntarle nada a quien solo tiene una.
 */

type Periodo = { clave: string; etiqueta: string };

const PERIODOS: Periodo[] = [
  { clave: "semana", etiqueta: "Esta semana" },
  { clave: "semana_pasada", etiqueta: "Semana pasada" },
  { clave: "mes", etiqueta: "Este mes" },
  { clave: "mes_pasado", etiqueta: "Mes pasado" },
  { clave: "trimestre", etiqueta: "Trimestre" },
];

const FORMATOS = [
  { clave: "excel", etiqueta: "Excel", Icono: FileSpreadsheet },
  { clave: "pdf", etiqueta: "PDF", Icono: FileText },
  { clave: "word", etiqueta: "Word", Icono: FileType },
] as const;

export default function FinanzasInforme() {
  const [periodo, setPeriodo] = useState("mes");
  const [monedas, setMonedas] = useState<string[]>([]);
  const [moneda, setMoneda] = useState<string | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);
  const [error, setError] = useState("");

  /*
   * Solo se pregunta si hace falta. `/api/finanzas/estado` ya sabe en qué
   * monedas se mueve esta cuenta —la principal siempre primero—; con una
   * sola, no tiene sentido pedirle a la persona que elija algo que no existe.
   */
  useEffect(() => {
    fetch("/api/finanzas/estado", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { monedas?: { moneda: string }[] } | null) => {
        const lista = (data?.monedas ?? []).map((b) => b.moneda);
        if (lista.length > 1) {
          setMonedas(lista);
          setMoneda(lista[0]);
        }
      })
      .catch(() => undefined);
  }, []);

  async function descargar(formato: string) {
    setBajando(formato);
    setError("");

    try {
      const parametroMoneda = moneda ? `&moneda=${moneda}` : "";
      const res = await fetch(`/api/informes?periodo=${periodo}&formato=${formato}${parametroMoneda}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        const detalle = await res.json().catch(() => null);
        throw new Error(detalle?.error ?? "No pudimos generar el archivo.");
      }

      // El nombre lo decide el servidor: es el que lleva el período adentro,
      // y así un balance de julio no se guarda encima del de agosto.
      const cabecera = res.headers.get("Content-Disposition") ?? "";
      const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cabecera)?.[1];
      const simple = /filename="([^"]+)"/i.exec(cabecera)?.[1];
      const nombre = utf8 ? decodeURIComponent(utf8) : (simple ?? `balance.${formato}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Sin esto el blob queda en memoria hasta que se cierre la pestaña, y
      // un balance anual son varios megas por cada clic.
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos generar el archivo.");
    } finally {
      setBajando(null);
    }
  }

  return (
    <div className="card">
      <div className="card-title">Llevate tu balance</div>
      <div className="card-sub">
        Con tus movimientos reales del período, no una planilla en blanco.
      </div>

      <div className="chip-row" style={{ marginTop: 4 }}>
        {PERIODOS.map((p) => (
          <button
            key={p.clave}
            type="button"
            className={`chip ${periodo === p.clave ? "active" : ""}`}
            onClick={() => setPeriodo(p.clave)}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {monedas.length > 1 && (
        <div className="chip-row" style={{ marginTop: 8 }}>
          {monedas.map((m) => (
            <button
              key={m}
              type="button"
              className={`chip ${moneda === m ? "active" : ""}`}
              onClick={() => setMoneda(m)}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      <div className="informe-formatos">
        {FORMATOS.map(({ clave, etiqueta, Icono }) => (
          <button
            key={clave}
            type="button"
            className="informe-btn"
            onClick={() => void descargar(clave)}
            disabled={bajando !== null}
          >
            <Icono size={15} />
            {bajando === clave ? "Armando…" : etiqueta}
          </button>
        ))}
      </div>

      {error && (
        <p className="prose" style={{ marginTop: 10, color: "var(--amber)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
