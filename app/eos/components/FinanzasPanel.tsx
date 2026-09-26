"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Check, ChevronDown, Lock, Receipt, ShieldCheck, SlidersHorizontal } from "lucide-react";
import FinanzasSetup from "./FinanzasSetup";
import FinanzasCandidatos from "./FinanzasCandidatos";
import FinanzasBuzon from "./FinanzasBuzon";
import FinanzasConciliar from "./FinanzasConciliar";
import FinanzasFijos from "./FinanzasFijos";
import { formatearMonto } from "@/lib/finanzas/formato";
import Traza, { Cifra } from "./Traza";
import type { ClaveCifra, Trazado } from "@/lib/finanzas/trazabilidad";
import { nombreDeMoneda } from "@/lib/finanzas/monedas";

type Estado = "seguro" | "atencion" | "accion";

type EstadoFinanciero = {
  configurado: true;
  sin_datos: boolean;
  /** Sin Constitución: el punto de partida es el saldo declarado de las cuentas, con reserva y ahorro en cero. */
  desde_cuentas?: boolean;
  moneda: string;
  estado: Estado;
  disponible_real: number;
  saldo_estimado: number;
  ingresos: number;
  gastos: number;
  reserva_minima: number;
  ahorro_comprometido: number;
  compromisos: {
    total: number;
    cantidad: number;
    cubiertos: boolean;
    proximo: { fecha: string; descripcion: string | null } | null;
  };
  reserva_protegida: boolean;
  objetivos_en_ritmo: boolean;
  objetivos_activos: number;
  movimientos_registrados: number;
  /** De dónde sale cada cifra. Ver `lib/finanzas/trazabilidad.ts`. */
  trazas: Trazado[];
  conciliacion: {
    confianza: "alta" | "media" | "baja";
    veces: number;
    dias_desde_ultima: number | null;
    gasto_invisible: number;
    aprendido: boolean;
    conviene_preguntar: boolean;
  };
  /**
   * Cada moneda del usuario, calculada entera y por separado. La primera es la
   * principal y sus números son los mismos que están en la raíz.
   */
  monedas?: BloqueMoneda[];
  prevision: {
    proximo_ingreso: { fecha: string; monto: number; descripcion: string; confianza: number } | null;
    gastos_previsibles: {
      total: number;
      cantidad: number;
      hasta: string;
      detalle: { fecha: string; descripcion: string; monto: number; periodicidad: string }[];
    };
    cuotas: {
      total: number;
      cantidad: number;
      detalle: { fecha: string; descripcion: string; monto: number }[];
    };
    series_detectadas: number;
    fijos_declarados: number;
    fijos_confirmados: number;
  };
};

type BloqueMoneda = {
  moneda: string;
  principal: boolean;
  estado: Estado;
  sin_datos: boolean;
  disponible_real: number;
  saldo_estimado: number;
  ingresos: number;
  gastos: number;
  movimientos_registrados: number;
  trazas: Trazado[];
  punto_de_partida: {
    base: number;
    desde: string;
    origen: "constitucion" | "cuentas" | "sin_declarar";
  };
  cuentas: {
    nombre: string;
    tipo: string;
    saldo_declarado: number | null;
    saldo_declarado_el: string | null;
  }[];
  compromisos: { total: number; cantidad: number; cubiertos: boolean };
  prevision: {
    cuotas: { total: number; cantidad: number };
    gastos_previsibles: { total: number; cantidad: number };
  };
};

type Respuesta = EstadoFinanciero | { configurado: false };

const COPY: Record<Estado, { titulo: string; sub: string }> = {
  seguro: { titulo: "FINANZAS — SEGURO", sub: "Todo está bajo control." },
  atencion: { titulo: "FINANZAS — EN OBSERVACIÓN", sub: "Nada urgente, pero hay algo que EOS está vigilando." },
  accion: { titulo: "FINANZAS — NECESITA UNA DECISIÓN", sub: "Hay algo que requiere que decidas vos." },
};

type FinanzasPanelProps = {
  /**
   * Avisa si la Constitución Financiera ya está configurada, apenas se sabe.
   *
   * Varias tarjetas hermanas (Trayectoria, Calendario, Deudas, Objetivos,
   * Fondo, Plan de deudas) se callan solas —`return null`— cuando no hay
   * nada que mostrar, a propósito: así una cuenta nueva no ve cajas vacías
   * dentro de cada pestaña. El problema es que en "Lo que viene", "Lo que
   * debo" y "Lo que quiero" TODAS las tarjetas de esa pestaña se callan a la
   * vez sin la Constitución, y la pestaña entera queda en blanco — peor que
   * una caja vacía, porque no dice nada en absoluto. `GastosView` usa este
   * aviso para mostrar ahí un único mensaje compartido en vez de que cada
   * pestaña lo repita.
   */
  onConfiguradoChange?: (configurado: boolean) => void;
  /**
   * Sin los fijos ni el buzón arriba del panel. Personal los muestra en su
   * engranaje de Ajustes: se configuran una vez y, apilados encima del
   * "¿estoy bien?", empujaban la respuesta del día hacia abajo. Lo que sí
   * queda arriba es lo que EOS necesita que la persona confirme —la
   * conciliación y los movimientos detectados—, que aparece solo cuando hay
   * algo.
   */
  sinAjustes?: boolean;
  /** Lo que Ajustes necesita del estado para mostrar los fijos igual que acá. */
  onEstado?: (estado: { moneda: string; fijosConfirmados: number }) => void;
  /**
   * Cómo se muestra.
   *
   * - `completo` (el de siempre): la tarjeta entera con lo que EOS necesita
   *   confirmar arriba.
   * - `resumen`: cuatro tarjetas chicas —disponible real, para el día a día,
   *   lo que viene y la reserva— y lo que EOS necesita confirmar. Es la cabeza
   *   de Personal: la respuesta en una mirada.
   * - `detalle`: solo la tarjeta entera, con la traza de cada cifra y los
   *   detalles. Vive en Hoy › ¿Cómo estoy?, debajo de un resumen que ya dijo
   *   si falta configurar, así que en ese caso se calla.
   */
  modo?: "completo" | "resumen" | "detalle";
  /** En `resumen`, lleva al detalle completo. */
  onVerDetalle?: () => void;
};

export default function FinanzasPanel({
  onConfiguradoChange,
  sinAjustes = false,
  onEstado,
  modo = "completo",
  onVerDetalle,
}: FinanzasPanelProps = {}) {
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);
  /*
   * Un 403 acá no es una falla de lectura: es `exigirModulo("dashboard")`
   * diciendo que el Panel financiero todavía no está contratado. Antes las
   * dos cosas caían en el mismo `catch` y mostraban "no pudimos leer tus
   * finanzas, volvé a entrar en un rato" — un mensaje que promete que
   * reintentar sirve, cuando reintentar JAMÁS va a andar hasta que se active
   * el módulo. Confundir un candado con un error deja a cualquier cuenta sin
   * ese módulo pensando que EOS está roto, para siempre.
   */
  const [sinModulo, setSinModulo] = useState(false);
  const [detalles, setDetalles] = useState(false);
  const [configurando, setConfigurando] = useState(false);
  /** Qué cifra está abierta mostrando de dónde sale. */
  const [abierta, setAbierta] = useState<ClaveCifra | null>(null);

  const cargar = useCallback(() => {
    // Nada de estado se toca antes del `fetch`: las tres banderas
    // (`error`, `sinModulo`, `data`) se resuelven juntas, dentro de la
    // cadena de promesas, para que una recarga limpie de verdad el estado
    // de la anterior en vez de sumarse a él.
    return fetch("/api/finanzas/estado", { cache: "no-store" })
      .then((res) => {
        if (res.status === 403) {
          setSinModulo(true);
          setError(false);
          return null;
        }
        if (!res.ok) return Promise.reject(new Error("fallo"));
        return res.json();
      })
      .then((payload) => {
        if (!payload) return;
        setSinModulo(false);
        setError(false);
        setData(payload);
      })
      .catch(() => {
        setSinModulo(false);
        setError(true);
      });
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    // Calculado desde las cuentas no es "configurado": lo que depende de la
    // Constitución (presupuesto, proyección, fondo) todavía no tiene con qué.
    if (data) onConfiguradoChange?.(data.configurado === true && !data.desde_cuentas);
  }, [data, onConfiguradoChange]);

  useEffect(() => {
    if (data?.configurado) {
      onEstado?.({ moneda: data.moneda, fijosConfirmados: data.prevision?.fijos_confirmados ?? 0 });
    }
  }, [data, onEstado]);

  if (configurando) {
    return (
      <FinanzasSetup
        onListo={() => {
          setConfigurando(false);
          void cargar();
        }}
        onCancelar={data?.configurado ? () => setConfigurando(false) : undefined}
      />
    );
  }

  // El detalle vive debajo del resumen, que ya dice si falta configurar o si
  // algo no se pudo leer. Repetirlo acá sería decir lo mismo dos veces.
  if (modo === "detalle" && (sinModulo || error || data === null || !data.configurado)) return null;

  if (sinModulo) {
    return (
      <div className="card fin-card">
        <div className="fin-head">
          <span className="fin-badge fin-badge-neutral">FINANZAS</span>
        </div>
        <div className="card-title">Todavía no tenés el Panel financiero</div>
        <p className="prose">
          Con él, EOS te dice si estás bien, de dónde sale tu disponible real y qué se viene —todo
          calculado sobre lo que ya vas anotando.
        </p>
        <a className="reco-btn" href="/planes" style={{ display: "inline-flex", marginTop: 12 }}>
          Ver cómo sumarlo
        </a>
      </div>
    );
  }

  /*
   * Esta tarjeta es la primera del panel y responde la pregunta de todos los
   * días: "¿estoy bien?". No puede desaparecer sin decir nada.
   *
   * Antes, `error || data === null` en una línea la borraba tanto mientras
   * cargaba como cuando se caía, y el Dashboard quedaba en un encabezado
   * flotando arriba de un selector de período.
   */
  if (error) {
    return (
      <div className="card fin-card">
        <div className="fin-head">
          <span className="fin-badge fin-badge-neutral">FINANZAS</span>
        </div>
        <p className="neg-load-error" role="alert">
          No pudimos leer tus finanzas en este momento. Tus datos están; lo que falló
          fue la lectura. Volvé a entrar en un rato.
        </p>
      </div>
    );
  }

  /*
   * Mientras carga sí muestra algo, y no un esqueleto vacío: en una conexión
   * lenta esta tarjeta puede tardar segundos, y es la que la persona vino a
   * mirar. Un "calculando" le dice que espere; la nada le dice que no hay.
   */
  if (data === null) {
    return (
      <div className="card fin-card">
        <div className="fin-head">
          <span className="fin-badge fin-badge-neutral">FINANZAS</span>
        </div>
        <p className="neg-loading" role="status">
          Calculando tu disponible real…
        </p>
      </div>
    );
  }

  // Todavía sin Constitución Financiera: EOS no inventa un estado.
  if (!data.configurado) {
    return (
      <div className="card fin-card">
        <div className="fin-head">
          <span className="fin-badge fin-badge-neutral">FINANZAS — SIN CONFIGURAR</span>
        </div>
        <p className="prose" style={{ marginTop: 10 }}>
          EOS todavía no conoce tu situación financiera. Definí tus reglas una sola vez y a partir de ahí va a calcular
          tu disponible real y avisarte solo cuando haga falta.
        </p>
        <button type="button" className="reco-btn" style={{ marginTop: 12 }} onClick={() => setConfigurando(true)}>
          Configurar mis finanzas
        </button>
      </div>
    );
  }

  const fmt = (valor: number) => formatearMonto(valor, data.moneda);
  const copy = COPY[data.estado];
  const trazas = data.trazas ?? [];

  /** Cualquier cifra del panel, tocable si sabemos de dónde sale. */
  const cifra = (valor: number, clave: ClaveCifra, className?: string) => (
    <Cifra
      valor={valor}
      moneda={data.moneda}
      cifra={clave}
      trazas={trazas}
      onAbrir={setAbierta}
      className={className}
    />
  );

  /*
   * Cuando el número sale del saldo de las cuentas y no de la Constitución,
   * se dice: la reserva y el ahorro están en cero porque nadie los declaró, y
   * la persona tiene que saberlo antes de gastar lo que dice "disponible".
   */
  const avisoDesdeCuentas = data.desde_cuentas ? (
    <div className="fin-desde-cuentas">
      <p>
        Calculado con el saldo que cargaste en tus cuentas, menos lo que fuiste anotando. Todavía no separa una
        reserva ni un ahorro: para eso, configurá tus finanzas.
      </p>
      <button type="button" className="reco-btn" onClick={() => setConfigurando(true)}>
        Configurar mis finanzas
      </button>
    </div>
  ) : null;

  /** Lo que EOS necesita que la persona confirme. Aparece solo cuando hay algo. */
  const necesitaDeVos = (
    <>
      {data.conciliacion?.conviene_preguntar && (
        <FinanzasConciliar
          moneda={data.moneda}
          saldoCalculado={data.saldo_estimado}
          vecesConciliado={data.conciliacion.veces}
          onListo={() => void cargar()}
        />
      )}
      <FinanzasCandidatos onImportado={() => void cargar()} />
    </>
  );

  if (modo === "resumen" && !data.sin_datos) {
    return (
      <>
        {necesitaDeVos}
        <ResumenPersonal data={data} fmt={fmt} onVerDetalle={onVerDetalle} />
        {avisoDesdeCuentas}
      </>
    );
  }

  return (
    <>
    {modo !== "detalle" && data.conciliacion?.conviene_preguntar && (
      <FinanzasConciliar
        moneda={data.moneda}
        saldoCalculado={data.saldo_estimado}
        vecesConciliado={data.conciliacion.veces}
        onListo={() => void cargar()}
      />
    )}
    {!sinAjustes && modo !== "detalle" && (
      <>
        <FinanzasFijos
          moneda={data.moneda}
          confirmados={data.prevision?.fijos_confirmados ?? 0}
          onGuardado={() => void cargar()}
        />
        <FinanzasBuzon />
      </>
    )}
    {modo !== "detalle" && <FinanzasCandidatos onImportado={() => void cargar()} />}

    <div className="card fin-card">
      <div className="fin-head">
        <span className={`fin-badge fin-badge-${data.estado}`}>
          {data.estado === "seguro" ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
          {copy.titulo}
        </span>
        <button
          type="button"
          className="fin-editar"
          onClick={() => setConfigurando(true)}
          aria-label="Editar mi política financiera"
          title="Editar mi política financiera"
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>
      <div className="fin-sub">{copy.sub}</div>
      {modo !== "detalle" && avisoDesdeCuentas}

      {data.sin_datos ? (
        <p className="prose" style={{ marginTop: 14 }}>
          Tu política ya está definida, pero EOS todavía no registró movimientos. En cuanto haya información, acá vas a
          ver tu disponible real sin tener que calcular nada.
        </p>
      ) : (
        <>
          <div className="fin-main">
            <div className="fin-main-label">Disponible real</div>
            <div className="fin-main-value">
              {cifra(data.disponible_real, "disponible_real")}
            </div>
            <div className="fin-main-hint">
              Después de compromisos, gastos previsibles, reserva y ahorro
            </div>
            {/*
              La doctrina pone esta línea al lado del disponible real porque es
              la que lo vuelve una respuesta: no es lo mismo tener este monto
              con el sueldo entrando mañana que con el sueldo a 26 días.
            */}
            {data.prevision.proximo_ingreso && (
              <div className="fin-main-hint">
                Próximo ingreso estimado: {formatearFecha(data.prevision.proximo_ingreso.fecha)} ·{" "}
                {fmt(data.prevision.proximo_ingreso.monto)}
              </div>
            )}
          </div>

          {/*
            La traza va acá, pegada al disponible real y no al final: quien
            toca un número quiere ver de dónde sale ese número, no bajar
            buscándolo. Abrir otra cifra reemplaza esta, no apila paneles.
          */}
          {abierta && (
            // La key reinicia el panel al tocar otra cifra. Ver el porqué en Traza.tsx.
            // (No se había notado: acá también hay más de una cifra tocable —
            // disponible real, ingresos, gastos, compromisos, previsibles.)
            <Traza
              key={abierta}
              trazas={trazas}
              inicial={abierta}
              moneda={data.moneda}
              onCerrar={() => setAbierta(null)}
            />
          )}

          <ComposicionSaldo data={data} fmt={fmt} />

          <OtrasMonedas monedas={data.monedas ?? []} />

          <div className="fin-rows">
            <FinRow
              label="Próximos compromisos"
              ok={data.compromisos.cubiertos}
              okText="Cubiertos"
              badText="Sin cobertura"
            />
            {data.prevision.gastos_previsibles.cantidad > 0 && (
              <div className="fin-row">
                <span className="fin-row-label">Gastos previsibles</span>
                <span className="fin-row-value is-ok">
                  <Check size={13} />
                  {data.prevision.gastos_previsibles.cantidad} ya contemplado
                  {data.prevision.gastos_previsibles.cantidad === 1 ? "" : "s"}
                </span>
              </div>
            )}
            <FinRow label="Reserva" ok={data.reserva_protegida} okText="Protegida" badText="Por debajo del mínimo" />
            <FinRow
              label="Objetivos"
              ok={data.objetivos_en_ritmo}
              okText={data.objetivos_activos === 0 ? "Sin objetivos activos" : "En ritmo"}
              badText="Necesitan atención"
            />
            <div className="fin-row">
              <span className="fin-row-label">EOS necesita de vos</span>
              <span className={`fin-row-value ${data.estado === "accion" ? "is-bad" : "is-ok"}`}>
                {data.estado === "accion" ? "Una decisión" : "Nada"}
              </span>
            </div>
          </div>

          <button type="button" className="fin-toggle" onClick={() => setDetalles((v) => !v)}>
            <ChevronDown size={13} className={detalles ? "fin-chevron-open" : ""} />
            {detalles ? "Ocultar detalles" : "Ver detalles"}
          </button>

          {detalles && (
            <div className="fin-detalles">
              <div className="field-row">
                <span className="field-label">Saldo estimado</span>
                <span className="field-value">{cifra(data.saldo_estimado, "saldo_estimado")}</span>
              </div>
              <div className="field-row">
                <span className="field-label">Ingresos registrados</span>
                <span className="field-value">{cifra(data.ingresos, "ingresos")}</span>
              </div>
              <div className="field-row">
                <span className="field-label">Gastos registrados</span>
                <span className="field-value">{cifra(data.gastos, "gastos")}</span>
              </div>
              <div className="field-row">
                <span className="field-label">
                  Compromisos por pagar
                  {data.compromisos.cantidad > 0 && (
                    <span className="field-hint">{data.compromisos.cantidad} pendiente(s)</span>
                  )}
                </span>
                <span className="field-value">{cifra(data.compromisos.total, "compromisos")}</span>
              </div>
              {data.prevision.gastos_previsibles.cantidad > 0 && (
                <div className="field-row">
                  <span className="field-label">
                    Gastos previsibles
                    <span className="field-hint">
                      detectados por EOS, hasta el {formatearFecha(data.prevision.gastos_previsibles.hasta)}
                    </span>
                  </span>
                  <span className="field-value">
                    {cifra(data.prevision.gastos_previsibles.total, "gastos_previsibles")}
                  </span>
                </div>
              )}
              {data.prevision.gastos_previsibles.detalle.map((p) => (
                <div className="field-row" key={`${p.descripcion}-${p.fecha}`}>
                  <span className="field-label">
                    <span className="field-hint">
                      {formatearFecha(p.fecha)} · {p.descripcion} ({p.periodicidad})
                    </span>
                  </span>
                  <span className="field-value">{fmt(p.monto)}</span>
                </div>
              ))}
              {/*
                Las cuotas se descuentan del disponible real igual que todo lo
                demás, así que tienen que poder verse acá. Un descuento que no
                se puede rastrear hasta su origen es exactamente lo que hace
                que alguien deje de creerle al número de arriba.
              */}
              {data.prevision.cuotas.cantidad > 0 && (
                <div className="field-row">
                  <span className="field-label">
                    Cuotas de tus deudas
                    <span className="field-hint">
                      {data.prevision.cuotas.cantidad} en este tramo
                    </span>
                  </span>
                  <span className="field-value">{fmt(data.prevision.cuotas.total)}</span>
                </div>
              )}
              {data.prevision.cuotas.detalle.map((c) => (
                <div className="field-row" key={`cuota-${c.descripcion}-${c.fecha}`}>
                  <span className="field-label">
                    <span className="field-hint">
                      {formatearFecha(c.fecha)} · {c.descripcion}
                    </span>
                  </span>
                  <span className="field-value">{fmt(c.monto)}</span>
                </div>
              ))}
              {/*
                Solo aparece cuando EOS ya aprendió el ritmo. Es la prueba de
                que dejó de necesitar al usuario: descuenta lo que no ve, solo.
              */}
              {data.conciliacion?.aprendido && data.conciliacion.gasto_invisible > 0 && (
                <div className="field-row">
                  <span className="field-label">
                    Gastos que EOS no ve
                    <span className="field-hint">
                      billetera y efectivo, aprendido de tu ritmo
                    </span>
                  </span>
                  <span className="field-value">{fmt(data.conciliacion.gasto_invisible)}</span>
                </div>
              )}
              <div className="field-row">
                <span className="field-label">Reserva mínima</span>
                <span className="field-value">{fmt(data.reserva_minima)}</span>
              </div>
              <div className="field-row">
                <span className="field-label">Ahorro comprometido</span>
                <span className="field-value">{fmt(data.ahorro_comprometido)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
    </>
  );
}

/**
 * Las otras monedas del usuario.
 *
 * ============================================================
 * POR QUÉ NO ESTÁN SUMADAS AL NÚMERO DE ARRIBA
 * ============================================================
 *
 * Hasta ahora lo estaban, y era un bug: el panel sumaba dólares con guaraníes
 * como si fueran lo mismo, y mostraba un total que no existe en ninguna moneda
 * del mundo. Ahora cada moneda tiene su propia línea de tiempo, su propio
 * disponible real y su propia tarjeta.
 *
 * No se convierten a guaraníes ni se muestra un gran total. El porqué está en
 * el comentario de cabecera de `lib/finanzas/monedas.ts`, pero se resume en
 * que la cotización no la sabe EOS y un total convertido no contesta ninguna
 * pregunta que alguien tenga de verdad.
 *
 * Cada tarjeta dice de dónde salió su punto de partida. "Según lo que
 * declaraste el 20 de agosto" y "desde tu primer movimiento" son dos niveles de
 * certeza muy distintos, y mostrarlos como el mismo número pelado es lo que
 * hace que alguien confíe de más en el segundo.
 */
function OtrasMonedas({ monedas }: { monedas: BloqueMoneda[] }) {
  const otras = monedas.filter((m) => !m.principal);
  if (otras.length === 0) return null;

  return (
    <div className="fin-monedas">
      <div className="fin-monedas-titulo">También tenés</div>

      {otras.map((m) => {
        const fmt = (valor: number) => formatearMonto(valor, m.moneda);
        const comprometido =
          m.compromisos.total + m.prevision.cuotas.total + m.prevision.gastos_previsibles.total;

        return (
          <div className={`fin-moneda fin-moneda-${m.estado}`} key={m.moneda}>
            <div className="fin-moneda-head">
              <span className="fin-moneda-nombre">{nombreDeMoneda(m.moneda)}</span>
              <span className="fin-moneda-valor">{fmt(m.disponible_real)}</span>
            </div>

            <div className="fin-moneda-hint">
              {comprometido > 0
                ? `Saldo ${fmt(m.saldo_estimado)} · ${fmt(comprometido)} ya comprometidos`
                : `Saldo ${fmt(m.saldo_estimado)}`}
            </div>

            <div className="fin-moneda-hint">{origenDelSaldo(m, fmt)}</div>
          </div>
        );
      })}
    </div>
  );
}

/** De dónde salió el punto de partida de esta moneda, dicho en castellano. */
function origenDelSaldo(m: BloqueMoneda, fmt: (v: number) => string): string {
  if (m.punto_de_partida.origen === "cuentas") {
    const cuantas = m.cuentas.length;
    return `Parte de ${fmt(m.punto_de_partida.base)} según lo que declaraste el ${formatearFecha(
      m.punto_de_partida.desde,
    )}${cuantas > 1 ? ` en ${cuantas} cuentas` : ""}.`;
  }

  if (m.movimientos_registrados === 0) {
    return "Todavía no hay movimientos en esta moneda.";
  }

  // Sin saldo declarado, lo único que EOS puede afirmar es lo que vio pasar.
  return `Contado desde tu primer movimiento del ${formatearFecha(m.punto_de_partida.desde)}: si ya tenías algo antes, declaralo como cuenta para que el número cierre.`;
}

/**
 * Por qué el disponible real es ese y no el saldo entero.
 *
 * El número grande de arriba contesta "cuánto puedo gastar", pero deja una
 * pregunta abierta que hasta ahora había que ir a buscar en "Ver detalles":
 * dónde está el resto de la plata. Sin esta barra, alguien con 5.000.000 en el
 * banco ve "disponible real: 400.000" y lo lee como un error del sistema.
 *
 * Cada tramo es plata que sigue siendo del usuario; lo que cambia es que ya
 * tiene dueño. Por eso ninguno se pinta de rojo salvo el faltante real.
 */
function ComposicionSaldo({ data, fmt }: { data: EstadoFinanciero; fmt: (v: number) => string }) {
  const comprometido =
    data.compromisos.total +
    data.prevision.gastos_previsibles.total +
    data.prevision.cuotas.total +
    data.reserva_minima +
    data.ahorro_comprometido;

  const alcanza = data.disponible_real >= 0;

  // Cuando no alcanza, la barra ya no puede representar el saldo: lo asumido
  // es más grande que lo que hay. La escala pasa a ser lo comprometido, y el
  // hueco se ve como lo que es — un tramo que no está cubierto por nada.
  const base = alcanza ? data.saldo_estimado : comprometido;
  if (base <= 0) return null;

  const tramos = [
    { clave: "compromisos", etiqueta: "Compromisos ya asumidos", monto: data.compromisos.total },
    {
      clave: "previsibles",
      etiqueta: "Gastos que EOS ya prevé",
      monto: data.prevision.gastos_previsibles.total,
    },
    {
      // Va separado de los previsibles a propósito: una cuota no es algo que
      // EOS dedujo, es algo que el usuario ya firmó. Verla en su propio tramo
      // es lo que hace que el descuento se entienda en vez de sorprender.
      clave: "cuotas",
      etiqueta: "Cuotas de tus deudas",
      monto: data.prevision.cuotas.total,
    },
    { clave: "reserva", etiqueta: "Tu reserva intocable", monto: data.reserva_minima },
    { clave: "ahorro", etiqueta: "Ahorro comprometido", monto: data.ahorro_comprometido },
    alcanza
      ? { clave: "libre", etiqueta: "Libre para decidir", monto: data.disponible_real }
      : { clave: "faltante", etiqueta: "Sin respaldo", monto: -data.disponible_real },
  ].filter((t) => t.monto > 0);

  if (tramos.length === 0) return null;

  return (
    <div className="fin-composicion">
      <div className="fin-comp-label">
        {alcanza ? "Dónde está tu saldo" : "Lo asumido supera tu saldo"}
        <span className="fin-comp-base">{fmt(base)}</span>
      </div>

      <div className="fin-comp-barra" role="img" aria-label="Reparto del saldo estimado">
        {tramos.map((t) => (
          <span
            key={t.clave}
            className={`fin-comp-tramo fin-comp-${t.clave}`}
            style={{ width: `${(t.monto / base) * 100}%` }}
            title={`${t.etiqueta}: ${fmt(t.monto)}`}
          />
        ))}
      </div>

      <div className="fin-comp-lista">
        {tramos.map((t) => (
          <span className="fin-comp-item" key={t.clave}>
            <span className={`fin-comp-punto fin-comp-${t.clave}`} />
            {t.etiqueta}
            <b>{fmt(t.monto)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function FinRow({ label, ok, okText, badText }: { label: string; ok: boolean; okText: string; badText: string }) {
  return (
    <div className="fin-row">
      <span className="fin-row-label">{label}</span>
      <span className={`fin-row-value ${ok ? "is-ok" : "is-bad"}`}>
        {ok ? <Check size={13} /> : <AlertTriangle size={13} />}
        {ok ? okText : badText}
      </span>
    </div>
  );
}

const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/**
 * Formatea una fecha ISO sin pasar por `new Date`.
 *
 * `new Date("2026-08-30")` es medianoche UTC, y al formatearla en la zona de
 * Paraguay (UTC-3/-4) mostraría el 29. Un día de diferencia en "próximo
 * ingreso" es exactamente el tipo de error que rompe la confianza.
 */
function formatearFecha(iso: string) {
  const [anio, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia || mes < 1 || mes > 12) return iso;
  return `${dia} de ${MESES_ES[mes - 1]}`;
}

/**
 * La cabeza de Personal: cuatro tarjetas con la respuesta del día.
 *
 * Mismo formato que el resumen de Negocio, a propósito: las dos secciones se
 * leen igual. Cada número sale del mismo estado que la tarjeta completa —que
 * sigue entera en Hoy › ¿Cómo estoy?, con la traza de cada cifra—, así que
 * acá no se calcula nada distinto. Lo único que se deriva es el "por día":
 * el disponible real repartido en los días que faltan hasta el próximo
 * ingreso que EOS ya estimó. Sin ese ingreso, no se inventa un plazo.
 */
function ResumenPersonal({
  data,
  fmt,
  onVerDetalle,
}: {
  data: EstadoFinanciero;
  fmt: (valor: number) => string;
  onVerDetalle?: () => void;
}) {
  const ingreso = data.prevision.proximo_ingreso;
  const dias = ingreso ? diasHasta(ingreso.fecha) : null;
  const porDia = dias !== null && dias > 0 ? Math.max(0, data.disponible_real) / dias : null;
  const porPagar = data.compromisos.total + data.prevision.gastos_previsibles.total;
  const cuantos = data.compromisos.cantidad + data.prevision.gastos_previsibles.cantidad;
  const estado =
    data.estado === "seguro"
      ? { texto: "Vas bien", tono: "ok" }
      : data.estado === "atencion"
        ? { texto: "En observación", tono: "av" }
        : { texto: "Necesita una decisión", tono: "mal" };

  return (
    <div className="neg-resumen is-negocio is-personal" aria-label="Resumen de tus finanzas">
      <button type="button" className="neg-resumen-card is-primary" onClick={onVerDetalle}>
        <ShieldCheck size={17} />
        <span>Disponible real</span>
        <strong>{fmt(data.disponible_real)}</strong>
        <small>
          <span className={`neg-pill is-${estado.tono}`}>{estado.texto}</span>
        </small>
      </button>
      <button type="button" className="neg-resumen-card" onClick={onVerDetalle}>
        <CalendarDays size={17} />
        <span>Para el día a día</span>
        <strong>{porDia === null ? fmt(data.saldo_estimado) : fmt(Math.floor(porDia))}</strong>
        <small>
          {porDia === null || !ingreso
            ? "Saldo estimado de hoy"
            : `por día hasta el ${formatearFecha(ingreso.fecha)}`}
        </small>
      </button>
      <button type="button" className="neg-resumen-card" onClick={onVerDetalle}>
        <Receipt size={17} />
        <span>Lo que viene</span>
        <strong>{fmt(porPagar)}</strong>
        <small>
          {cuantos === 0
            ? "Nada por pagar a la vista"
            : `${cuantos} ${cuantos === 1 ? "pago" : "pagos"} ya contemplado${cuantos === 1 ? "" : "s"}`}
        </small>
      </button>
      <button type="button" className="neg-resumen-card" onClick={onVerDetalle}>
        <Lock size={17} />
        <span>Reserva mínima</span>
        <strong>{fmt(data.reserva_minima)}</strong>
        <small className={data.reserva_protegida ? "" : "is-alert"}>
          {data.desde_cuentas
            ? "Todavía sin definir"
            : data.reserva_protegida
              ? "Protegida, no se toca"
              : "Por debajo del mínimo"}
        </small>
      </button>
    </div>
  );
}

/** Días enteros desde hoy (reloj de quien mira) hasta una fecha `YYYY-MM-DD`. */
function diasHasta(iso: string): number {
  const hoy = new Date();
  const desde = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - desde) / 86_400_000);
}
