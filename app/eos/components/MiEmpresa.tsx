"use client";

import { useEffect, useState } from "react";
import { Building2, Check, UserPlus, X } from "lucide-react";

/**
 * El equipo: quiénes son, quién falta y en qué empresa estoy trabajando.
 *
 * ============================================================
 * INVITAR ES DAR ACCESO A LA PLATA DEL NEGOCIO
 * ============================================================
 *
 * No es agregar un contacto. Quien acepta pasa a ver las ventas, los costos y
 * los márgenes, así que la pantalla lo dice con esas palabras antes de que
 * alguien toque el botón. Un formulario que solo pide correo y rol hace
 * parecer que es un trámite.
 *
 * ============================================================
 * CAMBIAR DE EMPRESA ES A MANO Y SIEMPRE
 * ============================================================
 *
 * Aceptar una invitación NO cambia en cuál estás trabajando. Entrar un día y
 * ver de golpe los números de otro negocio, sin haber tocado nada, es la
 * clase de sorpresa que hace desconfiar del sistema entero.
 */

type Empresa = { id: string; nombre: string; rol: string; activa: boolean };
type Miembro = { usuario_id: string; email: string | null; rol: string; soy_yo: boolean };
type Enviada = { id: string; email: string; rol: string };
type Recibida = { id: string; rol: string; empresa: string };

type Estado = {
  empresas: Empresa[];
  miembros: Miembro[];
  invitaciones_enviadas: Enviada[];
  invitaciones_recibidas: Recibida[];
  puedo_administrar: boolean;
};

const ROLES: { valor: string; etiqueta: string; explica: string }[] = [
  { valor: "administrador", etiqueta: "Administrador", explica: "Puede todo, incluido invitar" },
  { valor: "ventas", etiqueta: "Ventas", explica: "Carga ventas y clientes" },
  { valor: "compras", etiqueta: "Compras", explica: "Carga compras y proveedores" },
  { valor: "deposito", etiqueta: "Depósito", explica: "Maneja el stock" },
  { valor: "caja", etiqueta: "Caja", explica: "Cobra y paga" },
  { valor: "contabilidad", etiqueta: "Contabilidad", explica: "Ve los números, no los cambia" },
  { valor: "solo_lectura", etiqueta: "Solo lectura", explica: "Mira y no toca nada" },
];

const NOMBRE_ROL: Record<string, string> = {
  propietario: "Dueño",
  ...Object.fromEntries(ROLES.map((r) => [r.valor, r.etiqueta])),
};

export default function MiEmpresa() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState("ventas");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const res = await traer();
      if (!vivo) return;
      if (res) setEstado(res);
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function refrescar() {
    const res = await traer();
    if (res) setEstado(res);
  }

  async function pedir(url: string, opciones: RequestInit) {
    setOcupado(true);
    setAviso("");
    try {
      const r = await fetch(url, opciones);
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAviso(cuerpo?.error ?? "No pudimos completar la operación.");
        return false;
      }
      await refrescar();
      return true;
    } catch {
      setAviso("No pudimos completar la operación.");
      return false;
    } finally {
      setOcupado(false);
    }
  }

  if (cargando || !estado) return null;

  const activa = estado.empresas.find((e) => e.activa);

  return (
    <div className="card">
      <div className="card-title">
        <Building2 size={15} /> Tu equipo
      </div>
      <div className="card-sub">
        {activa ? `Estás trabajando en ${activa.nombre}.` : "Todavía no elegiste una empresa."}
      </div>

      {/* Las invitaciones recibidas van PRIMERO: es lo único de esta pantalla
          que espera una decisión de la persona. */}
      {estado.invitaciones_recibidas.length > 0 && (
        <div className="emp-invitaciones">
          {estado.invitaciones_recibidas.map((i) => (
            <div key={i.id} className="emp-invitacion">
              <div>
                <strong>Te invitaron a {i.empresa}</strong>
                <small>
                  Como {NOMBRE_ROL[i.rol] ?? i.rol}. Vas a poder ver los números de ese negocio.
                </small>
              </div>
              <button
                type="button"
                className="reco-btn"
                disabled={ocupado}
                onClick={() =>
                  void pedir("/api/empresa/miembros", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ aceptar: i.id }),
                  })
                }
              >
                <Check size={13} /> Aceptar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* El selector solo aparece con más de una: con una sola es ruido. */}
      {estado.empresas.length > 1 && (
        <div className="chip-row">
          {estado.empresas.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`chip ${e.activa ? "active" : ""}`}
              disabled={ocupado || e.activa}
              onClick={() =>
                void pedir("/api/empresa", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ empresa_id: e.id }),
                })
              }
            >
              {e.nombre}
            </button>
          ))}
        </div>
      )}

      <div className="neg-lista">
        {estado.miembros.map((m) => (
          <div key={m.usuario_id} className="neg-fila">
            <div className="neg-fila-texto">
              <strong>
                {m.email ?? "Sin correo"}
                {m.soy_yo && <span className="emp-yo">vos</span>}
              </strong>
              <small>{NOMBRE_ROL[m.rol] ?? m.rol}</small>
            </div>

            {/* Al dueño no se le cambia el rol ni se lo saca: la empresa
                quedaría sin quien la administre. La base lo impide igual;
                acá no se ofrece para no ofrecer algo que va a fallar. */}
            {estado.puedo_administrar && !m.soy_yo && m.rol !== "propietario" && (
              <div className="emp-acciones">
                <select
                  className="neg-input"
                  value={m.rol}
                  disabled={ocupado}
                  aria-label={`Rol de ${m.email ?? "este miembro"}`}
                  onChange={(e) =>
                    void pedir("/api/empresa/miembros", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ usuario_id: m.usuario_id, rol: e.target.value }),
                    })
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r.valor} value={r.valor}>
                      {r.etiqueta}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="chip"
                  disabled={ocupado}
                  onClick={() =>
                    void pedir(`/api/empresa/miembros?usuario_id=${m.usuario_id}`, { method: "DELETE" })
                  }
                >
                  <X size={12} /> Sacar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {estado.invitaciones_enviadas.length > 0 && (
        <>
          <div className="emp-subtitulo">Invitaciones sin responder</div>
          <div className="neg-lista">
            {estado.invitaciones_enviadas.map((i) => (
              <div key={i.id} className="neg-fila">
                <div className="neg-fila-texto">
                  <strong>{i.email}</strong>
                  <small>Invitado como {NOMBRE_ROL[i.rol] ?? i.rol}</small>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {estado.puedo_administrar && (
        <div className="emp-invitar">
          <div className="emp-subtitulo">Invitar a alguien</div>
          {/* Se dice qué implica ANTES del formulario, no después. */}
          <p className="emp-advertencia">
            Quien acepte va a ver las ventas, los costos y los márgenes de este negocio.
          </p>

          <div className="neg-form">
            <input
              className="neg-input neg-field-wide"
              type="email"
              inputMode="email"
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Correo de quien invitás"
            />
            <select
              className="neg-input"
              value={rol}
              onChange={(e) => setRol(e.target.value)}
              aria-label="Rol"
            >
              {ROLES.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.etiqueta} — {r.explica}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="reco-btn"
              disabled={ocupado || !email.trim()}
              onClick={async () => {
                const ok = await pedir("/api/empresa/miembros", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: email.trim(), rol }),
                });
                if (ok) setEmail("");
              }}
            >
              <UserPlus size={13} /> Invitar
            </button>
          </div>
        </div>
      )}

      {aviso && <p className="neg-error" role="alert">{aviso}</p>}
    </div>
  );
}

/** Fuera del componente: así el efecto no toca estado antes de su primer await. */
async function traer(): Promise<Estado | null> {
  try {
    const r = await fetch("/api/empresa", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Estado;
  } catch {
    return null;
  }
}
