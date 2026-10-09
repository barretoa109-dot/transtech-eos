"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Lock,
  MessageCircle,
  Pencil,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";
import { DESTINOS } from "@/lib/finanzas/destinos";
import { numeroEscrito } from "@/lib/finanzas/gastoRapido";

/*
  El bloque financiero personal vivía en Dashboard y esta pantalla era una
  entrada y una lista. El material estaba al lado, en otra sección: por eso
  Personal se sentía pobre. Acá se reúne todo lo que es de la persona.
*/
import ComoVenis from "./ComoVenis";
import FinanzasPanel from "./FinanzasPanel";
import FinanzasPulso, { FinanzasPuedoComprar } from "./FinanzasPulso";
import FinanzasSetup from "./FinanzasSetup";
import FinanzasBuzon from "./FinanzasBuzon";
import { SubNav, seccionDe, type Seccion } from "./SeccionNav";
import { useEtiquetaEspacio } from "./EspacioContext";
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
  /** La categoría se puede decir aunque el monto no: también para los del correo. */
  categoriaEditable: boolean;
};

type Total = { moneda: string; entro: number; salio: number; balance: number };

const VENTANAS = [
  ["semana", "7 días"],
  ["mes", "30 días"],
  ["trimestre", "90 días"],
] as const;

/**
 * Las pestañas y sus partes, con la pregunta que contesta cada una.
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
 * contesta. "Tengo y debo" y no "Cuentas, patrimonio y pasivos": el segundo
 * describe el código, el primero describe a quien lo mira.
 *
 * ============================================================
 * CINCO PESTAÑAS, NO SIETE CHIPS
 * ============================================================
 *
 * Eran siete chips del mismo peso. Ahora son cinco pestañas, el mismo
 * esqueleto que Negocio (`SeccionNav`), con la misma lista de componentes:
 * "En qué se fue" entró a "Mi mes" —es la otra mitad de cómo viene el mes—,
 * y "Lo que tengo" con "Lo que debo" son una sola pestaña porque quien se
 * pregunta una se pregunta la otra. La configuración que vivía adentro del
 * panel de arriba (datos base, fijos, buzón del banco) pasó al engranaje.
 *
 * ============================================================
 * EL ALTA RÁPIDA NO ESTÁ ACÁ ADENTRO
 * ============================================================
 *
 * Es lo que más se usa —anotar un gasto es la acción diaria— y esconderla
 * detrás de una pestaña la haría desaparecer. Queda arriba, siempre visible,
 * junto con el panel de "¿estoy bien?".
 */
export type SeccionPersonal = "hoy" | "mes" | "viene" | "tengo" | "metas" | "informes" | "ajustes";

export type Subarea =
  | "estoy"
  | "comprar"
  | "presupuesto"
  | "fue"
  | "movimientos"
  | "balance"
  | "curva"
  | "calendario"
  | "cuentas"
  | "patrimonio"
  | "deudas"
  | "tarjetas"
  | "fondo"
  | "objetivos"
  | "base"
  | "buzon";

const SECCIONES: Seccion<SeccionPersonal, Subarea>[] = [
  {
    clave: "hoy",
    etiqueta: "Hoy",
    subs: [
      { clave: "estoy", etiqueta: "¿Cómo estoy?", detalle: "Tu número, qué cambió y por qué" },
    ],
  },
  {
    clave: "mes",
    etiqueta: "Mi mes",
    subs: [
      { clave: "presupuesto", etiqueta: "Cuánto me queda", detalle: "Lo que tenés para el día a día y cómo venís" },
      { clave: "fue", etiqueta: "En qué se fue", detalle: "A dónde va tu plata" },
      { clave: "movimientos", etiqueta: "Movimientos", detalle: "Todo lo anotado, para revisar o corregir" },
    ],
  },
  {
    clave: "viene",
    etiqueta: "Lo que viene",
    subs: [
      { clave: "curva", etiqueta: "Próximos 45 días", detalle: "Cómo va a quedar tu saldo" },
      { clave: "calendario", etiqueta: "Calendario de pagos", detalle: "Qué vence y cuándo" },
    ],
  },
  {
    clave: "tengo",
    etiqueta: "Tengo y debo",
    subs: [
      { clave: "cuentas", etiqueta: "Cuentas", detalle: "Bancos, billeteras, cooperativas y efectivo" },
      { clave: "patrimonio", etiqueta: "Patrimonio", detalle: "Lo que tenés menos lo que debés" },
      { clave: "deudas", etiqueta: "Deudas", detalle: "A quién le debés y en qué orden pagar" },
      { clave: "tarjetas", etiqueta: "Tarjetas", detalle: "Límites, cierres y vencimientos" },
    ],
  },
  {
    clave: "metas",
    etiqueta: "Mis metas",
    subs: [
      { clave: "fondo", etiqueta: "Fondo de emergencia", detalle: "Tu colchón para imprevistos" },
      { clave: "objetivos", etiqueta: "Objetivos", detalle: "Lo que querés lograr, en plata por mes" },
    ],
  },
  {
    clave: "informes",
    etiqueta: "Informes",
    subs: [
      { clave: "balance", etiqueta: "Llevate tu balance", detalle: "Tus movimientos en PDF, Excel o Word" },
      { clave: "comprar", etiqueta: "¿Puedo comprarlo?", detalle: "Probá una compra antes de hacerla" },
    ],
  },
  {
    clave: "ajustes",
    etiqueta: "Ajustes",
    ajuste: true,
    subs: [
      { clave: "base", etiqueta: "Mis datos base", detalle: "Lo que EOS te preguntó una sola vez" },
      { clave: "buzon", etiqueta: "Avisos del banco", detalle: "Reenviá los correos del banco y EOS anota solo" },
    ],
  },
];

/**
 * Qué decir cuando una subpestaña queda en blanco.
 *
 * Varias tarjetas se callan solas cuando no tienen nada que decir, a
 * propósito: así una cuenta nueva no ve cajas vacías. Pero cuando una
 * subpestaña tiene una sola tarjeta y esa se calla, no queda nada, y una
 * pantalla vacía se lee como algo roto. Esto dice qué va a aparecer ahí y
 * cómo llegar. Las subpestañas que siempre muestran algo no están.
 */
/** El título de cada sección de Personal, ahora que cada una es una entrada del menú. */
const ENCABEZADOS: Record<SeccionPersonal, { titulo: string; sub: string }> = {
  hoy: {
    titulo: "Inicio",
    sub: "Cómo estás hoy. Acá cuenta solo tu plata personal: lo del negocio está en su propio espacio.",
  },
  mes: { titulo: "Ingresos y gastos", sub: "Lo que entró y salió de tu bolsillo, en qué se fue y cada movimiento." },
  viene: { titulo: "Lo que viene", sub: "Qué vence, qué cobrás y cómo va a quedar tu saldo." },
  tengo: { titulo: "Tengo y debo", sub: "Tus cuentas, tu patrimonio, tus deudas y tus tarjetas." },
  metas: { titulo: "Mis metas", sub: "Lo que querés lograr, dicho en plata por mes." },
  informes: { titulo: "Informes", sub: "Tu balance para llevar y la prueba de una compra antes de hacerla." },
  ajustes: { titulo: "Ajustes de Personal", sub: "Lo que EOS te preguntó una sola vez y los avisos del banco." },
};

const VACIO: Partial<Record<Subarea, string>> = {
  estoy: "Acá vas a ver tu puntaje financiero, qué cambió y por qué.",
  presupuesto: "Acá vas a ver cuánto te queda para el día a día hasta tu próximo cobro.",
  fue: "Acá vas a ver a dónde va tu plata, agrupada por destino y comparada con el mes anterior.",
  curva: "Acá vas a ver cómo va a quedar tu saldo en los próximos 45 días.",
  calendario: "Acá vas a ver lo que vence y lo que cobrás, en orden, con el saldo que va quedando.",
  cuentas: "Acá vas a ver tus cuentas: bancos, billeteras, cooperativas y efectivo.",
  patrimonio: "Acá vas a ver lo que tenés menos lo que debés.",
  deudas: "Acá vas a ver a quién le debés y en qué orden conviene pagar.",
  tarjetas: "Acá vas a ver tus tarjetas: cuánto usaste, cuándo cierran y cuándo vencen.",
  fondo: "Acá vas a ver tu fondo de emergencia: cuánto tenés, cuánto te falta y a qué ritmo llegás.",
  objetivos: "Acá vas a ver lo que querés lograr, dicho en plata por mes.",
};

// Valor del desplegable de categoría que abre el cuadro para escribir una propia.
const NUEVA_CATEGORIA = "__nueva__";

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
        Contale a EOS tu situación con una frase, o tocá <strong>Configurar mis finanzas</strong> en
        Ajustes de Personal.
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
  /** La sección que eligió el menú del espacio (05/10/2026). */
  seccion?: SeccionPersonal;
  /** La parte que abrir primero, cuando se llega desde otra sección. */
  subInicial?: Subarea;
  /** Ir a una parte de OTRA sección: lo resuelve el menú. */
  onNavegar?: (seccion: SeccionPersonal, sub: Subarea) => void;
};

export default function GastosView({ onOpenChat, seccion = "hoy", subInicial, onNavegar }: GastosViewProps) {
  const etiquetaEspacio = useEtiquetaEspacio();
  const confSeccion = SECCIONES.find((x) => x.clave === seccion) ?? SECCIONES[0];
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [totales, setTotales] = useState<Total[]>([]);
  const [ventana, setVentana] = useState<"semana" | "mes" | "trimestre">("mes");
  // Destino por el que se filtra la lista de movimientos, si se llegó desde "En qué se fue".
  const [filtroDestino, setFiltroDestino] = useState<{ clave: string; etiqueta: string } | null>(null);
  const [subarea, setSubarea] = useState<Subarea>(
    subInicial && seccionDe(SECCIONES, subInicial) === seccion ? subInicial : confSeccion.subs[0].clave,
  );
  /**
   * Sube cuando algo de Ajustes cambia lo que el panel de arriba calcula
   * (los datos base, los fijos). La `key` del panel lo vuelve a leer.
   */
  const [versionPanel, setVersionPanel] = useState(0);
  /**
   * Si el detalle completo de "¿Cómo estoy?" está abierto. El resumen de
   * arriba (las 4 tarjetas) ya responde "¿estoy bien?" con el mismo
   * disponible real; repetirlo entero debajo, siempre abierto, era la
   * duplicación más visible de la pantalla (maqueta de reorganización de
   * Personal, 2026-10).
   */
  const [detalleInicioAbierto, setDetalleInicioAbierto] = useState(false);
  const [editandoBase, setEditandoBase] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [nuncaCargo, setNuncaCargo] = useState(true);
  const [error, setError] = useState("");

  function irA(destino: Subarea) {
    const suya = seccionDe(SECCIONES, destino);
    if (suya !== seccion && onNavegar) {
      onNavegar(suya, destino);
      return;
    }
    setSubarea(destino);
    setEditandoBase(false);
  }

  /** Qué fila está abierta para editar. Una sola por vez. */
  const [editando, setEditando] = useState<string | null>(null);

  /**
   * Si la Constitución Financiera ya está configurada. `null` mientras no se
   * sabe todavía (recién montó). La usan "Lo que viene", "Lo que debo" y
   * "Lo que quiero" para no quedar completamente en blanco — ver el
   * comentario en `FinanzasPanel`.
   */
  const [finanzasConfigurada, setFinanzasConfigurada] = useState<boolean | null>(null);

  /*
   * Si "Tengo y debo" ya tiene tarjetas o deudas cargadas. El aviso de "no hay
   * nada" va solo cuando de verdad no hay nada: el chat carga tarjetas y deudas
   * sin pasar por la configuración, y el 29/09/2026 ese aviso tapaba una
   * tarjeta con cinco compras guardadas.
   */
  const [hayTarjetas, setHayTarjetas] = useState(false);
  const [hayDeudas, setHayDeudas] = useState(false);

  /*
   * Fuera de Inicio el panel no se muestra, pero las demás secciones igual
   * necesitan saber si las finanzas están configuradas: es lo que decide si
   * "Lo que viene" muestra la curva o el aviso de por dónde empezar. Se
   * pregunta lo mismo que pregunta el panel, y con el mismo criterio.
   */
  useEffect(() => {
    if (seccion === "hoy") return;
    let vigente = true;
    fetch("/api/finanzas/estado", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((datos) => {
        if (vigente && datos) setFinanzasConfigurada(datos.configurado === true && !datos.desde_cuentas);
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [seccion, versionPanel]);

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

  async function anotar(tipo?: "ingreso" | "gasto") {
    const linea = texto.trim();
    if (!linea || guardando) return;

    setGuardando(true);
    setErrorAlta("");

    try {
      const respuesta = await fetch("/api/finanzas/rapido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: linea, tipo }),
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
      // El panel de arriba y las tarjetas de la pestaña también cambian con este
      // movimiento: sin esto, el saldo seguía igual hasta recargar la página.
      setVersionPanel((v) => v + 1);
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
    // El panel de arriba y las tarjetas de la pestaña también cambian con este
    // movimiento: sin esto, el saldo seguía igual hasta recargar la página.
    setVersionPanel((v) => v + 1);
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
    // El panel de arriba y las tarjetas de la pestaña también cambian con este
    // movimiento: sin esto, el saldo seguía igual hasta recargar la página.
    setVersionPanel((v) => v + 1);
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
            <div className="page-eyebrow">{etiquetaEspacio}</div>
            <div className="page-title">{ENCABEZADOS[seccion].titulo}</div>
            <div className="page-sub">{ENCABEZADOS[seccion].sub}</div>
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

          Arriba quedan el panel y lo que EOS necesita que confirmes —la
          conciliación y los movimientos que detectó—, que aparece solo cuando
          hay algo. Los datos base, los fijos y el buzón del banco se
          configuran una vez y viven en el engranaje de Ajustes.
        */}
        {seccion === "hoy" && (
          <FinanzasPanel
            key={`resumen-${versionPanel}`}
            modo="resumen"
            sinAjustes
            onConfiguradoChange={setFinanzasConfigurada}
            onVerDetalle={() => irA("estoy")}
          />
        )}

        {/*
          La línea para anotar, en una sola fila como en Negocio: el ícono de
          EOS, la frase y el botón. Lo que EOS entendió aparece abajo.
        */}
        {(seccion === "hoy" || seccion === "mes") && (
        <>
        <div className="sec-decile">
          <span className="sec-decile-ico" aria-hidden="true">EOS</span>
          <input
            className="sec-decile-input"
            aria-label="Anotar un gasto o un ingreso"
            placeholder="Anotá un gasto: «gasté 35 mil en el almuerzo»"
            value={texto}
            maxLength={200}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void anotar();
            }}
          />
          <button
            type="button"
            className="btn-pri gasto-anotar"
            disabled={guardando}
            onClick={() => void anotar("gasto")}
          >
            {guardando ? "Anotando…" : "− Anotar gasto"}
          </button>
          <button
            type="button"
            className="btn-pri ingreso-anotar"
            disabled={guardando}
            onClick={() => void anotar("ingreso")}
          >
            + Anotar ingreso
          </button>
        </div>
        <p className="sec-decile-ayuda">
          Elegí si es un gasto o un ingreso y escribilo como lo contás: «gasté 50 mil en nafta», «cobré el sueldo
          3.500.000». EOS entiende el monto, la fecha y en qué fue. Las transferencias entre tus cuentas se dicen por
          el chat.
        </p>
        </>
        )}

        {/*
          Lo que EOS entendió se queda hasta la próxima carga a propósito: es la
          única defensa contra un error de lectura en un flujo que, por diseño,
          no pide confirmación.
        */}
        {entendido && <p className="gastos-entendido">{entendido}</p>}
        {errorAlta && <p className="neg-error" role="alert">{errorAlta}</p>}

      {/*
        "Hoy" tiene una sola subpestaña ("estoy"): SubNav ya oculta la fila de
        chips cuando hay una sola, pero seguía dejando su línea de
        descripción flotando sin nada que describir. Acá directamente no se
        monta — las demás secciones, con más de una subpestaña, siguen
        viéndolo igual que siempre.
      */}
      {confSeccion.subs.length > 1 && (
        <SubNav subs={confSeccion.subs} sub={subarea} onSub={irA} ariaLabel={`Partes de ${ENCABEZADOS[seccion].titulo}`} />
      )}

      <div className="sec-contenido" key={versionPanel}>
      {subarea === "estoy" && (
        <>
          <button
            type="button"
            className="fin-toggle"
            onClick={() => setDetalleInicioAbierto((v) => !v)}
            aria-expanded={detalleInicioAbierto}
          >
            <ChevronDown size={13} className={detalleInicioAbierto ? "fin-chevron-open" : ""} />
            {detalleInicioAbierto ? "Ocultar el detalle completo" : "Ver el detalle completo"}
          </button>
          {detalleInicioAbierto && <FinanzasPanel key={versionPanel} modo="detalle" sinAjustes />}
          <FinanzasPulso moneda={monedaPrincipal} conEscenario={false} />
          <ComoVenis />
        </>
      )}

      {subarea === "comprar" &&
        (finanzasConfigurada === false ? (
          <AvisoSinConfigurar texto="Para decirte si una compra te deja bien parado, EOS necesita saber cuánto tenés hoy y qué gastos fijos ya sabés que llegan." />
        ) : (
          <FinanzasPuedoComprar moneda={monedaPrincipal} />
        ))}

      {subarea === "presupuesto" && (
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
        La curva contesta cuánto va a haber; el calendario, qué va a pasar.
        Van en la misma pestaña, una al lado de la otra: alguien que ve la
        línea bajar el 25 tiene el porqué a un toque.
      */}
      {(subarea === "curva" || subarea === "calendario") && finanzasConfigurada === false && (
        <AvisoSinConfigurar texto="Para proyectar lo que se viene, EOS necesita un punto de partida: cuánto tenés hoy y qué gastos fijos ya sabés que llegan." />
      )}
      {subarea === "curva" && <FinanzasTrayectoria />}
      {subarea === "calendario" && <FinanzasCalendario moneda={monedaPrincipal} />}

      {/*
        "¿Cuánto tengo?" son las cuentas y el patrimonio: la primera es la
        plata que puede tocar hoy, el segundo es todo lo que tiene menos lo
        que debe.
      */}
      {subarea === "cuentas" && <FinanzasCuentas moneda={monedaPrincipal} />}
      {subarea === "patrimonio" && <FinanzasPatrimonio moneda={monedaPrincipal} />}

      {/*
        Las deudas: a quién le debe y en qué orden pagar, juntas porque el
        plan ordena lo que ya se debe. Las tarjetas aparte: son una deuda con
        calendario propio.
      */}
      {((subarea === "deudas" && !hayDeudas) || (subarea === "tarjetas" && !hayTarjetas)) &&
        finanzasConfigurada === false && (
        <AvisoSinConfigurar texto="Contale a EOS tus deudas y tarjetas —a quién le debés, cuánto y desde cuándo— y las vas a ver acá ordenadas, con un plan de pago." />
      )}
      {subarea === "deudas" && (
        <>
          <FinanzasDeudas onHayDatos={setHayDeudas} />
          <FinanzasPlanDeudas moneda={monedaPrincipal} />
        </>
      )}
      {subarea === "tarjetas" && <FinanzasTarjetas moneda={monedaPrincipal} onHayDatos={setHayTarjetas} />}

      {/*
        El fondo va primero porque sostiene a los objetivos: juntar para un
        terreno sin colchón termina en gastar el terreno la primera vez que
        algo sale mal.
      */}
      {(subarea === "fondo" || subarea === "objetivos") && finanzasConfigurada === false && (
        <AvisoSinConfigurar texto="Decile a EOS para qué estás juntando —un fondo, un viaje, lo que sea— y con cuánto contás, y te dice el aporte por mes y si vas al ritmo." />
      )}
      {subarea === "fondo" && <FinanzasFondo moneda={monedaPrincipal} />}
      {subarea === "objetivos" && <FinanzasObjetivos moneda={monedaPrincipal} />}

      {/*
        Ajustes: lo que se configura una vez. Antes vivía apilado arriba del
        panel de "¿estoy bien?". Cuando algo de acá cambia lo que el panel
        calcula, `versionPanel` lo vuelve a leer.
      */}
      {subarea === "base" &&
        (editandoBase ? (
          <FinanzasSetup
            onListo={() => {
              setEditandoBase(false);
              setVersionPanel((v) => v + 1);
            }}
            onCancelar={() => setEditandoBase(false)}
          />
        ) : (
          <div className="card">
            <div className="card-title">Mis datos base</div>
            <p className="prose">
              {finanzasConfigurada === false
                ? "Todavía no le contaste a EOS tu punto de partida: cuánto tenés, cuánto querés tener siempre de reserva y cuánto ahorrar. Son unas pocas preguntas, una sola vez."
                : "Las preguntas que EOS te hizo una sola vez: cuánto tenías, tu reserva mínima y cuánto querés ahorrar. Cambialas solo si algo cambió de verdad; EOS recalcula todo con lo nuevo."}
            </p>
            <button type="button" className="reco-btn" style={{ marginTop: 12 }} onClick={() => setEditandoBase(true)}>
              {finanzasConfigurada === false ? "Configurar mis finanzas" : "Revisar mis datos base"}
            </button>
          </div>
        ))}

      {subarea === "buzon" && <FinanzasBuzon explicarAusencia />}

      {/*
        "¿En qué se fue?" en tres partes de "Mi mes": el desglose por destino,
        el papel para el contador y la lista renglón por renglón.
      */}
      {subarea === "fue" && (
        <FinanzasDestino
          onRevisarPorClasificar={() => {
            setFiltroDestino(null);
            irA("movimientos");
          }}
          onVerDestino={(clave, etiqueta) => {
            setFiltroDestino({ clave, etiqueta });
            irA("movimientos");
          }}
        />
      )}
      {subarea === "balance" && <FinanzasInforme />}

      {subarea === "movimientos" && (
        <>
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

            {/*
              El mismo período que "Cómo venís": antes se elegía allá y esta
              lista lo seguía sin decirlo. Acá se ve y se cambia.
            */}
            <div className="neg-ventanas" role="group" aria-label="Período de los movimientos">
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

            {error && (
              <p className="neg-error" role="alert">
                <AlertCircle size={14} /> {error}
              </p>
            )}

            {filtroDestino && (
              <div className="dest-pendiente" role="status">
                <span>
                  Mostrando solo <strong>{filtroDestino.etiqueta}</strong>
                </span>
                <button type="button" className="chip" onClick={() => setFiltroDestino(null)}>
                  Ver todos
                </button>
              </div>
            )}

            <PorClasificar
              movimientos={movimientos.filter((m) => m.categoria === "otros")}
              opciones={DESTINOS.filter((d) => d.clave !== "otros")}
              onElegir={(m, valor) => void recategorizar(m, valor)}
            />
            <ReglasAprendidas />

            {movimientos.length === 0 ? (
              <div className="neg-empty-state">
                <Wallet size={28} />
                <strong>Sin movimientos en el período</strong>
                <p>Los que anotes, los que lleguen del correo de tu banco y los de tus ventas aparecen todos acá.</p>
              </div>
            ) : (
              (filtroDestino ? movimientos.filter((m) => m.categoria === filtroDestino.clave) : movimientos).map((m) => (
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

                    {m.categoriaEditable && (
                      <select
                        className="neg-input gastos-categoria"
                        value={m.categoria}
                        aria-label={`Categoría de ${m.descripcion}`}
                        onChange={(e) => {
                          if (e.target.value !== NUEVA_CATEGORIA) {
                            void recategorizar(m, e.target.value);
                            return;
                          }
                          // Una categoría propia viaja con el texto que escribió la
                          // persona, con sus tildes. La clave normalizada sólo agrupa.
                          const texto = window.prompt("¿Cómo se llama la categoría? Por ejemplo: Granja, Mascotas.");
                          if (texto?.trim()) void recategorizar(m, texto.trim());
                        }}
                      >
                        {DESTINOS.map((d) => (
                          <option key={d.clave} value={d.clave}>
                            {d.etiqueta}
                          </option>
                        ))}
                        {!DESTINOS.some((d) => d.clave === m.categoria) && (
                          <option value={m.categoria}>{m.etiqueta}</option>
                        )}
                        <option value={NUEVA_CATEGORIA}>+ Nueva categoría…</option>
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

      {/*
        Lo que se muestra si la subpestaña quedó en blanco. Solo CSS: aparece
        cuando `.sec-contenido` está vacío (`:empty`) y con un momento de
        demora, para no asomar mientras las tarjetas todavía cargan.
      */}
      {VACIO[subarea] && (
        <div className="card sec-vacio" key={`${subarea}-${versionPanel}`}>
          <div className="card-title">Todavía no hay nada que mostrar acá</div>
          <p className="prose">{VACIO[subarea]}</p>
          <p className="prose" style={{ marginTop: 8 }}>
            {finanzasConfigurada === false
              ? "Para empezar, tocá «Configurar mis finanzas» en el panel de arriba: son unas pocas preguntas, una sola vez."
              : "Anotá tus movimientos arriba o contáselos a EOS en el chat, y esto se completa solo."}
          </p>
        </div>
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
/**
 * Lo que EOS todavía no sabe clasificar, con la respuesta a mano.
 *
 * Una elección por movimiento. Se guarda como regla: los parecidos dejan de
 * caer acá solos. Si no hay nada, no se muestra nada.
 */
function PorClasificar({
  movimientos,
  opciones,
  onElegir,
}: {
  movimientos: Movimiento[];
  opciones: { clave: string; etiqueta: string }[];
  onElegir: (m: Movimiento, valor: string) => void;
}) {
  if (movimientos.length === 0) return null;

  const rapidas = opciones.slice(0, 6);

  return (
    <div className="card por-clasificar" role="region" aria-label="Movimientos por clasificar">
      <div className="card-title">
        Hay {movimientos.length}{" "}
        {movimientos.length === 1 ? "movimiento que necesito clasificar" : "movimientos que necesito clasificar"}
      </div>
      <div className="card-sub">Elegí una vez. EOS recuerda la categoría para los parecidos.</div>

      {movimientos.map((m) => (
        <div className="neg-fila" key={m.id}>
          <div className="neg-fila-texto">
            <strong>{m.descripcion || "Sin detalle"}</strong>
            <small>
              {dia(m.fecha)} · {formatearMonto(Math.abs(m.monto), m.moneda)}
            </small>
          </div>

          <div className="neg-ventanas" role="group" aria-label={`Categoría de ${m.descripcion || "este movimiento"}`}>
            {rapidas.map((o) => (
              <button key={o.clave} type="button" className="chip" onClick={() => onElegir(m, o.clave)}>
                {o.etiqueta}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              onClick={() => {
                const texto = window.prompt("¿Cómo se llama la categoría? Por ejemplo: Granja, Mascotas.");
                if (texto?.trim()) onElegir(m, texto.trim());
              }}
            >
              Otra…
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

type ReglaAprendida = { id: string; patron: string; categoria: string };

/**
 * Las correcciones que EOS recuerda. Están para poder olvidar una que salió
 * mal: una regla equivocada se ve en cada movimiento parecido, así que tiene
 * que poder deshacerse desde acá.
 */
function ReglasAprendidas() {
  const [reglas, setReglas] = useState<ReglaAprendida[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    fetch("/api/finanzas/reglas-categoria", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ reglas: ReglaAprendida[] }>) : Promise.reject(new Error())))
      .then((datos) => {
        if (vigente) setReglas(datos.reglas);
      })
      .catch(() => {
        if (vigente) setError("No pudimos cargar lo que EOS aprendió.");
      });
    return () => {
      vigente = false;
    };
  }, []);

  async function olvidar(id: string) {
    const respuesta = await fetch(`/api/finanzas/reglas-categoria?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!respuesta.ok) {
      setError("No pudimos olvidar esa regla.");
      return;
    }
    setReglas((previas) => previas.filter((r) => r.id !== id));
  }

  if (reglas.length === 0 && !error) return null;

  return (
    <div className="card">
      <div className="card-title">Lo que EOS aprendió de tus correcciones</div>
      <div className="card-sub">Cuando aparece el mismo concepto, va en esa categoría. Si salió mal, olvidala.</div>

      {error && (
        <p className="neg-error" role="alert">
          <AlertCircle size={14} /> {error}
        </p>
      )}

      {reglas.map((r) => (
        <div className="neg-fila" key={r.id}>
          <div className="neg-fila-texto">
            <strong>{r.patron}</strong>
            <small>→ {r.categoria}</small>
          </div>
          <button type="button" className="chip" onClick={() => void olvidar(r.id)}>
            Olvidar
          </button>
        </div>
      ))}
    </div>
  );
}

function EditarMovimiento({
  movimiento,
  onCancelar,
  onGuardar,
}: {
  movimiento: Movimiento;
  onCancelar: () => void;
  onGuardar: (cambios: Record<string, unknown>) => Promise<boolean>;
}) {
  /*
   * El monto se muestra y se escribe como en Paraguay: "14.550", con punto de
   * miles. Antes era un campo numérico del navegador, que en español leía
   * "14.550" como 14,55 y guardaba catorce guaraníes.
   */
  const [monto, setMonto] = useState(
    new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 }).format(Math.abs(movimiento.monto)),
  );
  const [descripcion, setDescripcion] = useState(movimiento.descripcion);
  const [fecha, setFecha] = useState(movimiento.fecha.slice(0, 10));
  const [tipo, setTipo] = useState<"ingreso" | "gasto">(movimiento.tipo);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState("");

  /** Era una devolución: el monto guardado es negativo y así tiene que seguir. */
  const esDevolucion = movimiento.monto < 0;

  async function guardar() {
    const valor = numeroEscrito(monto.replace(/[^\d.,]/g, ""));

    if (valor === null || valor <= 0) {
      setAviso("Escribí el monto en números, por ejemplo 14.550.");
      return;
    }

    setAviso("");
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
      {/* Cada campo con su nombre: sin eso no se sabía cuál era el monto. */}
      <div className="fila-editor-campos">
        <label className="fila-editor-campo">
          <span>En qué fue</span>
          <input
            className="neg-input"
            value={descripcion}
            maxLength={200}
            autoFocus
            placeholder="Punto Farma"
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </label>

        <label className="fila-editor-campo is-corto">
          <span>Monto ({movimiento.moneda === "USD" ? "US$" : "₲"})</span>
          <input
            className="neg-input"
            inputMode="decimal"
            value={monto}
            placeholder="14.550"
            title="El monto, sin signo: el signo lo pone el tipo"
            onChange={(e) => setMonto(e.target.value)}
          />
        </label>

        <label className="fila-editor-campo is-corto">
          <span>Fecha</span>
          <input className="neg-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>

        {/*
          El tipo se puede cambiar, y hace falta: "cobré" e "invertí" se
          parecen lo suficiente como para que EOS equivoque el signo, y un
          gasto contado como ingreso mueve el disponible al doble para el lado
          que no es.

          Una devolución no aparece: no es un tipo, es un gasto negativo, y
          convertirla desde acá sería cambiar dos cosas con un solo clic.
        */}
        {!esDevolucion && (
          <label className="fila-editor-campo is-corto">
            <span>Tipo</span>
            <select
              className="neg-input"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "ingreso" | "gasto")}
            >
              <option value="gasto">Gasto</option>
              <option value="ingreso">Ingreso</option>
            </select>
          </label>
        )}
      </div>

      {aviso && <p className="neg-error" role="alert">{aviso}</p>}

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
