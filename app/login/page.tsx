"use client";

import Image from "next/image";
import { useState } from "react";

import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import ForgotPassword from "@/components/auth/ForgotPassword";
import AmbientBackground from "@/components/effects/AmbientBackground";

type Screen = "login" | "register" | "forgot";

export default function LoginPage() {
  const [screen, setScreen] = useState<Screen>("login");

  return (
    <main
      data-eos-theme="dark"
      className="relative min-h-screen overflow-hidden bg-[#020817] text-white"
      style={{ fontFamily: "var(--font-inter)" }}
    >
      <AmbientBackground spanCount={2} />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        {/* Presentación */}
        <section className="relative hidden border-r border-white/10 px-16 py-14 lg:flex lg:flex-col xl:px-24">
          <div className="flex items-center">
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
              <div className="inline-flex items-center gap-3 rounded-full border border-[#6fa3e8]/20 bg-[#2f72d6]/10 px-5 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#4ade80] shadow-[0_0_14px_rgba(74,222,128,.95)]" />

                <span className="text-sm font-bold text-[#6fa3e8]">
                  Inteligencia para personas y empresas
                </span>
              </div>

              <h1 className="mt-9 text-6xl font-black leading-[1.02] tracking-[-0.045em] xl:text-7xl">
                Todo lo que querés lograr,
                <span className="mt-2 block bg-gradient-to-r from-[#6fa3e8] via-[#38bdf8] to-[#7dd3fc] bg-clip-text text-transparent">
                  mejor organizado con EOS.
                </span>
              </h1>

              <p className="mt-8 max-w-xl text-lg leading-8 text-slate-400">
                Organizá tus ideas, proyectos, tareas, documentos, objetivos y
                procesos en un sistema inteligente que entiende tu contexto y
                te ayuda a avanzar.
              </p>

              <div className="mt-12 grid max-w-xl grid-cols-2 gap-4">
                <Feature
                  numero="01"
                  titulo="Te conoce"
                  texto="Recuerda tu contexto, proyectos y prioridades."
                />

                <Feature
                  numero="02"
                  titulo="Te organiza"
                  texto="Convierte ideas en objetivos y acciones claras."
                />

                <Feature
                  numero="03"
                  titulo="Crea contigo"
                  texto="Genera archivos, análisis, planes y herramientas."
                />

                <Feature
                  numero="04"
                  titulo="Te acompaña"
                  texto="Da seguimiento a tu progreso y próximos pasos."
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-6 text-xs text-slate-500">
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

            <div className="relative">
              <div className="pointer-events-none absolute -inset-px rounded-[32px] bg-gradient-to-br from-[#2f72d6]/50 via-white/5 to-[#6fa3e8]/30" />

              <div className="relative rounded-[32px] border border-white/10 bg-[#071126]/95 p-1 shadow-[0_30px_100px_rgba(0,0,0,.6)] backdrop-blur-xl">
                {screen === "login" && (
                  <LoginForm
                    onRegister={() => setScreen("register")}
                    onForgot={() => setScreen("forgot")}
                  />
                )}

                {screen === "register" && (
                  <RegisterForm onLogin={() => setScreen("login")} />
                )}

                {screen === "forgot" && (
                  <ForgotPassword onBack={() => setScreen("login")} />
                )}
              </div>
            </div>

            <p className="mt-7 text-center text-xs leading-5 text-slate-600">
              Al continuar, aceptás los términos de servicio y la política de
              privacidad de TRANSTECH EOS.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Feature({
  numero,
  titulo,
  texto,
}: {
  numero: string;
  titulo: string;
  texto: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur transition hover:border-[#6fa3e8]/30 hover:bg-[#2f72d6]/[0.06]">
      <div className="flex items-center gap-3">
        <span className="text-xs font-black tracking-widest text-[#6fa3e8]">
          {numero}
        </span>

        <div className="h-px flex-1 bg-gradient-to-r from-[#2f72d6]/50 to-transparent" />
      </div>

      <h2 className="mt-4 font-bold text-white">{titulo}</h2>

      <p className="mt-2 text-sm leading-6 text-slate-500">{texto}</p>
    </div>
  );
}