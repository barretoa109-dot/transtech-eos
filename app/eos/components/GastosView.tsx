"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";
import { DESTINOS } from "@/lib/finanzas/destinos";

/*
  El bloque financiero personal vivía en Dashboard y esta pantalla era una
  entrada y una lista. El material estaba al lado, en otra sección: por eso
  Personal se sentía pobre. Acá se reúne todo lo que es de la persona.
*/
import FinanzasPanel from "./FinanzasPanel";
import FinanzasTrayectoria from "./FinanzasTrayectoria";
import FinanzasDestino from "./FinanzasDestino";
import FinanzasCuentas from "./FinanzasCuentas";
import FinanzasDeudas from "./FinanzasDeudas";
import FinanzasPlanDeudas from "./FinanzasPlanDeudas";
import FinanzasInforme from "./FinanzasInforme";

/**
 * Personal: las finanzas de la persona, completas y en un solo lugar.
 *
 * ============================================================
 * PARA QUIÉN ES ESTA PANTALLA
 * ============================================================
 *
 * EOS no es sólo para quien tiene un negocio. Alguien en relación de
 * dependencia no tiene ventas, ni stock, ni proveedores: tiene el combustible,
 * el almuerzo, el alquiler y el sueldo. Negocio no le sirve.
 *
 * ============================================================
 * POR QUÉ SE SENTÍA POBRE, Y NO ERA POR FALTA DE FUNCIONES
 * ============================================================
 *
 * Nació siendo un campo de texto y una lista, con el argumento de que "todo el
 * motor ya existía y sólo faltaba dónde escribir la línea". Era cierto a
 * medias: el motor existía, pero lo que ese motor produce —el panel de "¿estoy
 * bien?", la trayectoria del saldo, en qué se fue la plata, las deudas, el
 * informe— se mostraba en DASHBOARD, al lado de los indicadores del negocio.
 *
 * Así que quien entraba a Personal a ver cómo estaba encontraba un formulario,
 * y quien entraba a Dashboard a ver su negocio encontraba primero sus finanzas
 * personales. Las dos pantallas contestaban la pregunta de la otra.
 *
 * Desde la v136 la plata está separada de verdad en la base; esto es la misma
 * separación en la pantalla. Acá va todo lo de la persona, en el orden en que
 * se hacen las preguntas: ¿estoy bien? → anotar → cómo vengo → qué se viene →
 * en qué se me fue → cuánto tengo → a quién le debo → el papel → el detalle.
 *
 * ============================================================
 * UNA LÍNEA, SIN FORMULARIO
 * ============================================================
 *
 * Se escribe como se cuenta: "gasté 50 mil en nafta", "cobré el sueldo
 * 3.500.000". Nada de elegir tipo, categoría, fecha y moneda en cuatro
 * controles antes de poder guardar. Un registro de gastos que cuesta cuatro
 * campos se abandona en tres días, y un registro abandonado no es un registro
 * incompleto: es un panel que miente sobre lo que hay.
 *
 * A cambio de no pedir confirmación, la pantalla devuelve lo que EOS entendió
 * —"Salió ₲ 50.000 — nafta"— en el momento, cuando la persona todavía se
 * acuerda de cuánto gastó. Ése es el mecanismo de corrección, y por eso el
 * aviso se queda hasta que carga la siguiente.
 */

type Movimiento = {
  id: string;
  tipo: "ingreso" | "gasto";
  monto: number;
  moneda: string;
  descripcion: string;
  fecha: string;
  origen: string;
  categoria: string;
  etiqueta: string;
  editable: boolean;
};

type Total = { moneda: string; entro: number; salio: number; balance: number };

const VENTANAS = [
  ["semana", "7 días"],
  ["mes", "30 días"],
  ["trimestre", "90 días"],
] as const;

function dia(iso: string): string {
  const [, mes, numero] = iso.split("-");
  return `${numero}/${mes}`;
}

export default function GastosView() {
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [totales, setTotales] = useState<Total[]>([]);
  const [ventana, setVentana] = useState<"semana" | "mes" | "trimestre">("mes");
  const [cargando, setCargando] = useState(true);
  const [nuncaCargo, setNuncaCargo] = useState(true);
  const [error, setError] = useState("");

  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [entendido, setEntendido] = useState("");
  const [errorAlta, setErrorAlta] = useState("");

  const cargar = useCallback(() => {
    setCargando(true);
    setError("");
    return fetch(`/api/finanzas/diario?ventana=${ventana}`, { cache: "no-store" })
      .then(async (respuesta) => {
        const datos = await respuesta.json().catch(() => null);
        if (!respuesta.ok) throw new Error(datos?.error || "No pudimos cargar tus movimientos.");
        setMovimientos(Array.isArray(datos?.movimientos) ? datos.movimientos : []);
        setTotales(Array.isArray(datos?.totales) ? datos.totales : []);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "No pudimos cargar tus movimientos."),
      )
      .finally(() => {
        setCargando(false);
        setNuncaCargo(false);
      });
  }, [ventana]);

  useEffect(() => {
    const timer = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(timer);
  }, [cargar]);

  async function anotar() {
    const linea = texto.trim();
    if (!linea || guardando) return;

    setGuardando(true);
    setErrorAlta("");

    try {
      const respuesta = await fetch("/api/finanzas/rapido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: linea }),
      });

      const datos = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        throw new Error(
          datos?.error ||
            "No entendí cuánto fue. Probá con algo como «gasté 50 mil en nafta».",
        );
      }

      setEntendido(String(datos?.entendido ?? "Anotado."));
      setTexto("");
      await cargar();
    } catch (err) {
      setErrorAlta(err instanceof Error ? err.message : "No pudimos anotarlo.");
    } finally {
      setGuardando(false);
    }
  }

  /*
   * Corregir la categoría a mano.
   *
   * EOS infiere el destino de la descripción y NO le pide a nadie que
   * etiquete: eso es trabajo que existe para no delegar. Pero las reglas son
   * deliberadamente estrechas —antes "sin reconocer" que una mentira— y eso
   * sólo es vivible si quien mira puede decir cuál era. La corrección se
   * guarda en la fila y manda sobre la inferencia de ahí en adelante.
   */
  async function recategorizar(m: Movimiento, clave: string) {
    // Optimista: el desplegable ya se movió y volver atrás para luego
    // avanzar de nuevo se ve como un parpadeo roto.
    setMovimientos((previos) =>
      previos.map((x) => (x.id === m.id ? { ...x, categoria: clave } : x)),
    );

    const respuesta = await fetch(`/api/finanzas/diario/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoria: clave === "otros" ? "" : clave }),
    });

    if (!respuesta.ok) {
      const datos = await respuesta.json().catch(() => null);
      setError(datos?.error || "No pudimos cambiar la categoría.");
    }

    await cargar();
  }

  async function borrar(m: Movimiento) {
    const respuesta = await fetch(`/api/finanzas/diario/${m.id}`, { method: "DELETE" });

    if (!respuesta.ok) {
      const datos = await respuesta.json().catch(() => null);
      setError(datos?.error || "No pudimos borrarlo.");
      return;
    }

    await cargar();
  }

  /*
    La moneda del panel sale de los totales que ya trae el diario: es la del
    movimiento más reciente, que en la práctica es la que usa la persona. Si
    todavía no hay ninguno, guaraníes.
  */
  const monedaPrincipal = totales[0]?.moneda ?? "PYG";

  if (cargando && nuncaCargo) {
    return (
      <div className="neg-loading" role="status">
        <span /> Cargando tus movimientos…
      </div>
    );
  }

  return (
    <div className="view" id="view-personal">
      <div className="page page-in gastos">
        {/*
          El encabezado es el mismo patrón que Negocio, y es a propósito: desde
          la v136 son dos lugares separados de verdad —la plata de cada uno vive
          en filas distintas— y tienen que leerse como contrapartes y no como
          una sección y su pestaña.

          La segunda línea dice explícitamente que esto no toca el negocio. Es
          lo que alguien necesita saber antes de anotar su sueldo acá y quedarse
          con la duda de si le acaba de ensuciar el resultado del mes.
        */}
        <div className="page-header">
          <div className="page-eyebrow">Personal</div>
          <div className="page-title">Tu plata, aparte de la del negocio</div>
          <div className="page-sub">
            Lo que cobrás y lo que gastás vos. Nada de lo que anotes acá entra en las cuentas de
            Negocio, ni al revés.
          </div>
        </div>

        {/*
          "¿Estoy bien?" arriba de todo, antes que cualquier número suelto.

          Es la doctrina de EOS Finanzas, y acá se cumple por primera vez en la
          sección de la persona: hasta hoy este panel vivía en Dashboard, al
          lado de los indicadores del negocio, y Personal empezaba por un campo
          de texto vacío. Quien entraba a ver cómo estaba encontraba un
          formulario.

          FinanzasPanel trae adentro la Constitución Financiera, los fijos, las
          series recurrentes que detectó y la conciliación. Todo eso también
          estaba fuera de esta sección.
        */}
        <FinanzasPanel />

        <div className="card">
        <div className="neg-section-heading">
          <div>
            <div className="card-title">Anotá un gasto o un ingreso</div>
            <div className="card-sub">
              Escribilo como lo contás: «gasté 50 mil en nafta», «cobré el sueldo 3.500.000».
              EOS entiende el monto, la fecha y en qué fue.
            </div>
          </div>
          <Wallet size={24} />
        </div>

        <div className="gastos-alta">
          <input
            className="neg-input"
            aria-label="Anotar un gasto"
            placeholder="gasté 35 mil en el almuerzo"
            value={texto}
            maxLength={200}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void anotar();
            }}
          />
          <button type="button" className="reco-btn" disabled={guardando} onClick={() => void anotar()}>
            <Plus size={14} /> {guardando ? "Anotando…" : "Anotar"}
          </button>
        </div>

        {/*
          Lo que EOS entendió se queda hasta la próxima carga a propósito: es la
          única defensa contra un error de lectura en un flujo que, por diseño,
          no pide confirmación.
        */}
        {entendido && <p className="gastos-entendido">{entendido}</p>}
        {errorAlta && <p className="neg-error" role="alert">{errorAlta}</p>}
      </div>

      <div className="card">
        <div className="neg-section-heading">
          <div>
            <div className="card-title">Cómo venís</div>
            <div className="card-sub">Lo que entró y lo que salió en el período.</div>
          </div>
        </div>

        <div className="neg-ventanas" role="group" aria-label="Período">
          {VENTANAS.map(([clave, etiqueta]) => (
            <button
              key={clave}
              type="button"
              className={`chip${ventana === clave ? " active" : ""}`}
              aria-pressed={ventana === clave}
              onClick={() => setVentana(clave)}
            >
              {etiqueta}
            </button>
          ))}
        </div>

        {/*
          Un bloque por moneda, nunca una suma sola: guaraníes más dólares no
          dan nada. La regla no se relaja porque acá el usuario sea una persona
          y no un comercio.
        */}
        {totales.length === 0 ? (
          <div className="neg-empty-state">
            <Wallet size={28} />
            <strong>Todavía no anotaste nada en este período</strong>
            <p>Escribí arriba lo primero que se te ocurra que gastaste hoy. Con eso alcanza para empezar.</p>
          </div>
        ) : (
          totales.map((t) => (
            <section className="neg-margin-group" key={t.moneda}>
              <header>
                <strong>{t.moneda}</strong>
              </header>
              <div className="neg-metricas">
                <div className="neg-metrica is-good">
                  <span>Entró</span>
                  <strong>{formatearMonto(t.entro, t.moneda)}</strong>
                </div>
                <div className="neg-metrica is-danger">
                  <span>Salió</span>
                  <strong>{formatearMonto(t.salio, t.moneda)}</strong>
                </div>
                <div className={`neg-metrica ${t.balance < 0 ? "is-danger" : "is-good"}`}>
                  <span>Balance</span>
                  <strong>{formatearMonto(t.balance, t.moneda)}</strong>
                </div>
              </div>
            </section>
          ))
        )}
      </div>

      {/*
        El detalle, en el orden en que se hacen las preguntas y no en el de las
        tablas: "¿qué se viene?", "¿en qué se me fue?", "¿a quién le debo?" y
        "quiero el papel". Cada tarjeta se calla sola cuando no tiene nada que
        decir, así que quien recién empieza no ve cinco cajas vacías.

        Las cuatro estaban en Dashboard. Ahí no estaban mal —funcionaban— pero
        vivían al lado de los indicadores del negocio, que es justamente la
        mezcla que la v136 vino a deshacer.
      */}
      <FinanzasTrayectoria />
      <FinanzasDestino />
      {/*
        "¿Cuánto tengo?" y "¿a quién le debo?" son la misma pregunta partida en
        dos, así que van juntas. Las cuentas existían en la base y en el
        onboarding desde hacía semanas y no se veían desde ninguna pantalla:
        se preguntaban una vez y nunca más.
      */}
      <FinanzasCuentas moneda={monedaPrincipal} />
      <FinanzasDeudas />
      {/*
        Y qué hacer con esas deudas. La tarjeta de arriba dice a quién le debe;
        ésta dice en qué orden pagar, por qué, qué pasa con lo que no entra y
        en cuántos meses sale. Va inmediatamente después a propósito: separadas
        por otra tarjeta se leerían como dos temas, y son el mismo.
      */}
      <FinanzasPlanDeudas moneda={monedaPrincipal} />
      <FinanzasInforme />

      <div className="card">
        <div className="neg-section-heading">
          <div>
            <div className="card-title">Tus movimientos</div>
            <div className="card-sub">
              EOS agrupa solo por destino. Si se equivocó, corregilo y manda tu corrección.
            </div>
          </div>
          <button type="button" className="chip" onClick={() => void cargar()}>
            <RefreshCw size={13} /> Actualizar
          </button>
        </div>

        {error && (
          <p className="neg-error" role="alert">
            <AlertCircle size={14} /> {error}
          </p>
        )}

        {movimientos.length === 0 ? (
          <div className="neg-empty-state">
            <Wallet size={28} />
            <strong>Sin movimientos en el período</strong>
            <p>Los que anotes, los que lleguen del correo de tu banco y los de tus ventas aparecen todos acá.</p>
          </div>
        ) : (
          movimientos.map((m) => (
            <div className="neg-fila" key={m.id}>
              <span className={`gastos-signo ${m.tipo}`} aria-hidden="true">
                {m.tipo === "ingreso" ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}
              </span>

              <div className="neg-fila-texto">
                <strong>{m.descripcion || "Sin detalle"}</strong>
                <small>
                  {dia(m.fecha)}
                  {!m.editable && ` · ${m.etiqueta} · lo generó otra parte de EOS`}
                </small>

                {m.editable && (
                  <select
                    className="neg-input gastos-categoria"
                    value={m.categoria}
                    aria-label={`Categoría de ${m.descripcion}`}
                    onChange={(e) => void recategorizar(m, e.target.value)}
                  >
                    {DESTINOS.map((d) => (
                      <option key={d.clave} value={d.clave}>
                        {d.etiqueta}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <span className={`neg-fila-monto ${m.tipo}`}>
                {m.tipo === "ingreso" ? "+" : "−"} {formatearMonto(m.monto, m.moneda)}
              </span>

              {m.editable ? (
                <button
                  type="button"
                  className="chip"
                  aria-label={`Borrar ${m.descripcion}`}
                  onClick={() => void borrar(m)}
                >
                  <Trash2 size={13} />
                </button>
              ) : (
                /*
                  No se puede borrar desde acá y se dice por qué. Un botón que
                  falla al apretarlo enseña que el sistema está roto; uno que no
                  está, con el motivo al lado, enseña dónde se corrige.
                */
                <span className="neg-estado" title="Se corrige donde nació">
                  <Lock size={12} /> {m.origen === "erp" ? "Negocio" : "Buzón"}
                </span>
              )}
            </div>
          ))
        )}
        </div>
      </div>
    </div>
  );
}
