import { testimoniosPublicables } from "@/lib/testimonios";

/**
 * Lo que dicen clientes reales (ver `lib/testimonios.ts`).
 *
 * Sin testimonios publicables no se dibuja nada: ni el título ni un espacio
 * vacío. Va en páginas claras (portada y /planes), por eso los colores son
 * los de esas páginas y no tokens del modo oscuro.
 */
export default function Testimonios({ titulo = "Lo que dicen quienes ya lo usan" }: { titulo?: string }) {
  const lista = testimoniosPublicables();
  if (lista.length === 0) return null;

  return (
    <section className="testimonios" aria-labelledby="testimonios-titulo">
      <h2 id="testimonios-titulo">{titulo}</h2>
      <div className="testimonios-lista">
        {lista.map((t) => (
          <figure key={`${t.nombre}-${t.rubro}`}>
            <blockquote>«{t.frase}»</blockquote>
            <figcaption>
              <strong>{t.nombre}</strong>
              <span>
                {t.rubro} · {t.ciudad}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      <style jsx>{`
        .testimonios {
          margin: 0 auto 40px;
          max-width: 1080px;
        }
        h2 {
          margin: 0 0 16px;
          font-size: 22px;
          font-weight: 800;
          text-align: center;
          color: #07132a;
        }
        .testimonios-lista {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 14px;
        }
        figure {
          margin: 0;
          padding: 18px 20px;
          border: 1px solid #e5e9f0;
          border-radius: 16px;
          background: #ffffff;
          display: grid;
          gap: 12px;
        }
        blockquote {
          margin: 0;
          font-size: 14.5px;
          line-height: 1.55;
          color: #07132a;
        }
        figcaption {
          display: grid;
          gap: 2px;
          font-size: 12.5px;
          color: #6b7280;
        }
        figcaption strong {
          color: #07132a;
          font-size: 13px;
        }
      `}</style>
    </section>
  );
}
