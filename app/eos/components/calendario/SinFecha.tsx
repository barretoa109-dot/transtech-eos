"use client";

import { CalendarPlus, Check } from "lucide-react";

import type { TareaSinFecha } from "@/lib/calendario/fuentes";
import Confirmar from "../negocio/Confirmar";

/**
 * Las tareas que EOS anotó pero no tienen día.
 *
 * "Tengo que llamar al proveedor", dicho sin cuándo, queda guardado pero no cae en
 * ningún casillero del calendario. Sin esta lista sería una tarea que la persona
 * creyó anotada y que nadie va a volver a ver. Acá se resuelve con lo que hace
 * falta: ponerle un día, marcarla hecha o borrarla.
 */
export default function SinFecha({
  tareas,
  ocupado,
  onPonerFecha,
  onHecho,
  onBorrar,
}: {
  tareas: TareaSinFecha[];
  ocupado: string | null;
  onPonerFecha: (t: TareaSinFecha) => void;
  onHecho: (t: TareaSinFecha) => void;
  onBorrar: (t: TareaSinFecha) => void;
}) {
  if (tareas.length === 0) return null;

  return (
    <div className="card">
      <div className="card-title">Sin fecha</div>
      <div className="card-sub">
        {tareas.length === 1 ? "Una tarea que anotaste" : `${tareas.length} tareas que anotaste`} sin decir para cuándo.
        Ponele un día y aparece en el calendario.
      </div>

      <ul className="cal-lista compacta">
        {tareas.map((t) => (
          <li key={t.id} className="cal-sinfecha">
            <div className="cal-sinfecha-texto">
              <span className="cal-salto-titulo">{t.titulo}</span>
              {t.detalle && <small>{t.detalle}</small>}
            </div>
            <div className="cal-item-acciones">
              <button type="button" className="chip" disabled={ocupado === t.id} onClick={() => onPonerFecha(t)}>
                <CalendarPlus size={12} /> Ponerle fecha
              </button>
              <button type="button" className="chip" disabled={ocupado === t.id} onClick={() => onHecho(t)}>
                <Check size={12} /> Hecho
              </button>
              <Confirmar
                etiqueta="Borrar"
                consecuencia={`Se borra “${t.titulo}”. No se puede deshacer.`}
                confirmar="Borrar tarea"
                peligro
                ocupado={ocupado === t.id}
                onConfirmar={() => onBorrar(t)}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
