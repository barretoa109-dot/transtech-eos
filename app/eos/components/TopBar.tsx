"use client";

import { Moon, Sparkles, Sun } from "lucide-react";

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
export default function TopBar({ tema }: { tema?: ControlTema }) {
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
    </div>
  );
}
