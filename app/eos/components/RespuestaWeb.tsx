"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Globe, Search } from "lucide-react";

import { partirCitas, type FuenteWeb, type RespuestaConFuentes } from "@/lib/eos/fuentes-web";

/*
 * Una respuesta de EOS con búsqueda web (01/10/2026).
 *
 * Sin corchetes ni paréntesis: cada cita es un número chico que se toca y abre
 * la fuente; las fuentes son tarjetas con su vista previa (título, descripción,
 * imagen, sitio), que se abren en otra pestaña. Nada se descarga. La vista
 * previa la lee el servidor (/api/vista-previa); si no llega, la tarjeta
 * igual muestra el título y el sitio que vinieron con la búsqueda.
 */

type Vista = { titulo: string | null; descripcion: string | null; imagen: string | null };

const VISIBLES = 3;

function Cita({ fuente }: { fuente: FuenteWeb }) {
  return (
    <a
      className="cita-web"
      href={fuente.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${fuente.titulo} · ${fuente.sitio}`}
      aria-label={`Fuente ${fuente.n}: ${fuente.titulo}`}
    >
      {fuente.n}
    </a>
  );
}

function TarjetaFuente({ fuente }: { fuente: FuenteWeb }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [conIcono, setConIcono] = useState(true);
  const [conImagen, setConImagen] = useState(true);

  useEffect(() => {
    let activo = true;
    fetch(`/api/vista-previa?url=${encodeURIComponent(fuente.url)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v: Vista | null) => {
        if (activo && v) setVista(v);
      })
      .catch(() => {});
    return () => {
      activo = false;
    };
  }, [fuente.url]);

  const titulo = vista?.titulo || fuente.titulo;

  return (
    <a className="fuente-web" href={fuente.url} target="_blank" rel="noopener noreferrer">
      {vista?.imagen && conImagen ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="fuente-web-imagen"
          src={vista.imagen}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setConImagen(false)}
        />
      ) : null}
      <span className="fuente-web-texto">
        <span className="fuente-web-sitio">
          <span className="fuente-web-n">{fuente.n}</span>
          {conIcono ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="fuente-web-icono"
              src={`https://${fuente.sitio}/favicon.ico`}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setConIcono(false)}
            />
          ) : (
            <Globe size={13} aria-hidden="true" />
          )}
          <span>{fuente.sitio}</span>
        </span>
        <strong>{titulo}</strong>
        {vista?.descripcion ? <small>{vista.descripcion}</small> : null}
      </span>
      <ArrowUpRight className="fuente-web-flecha" size={15} aria-hidden="true" />
    </a>
  );
}

export default function RespuestaWeb({
  datos,
  renderizarTexto,
}: {
  datos: RespuestaConFuentes;
  renderizarTexto: (texto: string) => ReactNode;
}) {
  const [todas, setTodas] = useState(false);
  const porNumero = new Map(datos.fuentes.map((f) => [f.n, f]));
  const validas = new Set(porNumero.keys());
  const visibles = todas ? datos.fuentes : datos.fuentes.slice(0, VISIBLES);

  const conCitas = (linea: string) =>
    partirCitas(linea, validas).map((t, i) =>
      t.tipo === "texto" ? (
        <Fragment key={`t-${i}`}>{renderizarTexto(t.texto)}</Fragment>
      ) : (
        <Cita key={`c-${i}`} fuente={porNumero.get(t.n) as FuenteWeb} />
      ),
    );

  return (
    <div className="respuesta-web">
      {datos.fecha ? (
        <p className="busqueda-web-encabezado">
          <Search size={13} aria-hidden="true" />
          <span>
            Búsqueda web · {datos.fecha}
            {datos.lugar ? ` · ${datos.lugar}` : ""}
          </span>
        </p>
      ) : null}

      {datos.cuerpo.split("\n").map((linea, i) => {
        const limpio = linea.trim();
        if (!limpio) return <div key={`s-${i}`} className="message-space" />;
        if (/^[-•]\s/.test(limpio)) {
          return (
            <div key={`b-${i}`} className="message-bullet">
              <span className="message-bullet-dot" />
              <span>{conCitas(limpio.replace(/^[-•]\s*/, ""))}</span>
            </div>
          );
        }
        return (
          <p key={`p-${i}`} className="message-paragraph">
            {conCitas(linea)}
          </p>
        );
      })}

      <div className="fuentes-web">
        <p className="fuentes-web-titulo">{datos.soloConsultadas ? "Fuentes consultadas" : "Fuentes"}</p>
        <div className="fuentes-web-lista">
          {visibles.map((f) => (
            <TarjetaFuente key={f.url} fuente={f} />
          ))}
        </div>
        {datos.fuentes.length > VISIBLES ? (
          <button type="button" className="fuentes-web-mas" onClick={() => setTodas((v) => !v)}>
            {todas ? "Ver menos" : `Ver las ${datos.fuentes.length} fuentes`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
