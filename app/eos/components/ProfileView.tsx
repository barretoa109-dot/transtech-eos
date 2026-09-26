"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import CerrarSesion from "./CerrarSesion";
import Soporte from "./Soporte";
import EliminarCuenta from "./EliminarCuenta";
import RehacerOnboarding from "./RehacerOnboarding";
import MisModulos from "./MisModulos";
import MisTarjetas from "./MisTarjetas";
import MiEmpresa from "./MiEmpresa";
import Cajas from "./negocio/Cajas";
import VincularWhatsApp from "./VincularWhatsApp";
import { NUMERO_WHATSAPP_EOS, enlaceWhatsappEOS } from "@/lib/whatsapp/numero-eos";

type ProfileViewProps = {
  nombre: string;
  /**
   * El plan interno del usuario. Ya no se muestra —desde el plan armado, ese
   * nombre no se corresponde con lo que compró— pero sigue llegando porque el
   * cupo de mensajes se sigue derivando de él. Ver `MisModulos`.
   */
  plan: string;
  email: string;
  usuarioId: string;
  conversaciones: number;
  mensajes: number;
};

type Uso = {
  plan_nombre: string | null;
  limite_mensajes: number | null;
  memoria_dias: number | null;
  usados: number;
};

export default function ProfileView({ nombre, email, usuarioId, conversaciones }: ProfileViewProps) {
  const [copiado, setCopiado] = useState(false);
  const [uso, setUso] = useState<Uso | null>(null);
  // Arranca con el número de EOS ya puesto: la fila no puede depender de que una
  // llamada de red responda ni de que una variable de entorno esté cargada. La
  // respuesta del endpoint solo lo corrige si el número cambió.
  const [numeroEOS, setNumeroEOS] = useState<string>(NUMERO_WHATSAPP_EOS);

  useEffect(() => {
    let activo = true;

    fetch("/api/eos-uso", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (activo && payload && !payload.error) setUso(payload);
      })
      .catch(() => {
        /* la tarjeta de uso simplemente no se muestra */
      });

    // Mismo endpoint que ya consulta `VincularWhatsApp`: si se migra de número,
    // `WHATSAPP_DISPLAY_NUMBER` lo cambia sin tocar código (ver
    // `lib/whatsapp/numero-eos.ts`).
    fetch("/api/whatsapp/vincular", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (activo && payload?.numero_whatsapp_eos) setNumeroEOS(payload.numero_whatsapp_eos);
      })
      .catch(() => {
        /* el número de arranque ya está en pantalla */
      });

    return () => {
      activo = false;
    };
  }, []);

  const iniciales =
    nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("") || "U";

  async function copiarUsuarioId() {
    if (!usuarioId || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(usuarioId);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1800);
    } catch (error) {
      console.error("No se pudo copiar el ID del usuario:", error);
    }
  }

  const limite = uso?.limite_mensajes ?? null;
  const usados = uso?.usados ?? 0;
  const ilimitado = limite === null || limite < 0;
  const porcentaje = ilimitado || limite === 0 ? 0 : Math.min(100, Math.round((usados / limite) * 100));

  return (
    <div className="view" id="view-perfil">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">Perfil</div>
          <div className="page-title">Tu cuenta</div>
          <div className="page-sub">Datos de la cuenta, memoria y uso del asistente.</div>
        </div>

        <div className="profile-hero">
          <div className="profile-avatar-lg">{iniciales}</div>
          <div>
            <div className="profile-name">{nombre || "Usuario"}</div>
            {/*
              Ya no dice "Plan Pro": desde que el plan lo arma el usuario, ese
              nombre es un dato interno que no se corresponde con lo que compró.
              Lo que tiene contratado se lista abajo, con sus vencimientos.
            */}
            <div className="plan-badge">Tu EOS</div>
          </div>
          <Link href="/planes" className="ghost-btn">
            Cambiar mis funciones
          </Link>
        </div>

        <div className="card">
          <div className="card-title">Información de la cuenta</div>
          <div className="field-row">
            <span className="field-label">Usuario</span>
            <span className="field-value">{nombre || "Usuario"}</span>
          </div>
          <div className="field-row">
            <span className="field-label">Correo</span>
            <span className="field-value">{email || "—"}</span>
          </div>

          <div className="field-row">
            <span className="field-label">
              WhatsApp de EOS
              <span className="field-hint">Para escribirle a EOS desde WhatsApp</span>
            </span>
            <a
              href={enlaceWhatsappEOS(numeroEOS)}
              target="_blank"
              rel="noopener noreferrer"
              className="field-value"
              style={{ color: "var(--blue)", textDecoration: "none" }}
            >
              {numeroEOS}
            </a>
          </div>

          <div className="field-row">
            <span className="field-label">ID de usuario</span>
            <button
              type="button"
              onClick={copiarUsuarioId}
              className="field-value"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: copiado ? "var(--green)" : "var(--blue)",
              }}
            >
              {copiado ? <Check size={13} /> : <Copy size={13} />}
              {copiado ? "Copiado" : usuarioId ? `${usuarioId.slice(0, 8)}…` : "No disponible"}
            </button>
          </div>
        </div>

        {/* El equipo va antes que los módulos: quién entra al negocio es una
            decisión sobre los datos, no sobre lo que se paga. */}
        <MiEmpresa />

        {/* La caja va pegada al equipo: las dos responden a "cómo está armado
            mi negocio", y es donde alguien la va a buscar. */}
        <Cajas />

        {/* Junto a los módulos: es otra forma de "cómo está armado mi EOS",
            no un dato de la cuenta en sí. */}
        <VincularWhatsApp />

        <MisModulos />

        {/*
          Las tarjetas van junto a los módulos: las dos cosas responden a la
          misma pregunta —qué estoy pagando y con qué—. Y es donde alguien las
          busca cuando quiere sacar un medio de pago.
        */}
        <MisTarjetas />

        <div className="card">
          <div className="card-title">Memoria y contexto</div>
          <div className="field-row">
            <span className="field-label">
              Memoria contextual
              <span className="field-hint">EOS recuerda tu contexto entre conversaciones</span>
            </span>
            <span className="field-value">
              {uso?.memoria_dias === null || uso?.memoria_dias === undefined
                ? "Según tu plan"
                : uso.memoria_dias < 0
                  ? "Incluida en tu plan"
                  : `${uso.memoria_dias} días`}
            </span>
          </div>
          <div className="field-row">
            <span className="field-label">
              Conversaciones guardadas
              <span className="field-hint">Historial disponible en la barra lateral</span>
            </span>
            <span className="field-value">{conversaciones}</span>
          </div>

          {/*
            Rehacer la configuración inicial.

            Hasta ahora `completado_en` se ponía una vez y no se limpiaba
            nunca: quien se equivocó al principio —o cambió de situación, que
            con el tiempo es lo normal— quedaba con una configuración que ya no
            lo representa y sin forma de rehacerla.
          */}
          <RehacerOnboarding />
        </div>

        <div className="card">
          <div className="card-title">Plan y uso</div>
          {uso === null ? (
            <p className="empty-note">Cargando uso del plan…</p>
          ) : ilimitado ? (
            /*
              Sin barra y sin decir "sin límite": todo plan tiene un tope, que el
              cliente no ve pero que tampoco se le niega (regla del dueño,
              26/09/2026). Una barra llena al 100 % además se leía como agotado.
            */
            <div className="usage-text">
              {usados} {usados === 1 ? "mensaje usado" : "mensajes usados"} este mes · incluidos en tu plan
            </div>
          ) : (
            <>
              <div className="usage-text">
                {usados} de {limite} mensajes usados este mes
              </div>
              <div className="usage-bar">
                <div className="usage-fill" style={{ width: `${porcentaje}%` }} />
              </div>
            </>
          )}
          <Link href="/planes" className="reco-btn" style={{ display: "inline-flex", marginTop: 10 }}>
            Cambiar mi cupo de mensajes
          </Link>
        </div>
      </div>

      {/*
        Pedir ayuda va antes que irse.

        Quien llega al final del perfil puede estar por dos motivos muy
        distintos: algo no le funciona, o se quiere ir. Ofrecer ayuda primero
        atiende el primero antes de que se convierta en el segundo.
      */}
      <div className="soporte-fila">
        <Soporte pantalla="perfil" />
      </div>

      {/*
        Salir va ANTES de eliminar y separado.

        Son las dos formas de irse de EOS y no se parecen en nada: una se
        deshace volviendo a entrar y la otra no se deshace. Ponerlas juntas,
        con el mismo aspecto, es pedirle a alguien apurado que destruya su
        cuenta cuando sólo quería cerrar la sesión.
      */}
      <div className="cerrar-sesion-fila">
        <CerrarSesion />
      </div>

      <EliminarCuenta />
    </div>
  );
}

