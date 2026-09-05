"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Landmark,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import FinanzasBuzon from "./FinanzasBuzon";

/**
 * La conversación fundacional.
 *
 * La hoja de ruta la define por su cierre, no por sus preguntas: "una sola
 * conversación que termina en «ya no tenés que contarme nada más»".
 *
 * Por eso esto NO es un formulario aunque guarde datos. Las diferencias son
 * deliberadas y hay que sostenerlas si alguien la modifica:
 *
 *   * Una cosa por pantalla. Nunca una grilla de campos: quien evita mirar sus
 *     finanzas por ansiedad cierra la pestaña ante un tablero de veinte casillas.
 *   * EOS habla en primera persona y explica POR QUÉ pregunta cada cosa. Un
 *     formulario pide datos; una conversación da un motivo.
 *   * Nada de culpa. La pantalla de deudas dice "no es para juzgarte" porque el
 *     usuario que este producto busca llega avergonzado, no desinformado.
 *   * Se puede abandonar. Cada paso se guarda, así que volver no es empezar de
 *     nuevo — y eso es lo que permite que sea "una sola" conversación aunque
 *     ocurra en tres ratos distintos.
 */

type Paso =
  | "bienvenida"
  | "cuentas"
  | "ingresos"
  | "gastos_fijos"
  | "deudas"
  | "preocupaciones"
  | "correo"
  | "cierre";

const ORDEN: Paso[] = [
  "bienvenida",
  "cuentas",
  "ingresos",
  "gastos_fijos",
  "deudas",
  "preocupaciones",
  "correo",
  "cierre",
];

const TIPOS_CUENTA = [
  { valor: "banco", etiqueta: "Banco" },
  { valor: "cooperativa", etiqueta: "Cooperativa" },
  { valor: "financiera", etiqueta: "Financiera" },
  { valor: "billetera", etiqueta: "Billetera" },
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "tarjeta_credito", etiqueta: "Tarjeta" },
];

const TIPOS_DEUDA = [
  { valor: "prestamo", etiqueta: "Préstamo" },
  { valor: "tarjeta", etiqueta: "Tarjeta" },
  { valor: "proveedor", etiqueta: "Proveedor" },
  { valor: "familiar", etiqueta: "Familiar" },
  { valor: "impuesto", etiqueta: "Impuesto" },
  { valor: "otro", etiqueta: "Otro" },
];

type Cuenta = { nombre: string; tipo: string; recibe_avisos: boolean };
type Fijo = { tipo: "ingreso" | "gasto"; descripcion: string; monto: string; dia_del_mes: string };
type Deuda = {
  id?: string;
  acreedor: string;
  tipo: string;
  saldo_declarado: string;
  cuota_monto: string;
  cuota_dia: string;
  preocupa: boolean;
};

const CUENTA_VACIA: Cuenta = { nombre: "", tipo: "banco", recibe_avisos: false };
const DEUDA_VACIA: Deuda = {
  acreedor: "",
  tipo: "prestamo",
  saldo_declarado: "",
  cuota_monto: "",
  cuota_dia: "",
  preocupa: false,
};

export default function OnboardingConversacion({ onListo }: { onListo?: () => void }) {
  const [paso, setPaso] = useState<Paso>("bienvenida");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const [cuentas, setCuentas] = useState<Cuenta[]>([{ ...CUENTA_VACIA }]);
  const [fijos, setFijos] = useState<Fijo[]>([]);
  const [deudas, setDeudas] = useState<Deuda[]>([{ ...DEUDA_VACIA }]);
  const [preocupacion, setPreocupacion] = useState("");
  const [evitaMirar, setEvitaMirar] = useState("");

  // Se retoma donde quedó. Es lo que permite que abandonar a la mitad no sea
  // perder todo, y por lo tanto que la conversación pueda ser "una sola".
  useEffect(() => {
    let activo = true;

    Promise.all([
      fetch("/api/onboarding", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/finanzas/cuentas", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/finanzas/fijos", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/finanzas/deudas", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([onb, cts, fjs, dds]) => {
        if (!activo) return;

        const guardado = onb?.onboarding?.paso as Paso | "completado" | undefined;
        if (guardado && guardado !== "completado" && ORDEN.includes(guardado as Paso)) {
          setPaso(guardado as Paso);
        }
        setPreocupacion(onb?.onboarding?.preocupacion_principal ?? "");
        setEvitaMirar(onb?.onboarding?.evita_mirar ?? "");

        const cuentasGuardadas: Cuenta[] = (cts?.cuentas ?? []).map(
          (c: { nombre: string; tipo: string; recibe_avisos: boolean }) => ({
            nombre: c.nombre,
            tipo: c.tipo,
            recibe_avisos: c.recibe_avisos,
          }),
        );
        if (cuentasGuardadas.length > 0) setCuentas(cuentasGuardadas);

        const fijosGuardados: Fijo[] = (fjs?.fijos ?? []).map(
          (f: { tipo: "ingreso" | "gasto"; descripcion: string; monto: number; dia_del_mes: number }) => ({
            tipo: f.tipo,
            descripcion: f.descripcion,
            monto: String(f.monto),
            dia_del_mes: String(f.dia_del_mes),
          }),
        );
        setFijos(fijosGuardados);

        const deudasGuardadas: Deuda[] = (dds?.deudas ?? []).map(
          (d: {
            id: string;
            acreedor: string;
            tipo: string;
            saldo_declarado: number;
            cuota_monto: number | null;
            cuota_dia: number | null;
            preocupa: boolean;
          }) => ({
            id: d.id,
            acreedor: d.acreedor,
            tipo: d.tipo,
            saldo_declarado: String(d.saldo_declarado),
            cuota_monto: d.cuota_monto === null ? "" : String(d.cuota_monto),
            cuota_dia: d.cuota_dia === null ? "" : String(d.cuota_dia),
            preocupa: d.preocupa,
          }),
        );
        if (deudasGuardadas.length > 0) setDeudas(deudasGuardadas);
      })
      .catch(() => {})
      .finally(() => {
        if (activo) setCargando(false);
      });

    return () => {
      activo = false;
    };
  }, []);

  /**
   * Guarda el avance. Si falla, FALLA a la vista.
   *
   * La primera versión ignoraba el resultado, y con la sesión vencida el
   * usuario podía recorrer la conversación entera creyendo que quedaba
   * guardada. La pantalla promete "cada respuesta queda guardada": una promesa
   * que el código no cumple es peor que no hacerla.
   */
  const marcarPaso = useCallback(
    async (siguiente: Paso | "completado", extra?: Record<string, unknown>) => {
      const res = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paso: siguiente, ...extra }),
      });

      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? "Se cerró tu sesión. Iniciá sesión de nuevo y seguimos donde quedaste."
            : "No pudimos guardar tu avance.",
        );
      }
    },
    [],
  );

  async function guardarCuentas() {
    const utiles = cuentas.filter((c) => c.nombre.trim().length >= 2);
    const res = await fetch("/api/finanzas/cuentas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cuentas: utiles }),
    });
    if (!res.ok) throw new Error("No pudimos guardar tus cuentas.");
  }

  async function guardarFijos() {
    const utiles = fijos.filter(
      (f) => f.descripcion.trim().length >= 2 && Number(f.monto) > 0 && Number(f.dia_del_mes) >= 1,
    );
    const res = await fetch("/api/finanzas/fijos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fijos: utiles.map((f) => ({
          tipo: f.tipo,
          descripcion: f.descripcion,
          monto: Number(f.monto),
          dia_del_mes: Number(f.dia_del_mes),
        })),
      }),
    });
    if (!res.ok) throw new Error("No pudimos guardar tus ingresos y gastos fijos.");
  }

  /**
   * Las deudas se guardan una por una y en cuanto se completan, no al final.
   * Es el dato más caro de volver a tipear y el que más cuesta emocionalmente
   * declarar: perderlo por un cierre de pestaña sería imperdonable.
   */
  async function guardarDeudas() {
    const nuevas = deudas.filter((d) => !d.id && d.acreedor.trim().length >= 2 && Number(d.saldo_declarado) >= 0);

    for (const d of nuevas) {
      const res = await fetch("/api/finanzas/deudas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acreedor: d.acreedor,
          tipo: d.tipo,
          saldo_declarado: Number(d.saldo_declarado) || 0,
          cuota_monto: d.cuota_monto === "" ? null : Number(d.cuota_monto),
          cuota_dia: d.cuota_dia === "" ? null : Number(d.cuota_dia),
          preocupa: d.preocupa,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "No pudimos guardar una de tus deudas.");
      }
    }
  }

  async function avanzar() {
    setError("");
    setGuardando(true);

    try {
      const indice = ORDEN.indexOf(paso);
      const siguiente = ORDEN[indice + 1];

      if (paso === "cuentas") await guardarCuentas();
      if (paso === "gastos_fijos") await guardarFijos();
      if (paso === "deudas") await guardarDeudas();

      if (paso === "cierre") {
        await marcarPaso("completado");
        onListo?.();
        return;
      }

      await marcarPaso(
        siguiente,
        paso === "preocupaciones"
          ? { preocupacion_principal: preocupacion, evita_mirar: evitaMirar }
          : undefined,
      );

      setPaso(siguiente);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Algo no se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  function retroceder() {
    const indice = ORDEN.indexOf(paso);
    if (indice > 0) setPaso(ORDEN[indice - 1]);
  }

  if (cargando) {
    return (
      <div className="card fin-card">
        <p className="empty-note">Un segundo…</p>
      </div>
    );
  }

  const indice = ORDEN.indexOf(paso);
  const cuentasCiegas = cuentas.filter((c) => c.nombre.trim() && !c.recibe_avisos).length;

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="fin-badge fin-badge-neutral">
          <ShieldCheck size={14} />
          EMPECEMOS
        </span>
        <span className="fin-setup-progreso">
          {indice + 1} de {ORDEN.length}
        </span>
      </div>

      <div className="fin-setup-barra">
        <div
          className="fin-setup-barra-fill"
          style={{ width: `${((indice + 1) / ORDEN.length) * 100}%` }}
        />
      </div>

      {paso === "bienvenida" && (
        <>
          <div className="fin-setup-pregunta">Vamos a hacer esto una sola vez</div>
          <div className="fin-setup-ayuda">
            Te voy a preguntar algunas cosas sobre tu plata: dónde la tenés, qué entra, qué sale y a
            quién le debés. Cuando terminemos no vas a tener que cargarme nada más — yo miro y te
            aviso si algo necesita tu atención.
          </div>
          <div className="fin-setup-ayuda">
            Son unos minutos. Podés dejarlo por la mitad y seguir después: cada respuesta queda
            guardada.
          </div>
        </>
      )}

      {paso === "cuentas" && (
        <>
          <div className="fin-setup-pregunta">¿Dónde tenés tu plata?</div>
          <div className="fin-setup-ayuda">
            Bancos, cooperativas, billeteras, el efectivo del cajón. Todavía no necesito montos:
            solo saber qué existe.
          </div>

          <div className="onb-lista">
            {cuentas.map((cuenta, i) => (
              <div key={i} className="onb-fila">
                <input
                  className="onb-campo onb-input"
                  placeholder="Nombre (ej. Cuenta Banco GNB)"
                  value={cuenta.nombre}
                  onChange={(e) =>
                    setCuentas((prev) =>
                      prev.map((c, j) => (j === i ? { ...c, nombre: e.target.value } : c)),
                    )
                  }
                />
                <select
                  className="onb-campo onb-select"
                  value={cuenta.tipo}
                  onChange={(e) =>
                    setCuentas((prev) =>
                      prev.map((c, j) => (j === i ? { ...c, tipo: e.target.value } : c)),
                    )
                  }
                >
                  {TIPOS_CUENTA.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.etiqueta}
                    </option>
                  ))}
                </select>
                <label className="onb-check">
                  <input
                    type="checkbox"
                    checked={cuenta.recibe_avisos}
                    onChange={(e) =>
                      setCuentas((prev) =>
                        prev.map((c, j) => (j === i ? { ...c, recibe_avisos: e.target.checked } : c)),
                      )
                    }
                  />
                  Me llegan avisos por correo
                </label>
                {cuentas.length > 1 && (
                  <button
                    type="button"
                    className="fin-toggle onb-quitar"
                    onClick={() => setCuentas((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="Quitar cuenta"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="fin-toggle"
            onClick={() => setCuentas((prev) => [...prev, { ...CUENTA_VACIA }])}
          >
            <Plus size={13} /> Agregar otra
          </button>

          {cuentasCiegas > 0 && (
            <p className="fin-setup-ayuda onb-honestidad">
              <Landmark size={13} /> De {cuentasCiegas === 1 ? "esa cuenta" : `esas ${cuentasCiegas} cuentas`} no
              voy a ver los movimientos. Te lo voy a decir cada vez que te muestre un número, para que
              sepas qué parte estoy mirando.
            </p>
          )}
        </>
      )}

      {(paso === "ingresos" || paso === "gastos_fijos") && (
        <ListaFijos
          tipo={paso === "ingresos" ? "ingreso" : "gasto"}
          fijos={fijos}
          setFijos={setFijos}
        />
      )}

      {paso === "deudas" && (
        <>
          <div className="fin-setup-pregunta">¿A quién le debés hoy?</div>
          <div className="fin-setup-ayuda">
            No es para juzgarte. Es para poder avisarte antes de que una cuota te agarre corto, y
            para armarte un plan cuando haga falta. Si no debés nada, seguí de largo.
          </div>

          <div className="onb-lista">
            {deudas.map((deuda, i) => (
              <div key={deuda.id ?? i} className="onb-fila onb-fila-deuda">
                <input
                  className="onb-campo onb-input"
                  placeholder="¿A quién? (ej. Banco Itaú)"
                  value={deuda.acreedor}
                  disabled={Boolean(deuda.id)}
                  onChange={(e) =>
                    setDeudas((prev) =>
                      prev.map((d, j) => (j === i ? { ...d, acreedor: e.target.value } : d)),
                    )
                  }
                />
                <select
                  className="onb-campo onb-select"
                  value={deuda.tipo}
                  disabled={Boolean(deuda.id)}
                  onChange={(e) =>
                    setDeudas((prev) => prev.map((d, j) => (j === i ? { ...d, tipo: e.target.value } : d)))
                  }
                >
                  {TIPOS_DEUDA.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.etiqueta}
                    </option>
                  ))}
                </select>
                <input
                  className="onb-campo onb-monto"
                  inputMode="decimal"
                  placeholder="Saldo ₲"
                  value={deuda.saldo_declarado}
                  disabled={Boolean(deuda.id)}
                  onChange={(e) =>
                    setDeudas((prev) =>
                      prev.map((d, j) => (j === i ? { ...d, saldo_declarado: e.target.value } : d)),
                    )
                  }
                />
                <input
                  className="onb-campo onb-monto"
                  inputMode="decimal"
                  placeholder="Cuota ₲"
                  value={deuda.cuota_monto}
                  disabled={Boolean(deuda.id)}
                  onChange={(e) =>
                    setDeudas((prev) =>
                      prev.map((d, j) => (j === i ? { ...d, cuota_monto: e.target.value } : d)),
                    )
                  }
                />
                <input
                  className="onb-campo onb-dia"
                  inputMode="numeric"
                  placeholder="Día"
                  value={deuda.cuota_dia}
                  disabled={Boolean(deuda.id)}
                  onChange={(e) =>
                    setDeudas((prev) =>
                      prev.map((d, j) => (j === i ? { ...d, cuota_dia: e.target.value } : d)),
                    )
                  }
                />
                <label className="onb-check">
                  <input
                    type="checkbox"
                    checked={deuda.preocupa}
                    disabled={Boolean(deuda.id)}
                    onChange={(e) =>
                      setDeudas((prev) =>
                        prev.map((d, j) => (j === i ? { ...d, preocupa: e.target.checked } : d)),
                      )
                    }
                  />
                  Esta es la que más me preocupa
                </label>
                {!deuda.id && deudas.length > 1 && (
                  <button
                    type="button"
                    className="fin-toggle onb-quitar"
                    onClick={() => setDeudas((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="Quitar deuda"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="fin-toggle"
            onClick={() => setDeudas((prev) => [...prev, { ...DEUDA_VACIA }])}
          >
            <Plus size={13} /> Agregar otra
          </button>

          <p className="fin-setup-ayuda onb-honestidad">
            El saldo queda anotado con la fecha de hoy. No lo voy a recalcular por mi cuenta: cuando
            cambie, me lo decís y listo.
          </p>
        </>
      )}

      {paso === "preocupaciones" && (
        <>
          <div className="fin-setup-pregunta">¿Qué es lo que más te preocupa?</div>
          <div className="fin-setup-ayuda">
            Escribilo como se te ocurra. Me sirve para saber por dónde empezar y de qué no hablarte
            de entrada.
          </div>
          <textarea
            className="onb-campo onb-texto"
            rows={3}
            value={preocupacion}
            onChange={(e) => setPreocupacion(e.target.value)}
            placeholder="Ej. llegar al 20 sin plata para los sueldos"
          />

          <div className="fin-setup-pregunta onb-pregunta-secundaria">
            ¿Hay algo que preferís no mirar?
          </div>
          <div className="fin-setup-ayuda">
            Todos tenemos algo. Si me lo decís, me encargo yo y te aviso solo cuando haga falta.
          </div>
          <textarea
            className="onb-campo onb-texto"
            rows={2}
            value={evitaMirar}
            onChange={(e) => setEvitaMirar(e.target.value)}
            placeholder="Ej. el resumen de la tarjeta"
          />
        </>
      )}

      {paso === "correo" && (
        <>
          <div className="fin-setup-pregunta">Y esto es lo último que necesito de vos</div>
          <div className="fin-setup-ayuda">
            Reenviá a esta dirección los avisos que te manda el banco. Con eso registro los
            movimientos solos, sin que vuelvas a escribir un número.
          </div>
          <FinanzasBuzon />
        </>
      )}

      {paso === "cierre" && (
        <>
          <div className="fin-setup-pregunta">Listo. Ya no tenés que contarme nada más.</div>
          <div className="fin-setup-ayuda">
            Desde acá me encargo yo: miro lo que entra y lo que sale, proyecto lo que viene y te
            aviso si algo necesita tu atención. No hace falta que abras esto todos los días.
          </div>
          <div className="fin-rows onb-resumen">
            <div className="fin-row">
              <span className="fin-row-label">Cuentas</span>
              <span className="fin-row-value">{cuentas.filter((c) => c.nombre.trim()).length}</span>
            </div>
            <div className="fin-row">
              <span className="fin-row-label">Ingresos y gastos fijos</span>
              <span className="fin-row-value">{fijos.filter((f) => f.descripcion.trim()).length}</span>
            </div>
            <div className="fin-row">
              <span className="fin-row-label">Deudas</span>
              <span className="fin-row-value">{deudas.filter((d) => d.acreedor.trim()).length}</span>
            </div>
          </div>
          <div className="fin-setup-ayuda">
            Si algo cambia —una cuenta nueva, una deuda que saldaste— me lo decís cuando quieras.
          </div>
        </>
      )}

      {error && <p className="fin-setup-error" role="alert">{error}</p>}

      <div className="fin-setup-acciones">
        {indice > 0 ? (
          <button type="button" className="fin-toggle" onClick={retroceder} disabled={guardando}>
            <ArrowLeft size={13} />
            Atrás
          </button>
        ) : (
          <span />
        )}

        <button type="button" className="reco-btn" onClick={() => void avanzar()} disabled={guardando}>
          {guardando ? (
            <>
              <Loader2 size={12} className="fin-spin onb-icono" />
              Guardando…
            </>
          ) : paso === "cierre" ? (
            <>
              <Check size={12} className="onb-icono" />
              Empezar
            </>
          ) : paso === "bienvenida" ? (
            <>
              Empecemos
              <ArrowRight size={12} className="onb-icono onb-icono-der" />
            </>
          ) : (
            <>
              Seguir
              <ArrowRight size={12} className="onb-icono onb-icono-der" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Ingresos y gastos fijos comparten pantalla y tabla, pero se preguntan por
 * separado. Mezclarlos en una sola lista obligaría al usuario a clasificar cada
 * renglón, que es trabajo de EOS, no suyo.
 */
function ListaFijos({
  tipo,
  fijos,
  setFijos,
}: {
  tipo: "ingreso" | "gasto";
  fijos: Fijo[];
  setFijos: React.Dispatch<React.SetStateAction<Fijo[]>>;
}) {
  const propios = fijos.map((f, i) => ({ f, i })).filter(({ f }) => f.tipo === tipo);

  const pregunta =
    tipo === "ingreso" ? "¿De dónde entra tu plata?" : "¿Qué se te va todos los meses, sí o sí?";
  const ayuda =
    tipo === "ingreso"
      ? "Sueldo, cobros de clientes, alquileres que cobrás. Con el monto aproximado y el día alcanza."
      : "Alquiler, colegio, sueldos, servicios. Lo que sabés que va a salir aunque no lo mires.";

  function agregar() {
    setFijos((prev) => [...prev, { tipo, descripcion: "", monto: "", dia_del_mes: "" }]);
  }

  return (
    <>
      <div className="fin-setup-pregunta">{pregunta}</div>
      <div className="fin-setup-ayuda">{ayuda}</div>

      <div className="onb-lista">
        {propios.length === 0 && <p className="empty-note">Todavía no cargaste ninguno.</p>}

        {propios.map(({ f, i }) => (
          <div key={i} className="onb-fila">
            <input
              className="onb-campo onb-input"
              placeholder={tipo === "ingreso" ? "Ej. Sueldo" : "Ej. Alquiler"}
              value={f.descripcion}
              onChange={(e) =>
                setFijos((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x)),
                )
              }
            />
            <input
              className="onb-campo onb-monto"
              inputMode="decimal"
              placeholder="Monto ₲"
              value={f.monto}
              onChange={(e) =>
                setFijos((prev) => prev.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))
              }
            />
            <input
              className="onb-campo onb-dia"
              inputMode="numeric"
              placeholder="Día"
              value={f.dia_del_mes}
              onChange={(e) =>
                setFijos((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, dia_del_mes: e.target.value } : x)),
                )
              }
            />
            <button
              type="button"
              className="fin-toggle onb-quitar"
              onClick={() => setFijos((prev) => prev.filter((_, j) => j !== i))}
              aria-label="Quitar"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="fin-toggle" onClick={agregar}>
        <Plus size={13} /> Agregar {tipo === "ingreso" ? "un ingreso" : "un gasto"}
      </button>
    </>
  );
}
