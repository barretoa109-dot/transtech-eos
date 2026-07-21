"use client";

import { useState } from "react";
import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import ForgotPassword from "@/components/auth/ForgotPassword";

type Screen = "login" | "register" | "forgot";

export default function LoginPage() {
  const [screen, setScreen] = useState<Screen>("login");

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#020817] text-white">
      {/* Fondos luminosos */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-blue-600/20 blur-[150px]" />
      <div className="pointer-events-none absolute -bottom-48 right-0 h-[580px] w-[580px] rounded-full bg-cyan-500/10 blur-[170px]" />

      {/* Cuadrícula tecnológica */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(59,130,246,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,.5) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
        }}
      />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        {/* Panel izquierdo */}
        <section className="relative hidden overflow-hidden border-r border-white/10 lg:flex lg:flex-col lg:justify-between lg:px-16 lg:py-14 xl:px-24">
          <div>
            <div className="flex items-center gap-4">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-600/15 shadow-[0_0_40px_rgba(37,99,235,.25)]">
                <div className="h-6 w-6 rotate-45 rounded-md border-2 border-cyan-300" />
                <div className="absolute h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_18px_rgba(96,165,250,.9)]" />
              </div>

              <div>
                <h1 className="text-2xl font-black tracking-tight">
                  TRANSTECH
                </h1>

                <p className="text-sm font-semibold tracking-[0.2em] text-blue-400">
                  INTELLIGENT TECHNOLOGY
                </p>
              </div>
            </div>

            <div className="mt-28 max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-300">
                <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,.9)]" />
                Sistema operativo empresarial inteligente
              </div>

              <h2 className="mt-8 text-6xl font-black leading-[1.04] tracking-tight xl:text-7xl">
                Dirigí tu empresa
                <span className="block bg-gradient-to-r from-blue-400 via-cyan-300 to-blue-500 bg-clip-text text-transparent">
                  con EOS.
                </span>
              </h2>

              <p className="mt-7 max-w-xl text-lg leading-8 text-slate-400">
                Centralizá decisiones, objetivos, documentos, automatizaciones
                y seguimiento en un solo sistema impulsado por inteligencia
                artificial.
              </p>

              <div className="mt-12 grid max-w-xl grid-cols-2 gap-4">
                <Feature
                  numero="01"
                  titulo="Memoria persistente"
                  texto="EOS mantiene el contexto de tu empresa."
                />

                <Feature
                  numero="02"
                  titulo="Gestión ejecutiva"
                  texto="Objetivos, tareas y seguimiento inteligente."
                />

                <Feature
                  numero="03"
                  titulo="Automatización"
                  texto="Procesos y documentos generados por EOS."
                />

                <Feature
                  numero="04"
                  titulo="Decisiones claras"
                  texto="Información útil para avanzar mejor."
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-6 text-xs text-slate-500">
            <span>TransTech E.A.S.</span>
            <span>Enterprise Operating System</span>
          </div>
        </section>

        {/* Panel derecho */}
        <section className="relative flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-14">
          <div className="w-full max-w-[500px]">
            {/* Logo móvil */}
            <div className="mb-9 flex items-center gap-3 lg:hidden">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-600/15">
                <div className="h-5 w-5 rotate-45 rounded border-2 border-cyan-300" />
                <div className="absolute h-2 w-2 rounded-full bg-blue-400" />
              </div>

              <div>
                <p className="font-black tracking-wide">TRANSTECH</p>
                <p className="text-xs font-semibold tracking-[0.15em] text-blue-400">
                  INTELLIGENT TECHNOLOGY
                </p>
              </div>
            </div>

            <div className="relative">
              <div className="pointer-events-none absolute -inset-px rounded-[30px] bg-gradient-to-br from-blue-500/40 via-white/5 to-cyan-400/20" />

              <div className="relative rounded-[30px] border border-white/10 bg-[#071126]/95 p-1 shadow-[0_30px_100px_rgba(0,0,0,.55)] backdrop-blur-xl">
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
                  <ForgotPassword onLogin={() => setScreen("login")} />
                )}
              </div>
            </div>

            <p className="mt-7 text-center text-xs leading-5 text-slate-600">
              Al continuar, aceptás los términos de servicio y la política de
              privacidad de TransTech EOS.
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="text-xs font-black tracking-widest text-blue-400">
          {numero}
        </span>

        <div className="h-px flex-1 bg-gradient-to-r from-blue-500/50 to-transparent" />
      </div>

      <h3 className="mt-4 font-bold text-white">{titulo}</h3>

      <p className="mt-2 text-sm leading-6 text-slate-500">{texto}</p>
    </div>
  );
}