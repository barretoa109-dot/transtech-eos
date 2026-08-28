"use client";

import { InputHTMLAttributes, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Un campo de contraseña que se puede mirar.
 *
 * ============================================================
 * POR QUÉ IMPORTA MÁS DE LO QUE PARECE
 * ============================================================
 *
 * Sin esto, quien se equivoca al tipear no tiene forma de saberlo: escribe a
 * ciegas, le rebota, y no sabe si erró la contraseña o si la cuenta no existe.
 * En el registro es peor todavía, porque el error queda guardado y recién
 * aparece la próxima vez que intenta entrar.
 *
 * En un teclado de teléfono, donde la mayoría de los usuarios de EOS van a
 * escribir, la diferencia entre poder mirar y no poder es que alguien entre o
 * abandone.
 *
 * ============================================================
 * DETALLES QUE NO SON DETALLES
 * ============================================================
 *
 * `type="button"`: sin eso, el botón dentro del formulario lo envía. Mirar la
 * contraseña dispararía el login a medio escribir.
 *
 * `tabIndex={-1}`: quien navega con el teclado va del campo al botón de entrar,
 * no al ojo. El ojo es para el mouse y para el dedo.
 *
 * El `autoComplete` lo decide quien usa el componente, no este archivo: en el
 * login es `current-password` y en el registro `new-password`, y el
 * administrador de contraseñas del navegador se comporta distinto con cada uno.
 */

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /* Las clases del input van tal cual: cada formulario tiene su estilo. */
  className?: string;
};

export default function CampoContrasena({ className = "", ...props }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        /*
         * `pr-12` deja lugar al botón para que no tape lo que se escribe.
         * `block` evita el par de píxeles que un input en línea agrega abajo
         * por el interlineado, y que correrían el ojo respecto del campo.
         */
        className={`${className} block pr-12`}
      />

      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute right-0 top-0 flex h-full w-12 items-center justify-center text-slate-400 transition hover:text-slate-200"
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
