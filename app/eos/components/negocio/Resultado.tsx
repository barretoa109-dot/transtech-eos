"use client";

import { useEffect, useState } from "react";
import { FileText, Scale } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import type { ClaveCifra, Trazado } from "@/lib/finanzas/trazabilidad";
import Traza, { Cifra } from "../Traza";
import FinanzasFijos from "../FinanzasFijos";

/**
 * El resultado del período y con qué cuenta el negocio.
 *
 * ============================================================
 * LA PRIMERA FRASE DICE QUÉ NO ES
 * ============================================================
 *
 * Alguien que ve "Resultado del período" con números prolijos va a pensar que
 * puede mandárselo al contador. No puede: no hay asientos, no hay plan de
 * cuentas y no hay impuestos. Eso va arriba de todo y en texto normal, no en
 * una nota al pie, porque el daño de confundirlo con un balance lo paga el
 * usuario y no nosotros.
 *
 * ============================================================
 * LO QUE FALTA SE MUESTRA CON EL MISMO PESO QUE LO QUE HAY
 * ============================================================
 *
 * "No se puede calcular ROE ni ROA" no es una disculpa escondida: es
 * información sobre el negocio tan útil como cualquier cifra. Alguien que
 * quiere esos números ahora sabe exactamente qué le falta cargar, en vez de
 * buscar dónde está el botón.
 */

type Linea = { concepto: string; monto: number; es_subtotal: boolean };

type Resultado = {
  moneda: string;
  ventas_netas: number;
  costo_vendido: number | null;
  resultado_bruto: number | null;
  gastos_operativos: number;
  resultado_operativo: number | null;
  margen_operativo: number | null;
  lineas: Linea[];
  faltantes: string[];
  advertencias: string[];
  confianza: number;
  trazas: Trazado[];
};

/** El nombre de la línea es texto para mostrar; esto lo ata a su traza. */
const CIFRA_DE_LINEA: Record<string, ClaveCifra> = {
  "Ventas netas": "ventas_netas",
  "Costo de lo vendido": "costo_vendido",
  "Resultado bruto": "resultado_bruto",
  "Gastos operativos": "gastos_operativos",
  "Resultado operativo": "resultado_operativo",
};

type Posicion = {
  moneda: string;
  por_cobrar: number;
  inventario: number;
  activo_conocido: number;
  por_pagar: number;
  deuda_12_meses: number;
  pasivo_conocido: number;
  capital_de_trabajo: number;
  /** Null cuando no se debe nada: dividir por cero no da infinito, da "no aplica". */
  liquidez: number | null;
  /** Si `liquidez` es exacta o solo un piso, porque falta la caja. */
  liquidez_es_piso: boolean;
  faltantes: string[];
  advertencias: string[];
  lectura: string;
};

type Respuesta = {
  periodo: { desde: string; hasta: string };
  resultados: Resultado[];
  posiciones: Posicion[];
  aviso?: string;
};

export default function ResultadoView() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  /** Qué cifra está abierta, y de qué moneda: dos resultados pueden compartir clave. */
  const [abierta, setAbierta] = useState<{ moneda: string; cifra: ClaveCifra } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const res = await traer();
      if (!vivo) return;
      if ("error" in res) setError(res.error);
      else setDatos(res);
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (cargando) return <p className="neg-loading" role="status">Armando el resultado…</p>;
  if (error) return <p className="neg-load-error" role="alert">{error}</p>;
  if (!datos) return null;

  const moneda = datos.resultados[0]?.moneda ?? datos.posiciones[0]?.moneda ?? "PYG";

  /*
    Los costos fijos del negocio van ANTES del estado vacío, no adentro del
    resultado.

    Desde la v136 el chat sabe anotar "el capataz cobra 750.000 cada 15 días" y
    lo guarda como fijo del negocio; desde entonces esos fijos ya entran en el
    resultado y en la rentabilidad. Pero no había pantalla que los mostrara: la
    ruta de fijos estaba clavada en los personales. Se registraban, se usaban
    para calcular, y no se podían ver ni corregir.

    Y tienen que estar visibles justo cuando todavía no hay ventas, que es
    cuando un negocio nuevo carga sus costos y todavía no tiene resultado que
    mirar.
  */
  const fijosDelNegocio = (
    <FinanzasFijos
      ambito="negocio"
      moneda={moneda}
      confirmados={0}
      onGuardado={() => {
        void traer().then((res) => {
          if (!("error" in res)) setDatos(res);
        });
      }}
    />
  );

  if (datos.resultados.length === 0 && datos.posiciones.length === 0) {
    return (
      <div className="neg-resultado">
        {fijosDelNegocio}
        <p className="neg-empty-state">
          Todavía no hay movimiento para armar un resultado. Cargá ventas, compras o gastos y volvé.
        </p>
      </div>
    );
  }

  return (
    <div className="neg-resultado">
      {fijosDelNegocio}

      {datos.aviso && <p className="neg-error" role="alert">{datos.aviso}</p>}

      {datos.resultados.map((r) => (
        <div key={`res-${r.moneda}`} className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">
            <FileText size={15} /> Resultado del período en {r.moneda}
          </div>
          <div className="card-sub">
            Del {formatearDia(datos.periodo.desde)} al {formatearDia(datos.periodo.hasta)}
          </div>

          <div className="res-lineas">
            {r.lineas.map((l) => {
              const desconocido =
                (l.concepto === "Costo de lo vendido" && r.costo_vendido === null) ||
                (l.concepto === "Resultado bruto" && r.resultado_bruto === null) ||
                (l.concepto === "Resultado operativo" && r.resultado_operativo === null);

              const cifra = CIFRA_DE_LINEA[l.concepto];

              return (
                <div key={l.concepto} className={`res-linea${l.es_subtotal ? " is-subtotal" : ""}`}>
                  <span>{l.concepto}</span>
                  {/*
                    Una raya donde no se sabe, y no un cero. Un cero acá
                    afirma que el costo fue nada, que es una afirmación
                    completamente distinta de "no se pudo costear".
                  */}
                  {desconocido ? (
                    <strong>—</strong>
                  ) : cifra ? (
                    <Cifra
                      valor={l.monto}
                      moneda={r.moneda}
                      cifra={cifra}
                      trazas={r.trazas}
                      onAbrir={(c) => setAbierta({ moneda: r.moneda, cifra: c })}
                      className={l.monto < 0 ? "is-danger" : undefined}
                    />
                  ) : (
                    <strong className={l.monto < 0 ? "is-danger" : undefined}>
                      {formatearMonto(l.monto, r.moneda)}
                    </strong>
                  )}
                </div>
              );
            })}
          </div>

          {/*
            Pegada al resultado y no al final: quien toca un número quiere
            ver de dónde sale, no bajar buscándolo. Abrir otra cifra de la
            misma moneda reemplaza esta traza, no apila paneles.
          */}
          {abierta?.moneda === r.moneda && (
            // La key reinicia el panel al tocar otra cifra. Ver el porqué en Traza.tsx.
            <Traza
              key={abierta.cifra}
              trazas={r.trazas}
              inicial={abierta.cifra}
              moneda={r.moneda}
              onCerrar={() => setAbierta(null)}
            />
          )}

          {r.margen_operativo !== null && (
            <p className="prose">
              Margen operativo: <strong>{r.margen_operativo.toLocaleString("es-PY", { maximumFractionDigits: 1 })}%</strong>{" "}
              sobre las ventas netas.
            </p>
          )}

          <Notas advertencias={r.advertencias} faltantes={r.faltantes} />
        </div>
      ))}

      {datos.posiciones.map((p) => (
        <div key={`pos-${p.moneda}`} className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">
            <Scale size={15} /> Con qué contás en {p.moneda}
          </div>
          <div className="card-sub">{p.lectura}</div>

          <div className="neg-metricas">
            <div className="neg-metrica">
              <span>Te deben</span>
              <strong>{formatearMonto(p.por_cobrar, p.moneda)}</strong>
            </div>
            <div className="neg-metrica">
              <span>En mercadería</span>
              <strong>{formatearMonto(p.inventario, p.moneda)}</strong>
            </div>
            <div className="neg-metrica">
              <span>Debés</span>
              <strong>{formatearMonto(p.pasivo_conocido, p.moneda)}</strong>
            </div>
            <div className={`neg-metrica${p.capital_de_trabajo < 0 ? " is-danger" : ""}`}>
              <span>Capital de trabajo</span>
              <strong>{formatearMonto(p.capital_de_trabajo, p.moneda)}</strong>
              {p.liquidez !== null && (
                <small className="neg-metrica-nota">
                  Liquidez{p.liquidez_es_piso ? ": al menos " : ": "}
                  {p.liquidez.toLocaleString("es-PY", { maximumFractionDigits: 2 })}
                </small>
              )}
            </div>
          </div>

          <Notas advertencias={p.advertencias} faltantes={p.faltantes} />
        </div>
      ))}
    </div>
  );
}

/** Lo que hay que leer antes de usar estos números, y lo que no se pudo calcular. */
function Notas({ advertencias, faltantes }: { advertencias: string[]; faltantes: string[] }) {
  return (
    <>
      {advertencias.map((a) => (
        <p key={a} className="res-advertencia">
          {a}
        </p>
      ))}
      {faltantes.length > 0 && (
        <div className="pron-faltantes">
          {faltantes.map((f) => (
            <p key={f}>{f}</p>
          ))}
        </div>
      )}
    </>
  );
}

/** Fuera del componente: así el efecto no toca estado antes de su primer await. */
async function traer(): Promise<Respuesta | { error: string }> {
  try {
    const r = await fetch("/api/contabilidad", { cache: "no-store" });
    if (!r.ok) {
      const cuerpo = await r.json().catch(() => ({}));
      return { error: cuerpo?.error ?? "No pudimos armar tu resultado." };
    }
    return (await r.json()) as Respuesta;
  } catch {
    return { error: "No pudimos armar tu resultado." };
  }
}

function formatearDia(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-PY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
