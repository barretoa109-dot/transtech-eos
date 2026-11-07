"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useEsAppNativa } from "@/lib/app-nativa/cliente";

/**
 * Puente visual entre el splash nativo (una sola imagen fija, generada desde
 * `assets/splash.png`) y el chat: apenas abre la app, esta pantalla repite el
 * mismo isotipo con una animación y después se desvanece. En la web no se
 * monta nunca (`useEsAppNativa` da `false` ahí).
 */
const DURACION_VISIBLE_MS = 1700;
const DURACION_SALIDA_MS = 450;

export default function SplashAnimado() {
  const appNativa = useEsAppNativa();
  const [fase, setFase] = useState<"visible" | "saliendo" | "listo">("visible");

  useEffect(() => {
    if (!appNativa) return;
    const salir = setTimeout(() => setFase("saliendo"), DURACION_VISIBLE_MS);
    const cerrar = setTimeout(
      () => setFase("listo"),
      DURACION_VISIBLE_MS + DURACION_SALIDA_MS,
    );
    return () => {
      clearTimeout(salir);
      clearTimeout(cerrar);
    };
  }, [appNativa]);

  if (!appNativa || fase === "listo") return null;

  return (
    <div
      className="overlay fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ opacity: fase === "saliendo" ? 0 : 1, transition: `opacity ${DURACION_SALIDA_MS}ms ease` }}
      aria-hidden="true"
    >
      <div className="logo-stage relative w-[42vw] max-w-[260px]">
        <Image
          src="/icon-512.png"
          alt=""
          width={512}
          height={512}
          priority
          className="logo-img block w-full h-auto"
        />
      </div>
      <div className="mt-[6vh] flex flex-col items-center gap-1 text-center">
        <span className="linea-powered text-[11px] font-semibold tracking-[0.14em] uppercase">
          Powered by
        </span>
        <span className="texto-marca text-[15px] font-semibold tracking-[0.015em]">
          TransTech E.A.S.
        </span>
      </div>

      <style jsx>{`
        .overlay {
          background: #ffffff;
        }
        .linea-powered {
          color: #8792ab;
        }
        .texto-marca {
          color: #2546a8;
        }
        @media (prefers-color-scheme: dark) {
          .overlay {
            background: #0a1330;
          }
          .linea-powered {
            color: #5f6c92;
          }
          .texto-marca {
            color: #8fa8ff;
          }
        }
        .logo-img {
          filter: drop-shadow(0 18px 26px rgba(20, 40, 110, 0.3));
          animation: logoIn 1.1s cubic-bezier(0.2, 0.9, 0.25, 1) both;
        }
        .linea-powered {
          display: inline-block;
          animation: fadeUp 0.6s ease 0.95s both;
        }
        .texto-marca {
          display: inline-block;
          animation: fadeUp 0.6s cubic-bezier(0.2, 0.8, 0.3, 1) 1.1s both;
        }
        @keyframes logoIn {
          0% {
            transform: translateY(14px) rotateX(55deg) rotateZ(-8deg) scale(0.6);
            opacity: 0;
          }
          55% {
            transform: translateY(-3px) rotateX(-8deg) rotateZ(2deg) scale(1.06);
            opacity: 1;
          }
          75% {
            transform: translateY(0) rotateX(6deg) rotateZ(-1deg) scale(0.99);
          }
          100% {
            transform: translateY(0) rotateX(0deg) rotateZ(0deg) scale(1);
          }
        }
        @keyframes fadeUp {
          0% {
            transform: translateY(8px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .logo-img,
          .linea-powered,
          .texto-marca {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}
