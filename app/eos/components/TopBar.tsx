"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, LifeBuoy, Moon, MoreHorizontal, Sparkles, Store, Sun, User } from "lucide-react";

import Soporte from "./Soporte";
import type { ControlTema } from "./useTema";

/**
 * La barra de arriba: estado del sistema, memoria, y el interruptor del tema.
 *
 * El interruptor vive acá y no en el perfil por una razón práctica: cambiar de
 * claro a oscuro no es una configuración que se toca una vez, es algo que se
 * hace cuando la luz cambia. Enterrarlo tres pantallas adentro lo vuelve una
 * función que existe y no se usa.
 *
 * Un botón y no un menú de tres opciones. La tercera —"seguir el sistema"— es
 * el valor de arranque y no hace falta pedirla: quien nunca tocó el botón ya
 * la tiene. Ofrecerla explícitamente en la barra costaría un desplegable para
 * un caso que casi nadie busca.
 */
type TopBarProps = {
  tema?: ControlTema;
  pantalla?: string;
  /** El espacio activo. En el teléfono se muestra al lado del botón de menú. */
  espacio?: { nombre: string; tipo: "personal" | "negocio" };
  onAbrirEspacios?: () => void;
};

export default function TopBar({ tema, pantalla, espacio, onAbrirEspacios }: TopBarProps) {
  /*
   * Pedir ayuda desde cualquier pantalla (24/09/2026, antes del piloto).
   *
   * El formulario de soporte existía, pero solo al fondo del perfil: quien se
   * traba en el chat o en Negocio no sabe que está ahí. Un cliente trabado que
   * no encuentra cómo pedir ayuda no pide ayuda: se va. Acá está siempre a la
   * vista, y el correo que nos llega dice en qué pantalla estaba.
   */
  const [ayuda, setAyuda] = useState(false);

  useEffect(() => {
    if (!ayuda) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAyuda(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [ayuda]);

  /*
   * El tema y la ayuda comparten un solo botón ("···"): dos interruptores
   * sueltos en la barra competían con el espacio y el estado del sistema.
   */
  const [masAbierto, setMasAbierto] = useState(false);
  const masRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!masAbierto) return;
    const alTocarAfuera = (e: PointerEvent) => {
      if (masRef.current && !masRef.current.contains(e.target as Node)) setMasAbierto(false);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMasAbierto(false);
    };
    document.addEventListener("pointerdown", alTocarAfuera);
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("pointerdown", alTocarAfuera);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [masAbierto]);

  return (
    <div className="topbar">
      {/*
        El espacio activo, en el teléfono (05/10/2026). En la computadora ya
        está a la vista en el lateral; en el teléfono el lateral está cerrado,
        y sin esto no habría forma de saber si lo que se mira es de la persona
        o del negocio. Tocarlo abre el menú con el selector desplegado.
      */}
      {espacio && onAbrirEspacios ? (
        <button
          type="button"
          className="topbar-espacio"
          onClick={onAbrirEspacios}
          aria-label={`Cambiar de espacio. Estás en ${espacio.nombre}`}
        >
          <span className="espacio-ic is-chico">
            {espacio.tipo === "personal" ? <User size={15} /> : <Store size={15} />}
          </span>
          <span className="espacio-txt">
            <b>{espacio.nombre}</b>
            <span>{espacio.tipo === "personal" ? "Personal" : "Negocio"}</span>
          </span>
          <ChevronsUpDown size={14} />
        </button>
      ) : null}
      <div className="status">
        <span className="dot-wrap">
          <span className="dot" />
          <span className="dot-ping" />
        </span>
        Sistema activo
      </div>
      <div className="status mem">
        <Sparkles size={14} />
        Memoria contextual
      </div>

      <div className="mas-opciones" ref={masRef}>
        <button
          type="button"
          className="tema-btn"
          onClick={() => setMasAbierto((v) => !v)}
          aria-expanded={masAbierto}
          aria-haspopup="menu"
          aria-label="Más opciones"
          title="Más opciones"
        >
          <MoreHorizontal size={16} />
        </button>

        {masAbierto && (
          <div className="conv-menu mas-opciones-pop" role="menu">
            {tema && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tema.alternar();
                  setMasAbierto(false);
                }}
              >
                {tema.aplicado === "oscuro" ? <Sun size={15} /> : <Moon size={15} />}
                {tema.aplicado === "oscuro" ? "Modo claro" : "Modo oscuro"}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAyuda(true);
                setMasAbierto(false);
              }}
            >
              <LifeBuoy size={15} />
              Ayuda
            </button>
          </div>
        )}
      </div>

      {ayuda && (
        <div className="ayuda-pop" role="dialog" aria-label="Pedir ayuda">
          <Soporte pantalla={pantalla} abiertoInicial onCerrar={() => setAyuda(false)} />
        </div>
      )}
    </div>
  );
}
