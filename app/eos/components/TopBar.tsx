"use client";

import { useEffect, useState } from "react";
import { LifeBuoy, Moon, Sparkles, Sun } from "lucide-react";

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
export default function TopBar({ tema, pantalla }: { tema?: ControlTema; pantalla?: string }) {
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

  return (
    <div className="topbar">
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

      {tema && (
        <button
          type="button"
          className="tema-btn"
          onClick={tema.alternar}
          /*
           * El nombre dice a dónde va, no dónde está. "Modo oscuro" a secas
           * deja al usuario adivinando si es el estado actual o lo que va a
           * pasar si aprieta — y con el ícono al lado, las dos lecturas son
           * plausibles.
           */
          aria-label={tema.aplicado === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          title={tema.aplicado === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        >
          {tema.aplicado === "oscuro" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      )}

      <button
        type="button"
        className="ayuda-btn"
        onClick={() => setAyuda((v) => !v)}
        aria-expanded={ayuda}
        aria-haspopup="dialog"
      >
        <LifeBuoy size={15} />
        <span>Ayuda</span>
      </button>

      {ayuda && (
        <div className="ayuda-pop" role="dialog" aria-label="Pedir ayuda">
          <Soporte pantalla={pantalla} abiertoInicial onCerrar={() => setAyuda(false)} />
        </div>
      )}
    </div>
  );
}
