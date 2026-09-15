"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Lock,
  MessageCircle,
  Pencil,
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
import FinanzasPulso from "./FinanzasPulso";
import FinanzasTrayectoria from "./FinanzasTrayectoria";
import FinanzasCalendario from "./FinanzasCalendario";
import FinanzasPresupuesto from "./FinanzasPresupuesto";
import FinanzasDestino from "./FinanzasDestino";
import FinanzasCuentas from "./FinanzasCuentas";
import FinanzasDeudas from "./FinanzasDeudas";
import FinanzasPlanDeudas from "./FinanzasPlanDeudas";
import FinanzasTarjetas from "./FinanzasTarjetas";
import FinanzasFondo from "./FinanzasFondo";
import FinanzasObjetivos from "./FinanzasObjetivos";
import FinanzasPatrimonio from "./FinanzasPatrimonio";
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

/**
 * Las subáreas, con la pregunta que contesta cada una.
 *
 * ============================================================
 * POR QUÉ PREGUNTAS Y NO NOMBRES DE TABLA
 * ============================================================
 *
 * Personal llegó a diecisiete tarjetas apiladas. Cada una funcionaba y el
 * conjunto era ilegible: quien entraba a ver si podía comprar algo tenía que
 * pasar por su patrimonio, sus tarjetas y su fondo de emergencia para llegar.
 *
 * Los nombres son la pregunta que trae la persona, no el módulo que la
 * contesta. "Lo que debo" y no "Deudas y plan de pago": el segundo describe
 * el código, el primero describe a quien lo mira.
 *
 * ============================================================
 * EL ALTA RÁPIDA NO ESTÁ ACÁ ADENTRO
 * ============================================================
 *
 * Es lo que más se usa —anotar un gasto es la acción diaria— y esconderla
 * detrás de una pestaña la haría desaparecer. Queda arriba, siempre visible,
 * junto con el panel de "¿estoy bien?".
 */
const SUBAREAS = [
  ["hoy", "¿Cómo estoy?"],
  ["mes", "Mi mes"],
  ["viene", "Lo que viene"],
  ["fue", "En qué se fue"],
  ["tengo", "Lo que tengo"],
  ["debo", "Lo que debo"],
  ["quiero", "Lo que quiero"],
] as const;

type Subarea = (typeof SUBAREAS)[number][0];

function dia(iso: string): string {
  const [, mes, numero] = iso.split("-");
  return `${numero}/${mes}`;
}

/**
 * Lo que "Lo que viene", "Lo que debo" y "Lo que quiero" muestran mientras
 * no haya Constitución Financiera — en vez de la pestaña completamente en
 * blanco que dejaban sus tarjetas, todas calladas a la vez.
 */
function AvisoSinConfigurar({ texto }: { texto: string }) {
  return (
    <div className="card">
      <div className="card-title">Todavía no hay nada que mostrar acá</div>
      <p className="prose">{texto}</p>
      <p className="prose" style={{ marginTop: 8 }}>
        Contale a EOS tu situación con una frase, o configurá tus finanzas arriba en{" "}
        <strong>¿Cómo estoy?</strong>
      </p>
    </div>
  );
}

type GastosViewProps = {
  /** Abre el chat completo. Sin esto, lo único que se puede hacer acá es
      anotar una línea o tocar los datos ya cargados — para preguntar algo
      ("¿cuánto gasté en comida este mes?") no había ningún camino visible
      de vuelta al chat. */
  onOpenChat?: () => void;
};

export default function GastosView({ onOpenChat }: GastosViewProps) {
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [totales, setTotales] = useState<Total[]>([]);
  const [ventana, setVentana] = useState<"semana" | "mes" | "trimestre">("mes");
  const [subarea, setSubarea] = useState<Subarea>("hoy");
  const [cargando, setCargando] = useState(true);
  const [nuncaCargo, setNuncaCargo] = useState(true);
  const [error, setError] = useState("");

  /** Qué fila está abierta para editar. Una sola por vez. */
  const [editando, setEditando] = useState<string | null>(null);

  /**
   * Si la Constitución Financiera ya está configurada. `null` mientras no se
   * sabe todavía (recién montó). La usan "Lo que viene", "Lo que debo" y
   * "Lo que quiero" para no quedar completamente en blanco — ver el
   * comentario en `FinanzasPanel`.
   */
  const [finanzasConfigurada, setFinanzasConfigurada] = useState<boolean | null>(null);

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

  /**
   * Editar un movimiento entero, no sólo su categoría.
   *
   * ============================================================
   * LO QUE LA PANTALLA NO DEJABA HACER
   * ============================================================
   *
   * `PATCH /api/finanzas/diario/[id]` acepta tipo, monto, descripción,
   * fecha, moneda y categoría desde siempre. De todo eso, esta pantalla
   * exponía UNA: el desplegable de categoría. Lo demás sólo se podía
   * arreglar borrando la fila y volviéndola a cargar.
   *
   * Una usuaria lo dijo así: "no puede modificar nada". Tenía razón —y el
   * agujero no estaba en el servidor, que sabía hacerlo, sino en que nadie
   * se lo pedía.
   *
   * El monto es el campo que más se corrige, porque es el que EOS entiende
   * mal cuando el número se dicta: 800.000 donde se dijo 80.000. Desde el
   * chat eso ya se arregla con CORREGIR_MOVIMIENTO (v148); desde acá, hasta
   * hoy, no.
   */
  async function guardarEdicion(m: Movimiento, cambios: Record<string, unknown>) {
    const respuesta = await fetch(`/api/finanzas/diario/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cambios),
    });

    if (!respuesta.ok) {
      const datos = await respuesta.json().catch(() => null);
      setError(datos?.error || "No pudimos guardar el cambio.");
      return false;
    }

    setEditando(null);
    await cargar();
    return true;
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="page-header">
            <div className="page-eyebrow">Personal</div>
            <div className="page-title">Tu plata, aparte de la del negocio</div>
            <div className="page-sub">
              Lo que cobrás y lo que gastás vos. Nada de lo que anotes acá entra en las cuentas de
              Negocio, ni al revés.
            </div>
          </div>
          {onOpenChat && (
            <button type="button" className="ghost-btn" onClick={onOpenChat} style={{ flexShrink: 0 }}>
              <MessageCircle size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
              Preguntale a EOS
            </button>
          )}
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
        <FinanzasPanel onConfiguradoChange={setFinanzasConfigurada} />

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

      {/*
        Las subáreas. Mismo vocabulario visual que el resto del producto
        (`chip-row` + `chip.active`), que ya funciona en claro y en oscuro y
        se envuelve solo en pantalla angosta — que es lo que hace falta en un
        teléfono, mejor que un carrusel horizontal donde las últimas no se ven.
      */}
      <div className="chip-row" role="tablist" aria-label="Secciones de Personal">
        {SUBAREAS.map(([clave, etiqueta]) => (
          <button
            key={clave}
            type="button"
            role="tab"
            aria-selected={subarea === clave}
            className={`chip${subarea === clave ? " active" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => setSubarea(clave)}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {subarea === "hoy" && <FinanzasPulso moneda={monedaPrincipal} />}

      {subarea === "mes" && (
        <>
          {/*
            El presupuesto primero: "cuánto puedo gastar" es la pregunta de
            todos los días y "cómo viene el saldo" la de cada tanto. Y el
            presupuesto da la conclusión —vas a cerrar por encima o por
            debajo— que el resumen de abajo después respalda.
          */}
          <FinanzasPresupuesto moneda={monedaPrincipal} />
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
        </>
      )}

      {/*
        El reparto.
        ============================================================

        Cada tarjeta se calla sola cuando no tiene nada que decir, así que
        quien recién empieza no ve cajas vacías dentro de las pestañas.

        Los hallazgos y el score del pulso salen del MISMO motor que usa el
        negocio (`lib/kpi/anomalias.ts` y `lib/kpi/score.ts`). Dos formas de
        decidir qué es grave habrían divergido en un mes, y la misma persona
        vería un criterio en su empresa y otro en su vida.
      */}

      {/*
        La curva y la lista, juntas y en ese orden. La curva contesta cuánto
        va a haber; la lista, qué va a pasar. Separadas, alguien que ve la
        línea bajar el 25 tiene que ir a buscar por qué.
      */}
      {subarea === "viene" && (
        <>
          {finanzasConfigurada === false && (
            <AvisoSinConfigurar texto="Para proyectar lo que se viene, EOS necesita un punto de partida: cuánto tenés hoy y qué gastos fijos ya sabés que llegan." />
          )}
          <FinanzasTrayectoria />
          <FinanzasCalendario moneda={monedaPrincipal} />
        </>
      )}


      {/*
        "¿Cuánto tengo?" son las cuentas y el patrimonio: la primera es la
        plata que puede tocar hoy, el segundo es todo lo que tiene menos lo
        que debe. Van juntas porque quien se hace una se hace la otra.
      */}
      {subarea === "tengo" && (
        <>
          <FinanzasCuentas moneda={monedaPrincipal} />
          <FinanzasPatrimonio moneda={monedaPrincipal} />
        </>
      )}

      {/*
        Las deudas: a quién le debe, en qué orden pagar y por dónde sigue
        endeudándose. Las tarjetas van con ellas porque son una deuda con
        calendario propio, y después del plan porque el plan ordena lo que ya
        se debe.
      */}
      {subarea === "debo" && (
        <>
          {finanzasConfigurada === false && (
            <AvisoSinConfigurar texto="Contale a EOS tus deudas y tarjetas —a quién le debés, cuánto y desde cuándo— y las vas a ver acá ordenadas, con un plan de pago." />
          )}
          <FinanzasDeudas />
          <FinanzasPlanDeudas moneda={monedaPrincipal} />
          <FinanzasTarjetas moneda={monedaPrincipal} />
        </>
      )}

      {/*
        El fondo va antes que los objetivos porque los sostiene: juntar para
        un terreno sin colchón termina en gastar el terreno la primera vez que
        algo sale mal.
      */}
      {subarea === "quiero" && (
        <>
          {finanzasConfigurada === false && (
            <AvisoSinConfigurar texto="Decile a EOS para qué estás juntando —un fondo, un viaje, lo que sea— y con cuánto contás, y te dice el aporte por mes y si vas al ritmo." />
          )}
          <FinanzasFondo moneda={monedaPrincipal} />
          <FinanzasObjetivos moneda={monedaPrincipal} />
        </>
      )}

      {/*
        "¿En qué se fue?" en un solo lugar: el desglose por destino, el
        papel para el contador y la lista renglón por renglón. Estaban
        separados por seis tarjetas de otros temas.
      */}
      {subarea === "fue" && (
        <>
          <FinanzasDestino />
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

                  {/*
                    Una devolución es un gasto de monto NEGATIVO (v141), y así es
                    como resta sola en las veintitrés consultas que suman gastos.
                    Acá hay que deshacer ese truco: "− ₲ -200.000" no lo entiende
                    nadie. Se muestra con el signo que corresponde y el monto en
                    positivo, que es lo que la persona vio en su cuenta.
                  */}
                  <span className={`neg-fila-monto ${m.monto < 0 ? "ingreso" : m.tipo}`}>
                    {m.tipo === "ingreso" || m.monto < 0 ? "+" : "−"}{" "}
                    {formatearMonto(Math.abs(m.monto), m.moneda)}
                  </span>

                  {m.editable ? (
                    <>
                      {/*
                        Editar va ANTES de borrar, y no es orden alfabético:
                        hasta hoy borrar era la única forma de arreglar un
                        monto mal anotado, y quien aprendió ese camino lo
                        sigue usando si el otro no está primero.
                      */}
                      <button
                        type="button"
                        className="chip"
                        aria-label={`Editar ${m.descripcion}`}
                        onClick={() => setEditando(editando === m.id ? null : m.id)}
                      >
                        <Pencil size={13} />
                      </button>

                      <button
                        type="button"
                        className="chip"
                        aria-label={`Borrar ${m.descripcion}`}
                        onClick={() => void borrar(m)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
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

                  {editando === m.id && (
                    <EditarMovimiento
                      movimiento={m}
                      onCancelar={() => setEditando(null)}
                      onGuardar={(cambios) => guardarEdicion(m, cambios)}
                    />
                  )}
                </div>
              ))
            )}
            </div>
        </>
      )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Corregir un movimiento sin borrarlo y volverlo a cargar.
 *
 * ============================================================
 * POR QUÉ ES UN FORMULARIO Y NO CAMPOS SUELTOS EN LA FILA
 * ============================================================
 *
 * El desplegable de categoría guarda al soltar, y está bien: elegir de una
 * lista no tiene estados intermedios. Un monto sí los tiene — "8", "80",
 * "800" son todos válidos mientras se escribe— y guardar en cada tecla
 * dejaría en la base tres versiones falsas antes de la buena.
 *
 * Así que el monto, la descripción y la fecha se editan juntos y se guardan
 * cuando la persona lo dice.
 *
 * ============================================================
 * EL SIGNO NO SE EDITA ACÁ
 * ============================================================
 *
 * Una devolución es un gasto de monto NEGATIVO (v141), y así es como resta
 * sola en las veintitrés consultas que suman gastos. Si este formulario
 * dejara escribir el monto con signo, cualquiera podría convertir un gasto en
 * una devolución sin querer.
 *
 * Se edita el valor ABSOLUTO y se le devuelve el signo que la fila ya tenía.
 * Cambiar de gasto a ingreso es otra cosa —y para eso está el desplegable de
 * tipo, que sí es explícito—.
 */
function EditarMovimiento({
  movimiento,
  onCancelar,
  onGuardar,
}: {
  movimiento: Movimiento;
  onCancelar: () => void;
  onGuardar: (cambios: Record<string, unknown>) => Promise<boolean>;
}) {
  const [monto, setMonto] = useState(String(Math.abs(movimiento.monto)));
  const [descripcion, setDescripcion] = useState(movimiento.descripcion);
  const [fecha, setFecha] = useState(movimiento.fecha.slice(0, 10));
  const [tipo, setTipo] = useState<"ingreso" | "gasto">(movimiento.tipo);
  const [guardando, setGuardando] = useState(false);

  /** Era una devolución: el monto guardado es negativo y así tiene que seguir. */
  const esDevolucion = movimiento.monto < 0;

  async function guardar() {
    const valor = Number(monto);

    if (!Number.isFinite(valor) || valor <= 0) return;

    setGuardando(true);

    await onGuardar({
      tipo,
      monto: esDevolucion ? -Math.abs(valor) : Math.abs(valor),
      descripcion: descripcion.trim(),
      fecha,
    });

    setGuardando(false);
  }

  return (
    <div className="fila-editor">
      <div className="fila-editor-campos">
        <input
          className="neg-input"
          value={descripcion}
          maxLength={200}
          autoFocus
          placeholder="En qué fue"
          onChange={(e) => setDescripcion(e.target.value)}
        />

        <input
          className="neg-input neg-cantidad"
          type="number"
          min={0}
          value={monto}
          placeholder="Monto"
          title="El monto, sin signo: el signo lo pone el tipo"
          onChange={(e) => setMonto(e.target.value)}
        />

        <input
          className="neg-input neg-cantidad"
          type="date"
          value={fecha}
          title="Cuándo pasó"
          onChange={(e) => setFecha(e.target.value)}
        />

        {/*
          El tipo se puede cambiar, y hace falta: "cobré" e "invertí" se
          parecen lo suficiente como para que EOS equivoque el signo, y un
          gasto contado como ingreso mueve el disponible al doble para el lado
          que no es.

          Una devolución no aparece: no es un tipo, es un gasto negativo, y
          convertirla desde acá sería cambiar dos cosas con un solo clic.
        */}
        {!esDevolucion && (
          <select
            className="neg-input neg-cantidad"
            value={tipo}
            aria-label="Tipo de movimiento"
            onChange={(e) => setTipo(e.target.value as "ingreso" | "gasto")}
          >
            <option value="gasto">Gasto</option>
            <option value="ingreso">Ingreso</option>
          </select>
        )}
      </div>

      {/* La misma clase que usa el editor de productos: dos botones en fila. */}
      <div className="anular-acciones">
        <button type="button" className="chip active" disabled={guardando} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="chip" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
