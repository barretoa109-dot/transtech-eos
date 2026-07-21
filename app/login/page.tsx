"use client";

import { useState } from "react";
import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import ForgotPassword from "@/components/auth/ForgotPassword";

export default function LoginPage() {
  const [screen, setScreen] = useState<
    "login" | "register" | "forgot"
  >("login");

  return (
    <main className="min-h-screen bg-[#040816] text-white">

      <div className="grid min-h-screen lg:grid-cols-2">

        {/* Lado izquierdo */}

        <div className="hidden lg:flex flex-col justify-center bg-gradient-to-br from-[#071226] to-[#0E1F44] px-20">

          <p className="text-5xl font-black tracking-tight">
            TRANSTECH
          </p>

          <p className="mt-3 text-blue-400 font-bold">
            Intelligent Technology
          </p>

          <h1 className="mt-16 text-6xl font-black leading-tight">
            Bienvenido
            <br />
            a EOS
          </h1>

          <p className="mt-8 max-w-xl text-lg text-slate-300 leading-8">
            Tu sistema operativo ejecutivo impulsado por Inteligencia
            Artificial.
          </p>

          <div className="mt-14 space-y-5">

            <Item texto="Conversaciones inteligentes" />
            <Item texto="Memoria persistente" />
            <Item texto="Dashboard ejecutivo" />
            <Item texto="Automatizaciones" />
            <Item texto="Documentos automáticos" />
            <Item texto="Seguimiento de objetivos" />

          </div>

        </div>

        {/* Lado derecho */}

        <div className="flex items-center justify-center p-8">

          <div className="w-full max-w-md">

            {screen === "login" && (
              <LoginForm
                onRegister={() => setScreen("register")}
                onForgot={() => setScreen("forgot")}
              />
            )}

            {screen === "register" && (
              <RegisterForm
                onLogin={() => setScreen("login")}
              />
            )}

            {screen === "forgot" && (
              <ForgotPassword
                onBack={() => setScreen("login")}
              />
            )}

          </div>

        </div>

      </div>

    </main>
  );
}

function Item({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-4">

      <div className="h-3 w-3 rounded-full bg-blue-500" />

      <p className="text-lg text-slate-200">
        {texto}
      </p>

    </div>
  );
}