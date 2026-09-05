"use client";

import Image from "next/image";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import ForgotPassword from "@/components/auth/ForgotPassword";
import AmbientBackground from "@/components/effects/AmbientBackground";
import AnimatedTitle from "@/components/effects/AnimatedTitle";
import { loginTechCanvas } from "@/components/effects/techCanvasPresets";

type Screen = "login" | "register" | "forgot";

/*
 * Por qué alguien vuelve a esta pantalla sin haberlo pedido.
 *
 * `/auth/callback` redirige acá con `?error=...` cuando un enlace de
 * confirmación o de recuperación ya venció o ya se usó — y hasta ahora esa
 * información se descartaba: la persona veía el formulario de login pelado,
 * sin ninguna pista de qué pasó con el enlace que acababa de abrir.
 *
 * El middleware hace lo mismo sin `error`, sólo con `next`, cuando alguien
 * sin sesión —o con la sesión vencida— entra a una ruta protegida. Ahí no se
 * puede decir "tu sesión venció" con certeza: puede ser la primera visita.
 * Por eso ese caso lleva un aviso neutro, no una acusación de expiración que
 * podría ser falsa.
 */
function avisoPorParametros(searchParams: URLSearchParams): string {
  const error = searchParams.get("error");

  if (error === "sesion_no_valida") {
    return "Ese enlace ya venció o ya se usó. Pedí uno nuevo para continuar.";
  }

  if (error === "callback_sin_codigo" || error === "usuario_no_encontrado") {
    return "No pudimos validar ese enlace. Pedí uno nuevo para continuar.";
  }

  if (searchParams.get("next")) {
    return "Iniciá sesión para continuar.";
  }

  return "";
}

function LoginPageContenido() {
  const [screen, setScreen] = useState<Screen>("login");
  const searchParams = useSearchParams();
  const aviso = avisoPorParametros(searchParams);

  return (
    <main
      data-eos-theme="dark"
      className="login-page relative min-h-screen overflow-hidden bg-[#020817] text-white"
      style={{ fontFamily: "var(--font-inter)" }}
    >
      <AmbientBackground techConfig={loginTechCanvas} spanCount={2} />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        {/* Presentación */}
        <section className="relative hidden border-r border-white/10 px-16 py-14 lg:flex lg:flex-col xl:px-24">
          <div className="brand-rise flex items-center">
            <div className="relative h-20 w-64">
              <Image
                src="/transtech-logo.png"
                alt="Logo oficial de TRANSTECH"
                fill
                priority
                sizes="256px"
                className="object-contain object-left"
              />
            </div>
          </div>

          <div className="flex flex-1 items-center">
            <div className="max-w-2xl">
              <div className="eyebrow-rise inline-flex items-center gap-3 rounded-full border border-[#6fa3e8]/20 bg-[#2f72d6]/10 px-5 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#4ade80] shadow-[0_0_14px_rgba(74,222,128,.95)]" />
                <span className="text-sm font-bold text-[#6fa3e8]">Inteligencia para personas y empresas</span>
              </div>

              <h1 className="login-title mt-9 text-6xl font-black leading-[1.02] tracking-[-0.045em] xl:text-7xl">
                <AnimatedTitle
                  text="Todo lo que querés lograr, mejor organizado con EOS."
                  accentWords={["mejor", "organizado"]}
                  step={0.045}
                />
              </h1>

              <p className="sub-rise mt-8 max-w-xl text-lg leading-8 text-slate-400">
                Organizá tus ideas, proyectos, tareas, documentos, objetivos y procesos en un sistema inteligente que
                entiende tu contexto y te ayuda a avanzar.
              </p>

              <div className="feat-rise mt-12 grid max-w-xl grid-cols-2 gap-4">
                <Feature numero="01" titulo="Te conoce" texto="Recuerda tu contexto, proyectos y prioridades." />
                <Feature numero="02" titulo="Te organiza" texto="Convierte ideas en objetivos y acciones claras." />
                <Feature numero="03" titulo="Crea contigo" texto="Genera archivos, análisis, planes y herramientas." />
                <Feature numero="04" titulo="Te acompaña" texto="Da seguimiento a tu progreso y próximos pasos." />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-6 text-xs text-slate-400">
            <span>TRANSTECH E.A.S.</span>
            <span>Personas · Profesionales · Empresas</span>
          </div>
        </section>

        {/* Autenticación */}
        <section className="relative flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-14">
          <div className="w-full max-w-[500px]">
            {/* Logo en celular */}
            <div className="mb-10 lg:hidden">
              <div className="relative h-20 w-60">
                <Image
                  src="/transtech-logo.png"
                  alt="Logo oficial de TRANSTECH"
                  fill
                  priority
                  sizes="240px"
                  className="object-contain object-left"
                />
              </div>

              <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
                Tecnología inteligente para organizar, crear y avanzar.
              </p>
            </div>

            {aviso && screen === "login" && (
              <div className="mb-5 rounded-xl border border-[#6fa3e8]/30 bg-[#2f72d6]/10 p-4 text-sm leading-6 text-[#a9c6ee]">
                {aviso}
              </div>
            )}

            <div className="panel-rise relative">
              <div className="pointer-events-none absolute -inset-px rounded-[32px] bg-gradient-to-br from-[#2f72d6]/50 via-white/5 to-[#6fa3e8]/30" />

              <div className="relative rounded-[32px] border border-white/10 bg-[#071126]/95 p-1 shadow-[0_30px_100px_rgba(0,0,0,.6)] backdrop-blur-xl">
                {screen === "login" && (
                  <LoginForm onRegister={() => setScreen("register")} onForgot={() => setScreen("forgot")} />
                )}

                {screen === "register" && <RegisterForm onLogin={() => setScreen("login")} />}

                {screen === "forgot" && <ForgotPassword onBack={() => setScreen("login")} />}
              </div>
            </div>

            <p className="mt-7 text-center text-xs leading-5 text-slate-400">
              Al continuar, aceptás los{" "}
              <a href="/terminos" className="underline" target="_blank" rel="noopener noreferrer">
                términos de servicio
              </a>{" "}
              y la{" "}
              <a href="/privacidad" className="underline" target="_blank" rel="noopener noreferrer">
                política de privacidad
              </a>{" "}
              de TRANSTECH EOS.
            </p>
          </div>
        </section>
      </div>

      <style jsx>{`
        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .brand-rise {
          opacity: 0;
          animation: rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.05s forwards;
        }
        .eyebrow-rise {
          opacity: 0;
          animation: rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.15s forwards;
        }
        .sub-rise {
          opacity: 0;
          animation: rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.85s forwards;
        }
        .feat-rise {
          opacity: 0;
          animation: rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) 1s forwards;
        }
        .panel-rise {
          opacity: 0;
          animation: rise 0.8s cubic-bezier(0.22, 1, 0.36, 1) 1.1s forwards;
        }
        .login-title {
          perspective: 1000px;
        }
        .login-title :global(.word) {
          display: inline-block;
          opacity: 0;
          transform: translateY(28px) rotateX(-60deg);
          transform-origin: 50% 100%;
          animation: wordIn 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        @keyframes wordIn {
          to {
            opacity: 1;
            transform: translateY(0) rotateX(0);
          }
        }
        .login-title :global(.accent) {
          background: linear-gradient(90deg, #6fa3e8, #38bdf8 55%, #7dd3fc);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          background-size: 200% auto;
          animation-name: wordIn, sheen;
          animation-duration: 0.7s, 6s;
          animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1), linear;
          animation-iteration-count: 1, infinite;
          animation-delay: inherit, 1.4s;
          animation-fill-mode: forwards, none;
        }
        @keyframes sheen {
          to {
            background-position: 200% center;
          }
        }
      `}</style>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContenido />
    </Suspense>
  );
}

function Feature({ numero, titulo, texto }: { numero: string; titulo: string; texto: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur transition hover:border-[#6fa3e8]/30 hover:bg-[#2f72d6]/[0.06]">
      <div className="flex items-center gap-3">
        <span className="text-xs font-black tracking-widest text-[#6fa3e8]">{numero}</span>
        <div className="h-px flex-1 bg-gradient-to-r from-[#2f72d6]/50 to-transparent" />
      </div>
      <h2 className="mt-4 font-bold text-white">{titulo}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">{texto}</p>
    </div>
  );
}
