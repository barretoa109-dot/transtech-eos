"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { destinoPedido } from "@/lib/auth/destino";
import CampoContrasena from "./CampoContrasena";
import {
  NOMBRE_PROVEEDOR,
  proveedoresHabilitados,
  type Proveedor,
} from "@/lib/auth/proveedores";

interface Props {
  onRegister: () => void;
  onForgot: () => void;
}

export default function LoginForm({
  onRegister,
  onForgot,
}: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  /*
   * Los botones de Google y Apple aparecen solos cuando el proveedor está
   * configurado en Supabase. Ver `lib/auth/proveedores.ts`: mostrar un botón
   * que todavía no tiene credenciales termina en un error del que nadie vuelve.
   */
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);

  useEffect(() => {
    let vigente = true;

    proveedoresHabilitados().then((lista) => {
      if (vigente) setProveedores(lista);
    });

    return () => {
      vigente = false;
    };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanEmail = email.trim().toLowerCase();

    setErrorMessage("");

    if (!cleanEmail || !password) {
      setErrorMessage("Completa el correo y la contraseña.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      setLoading(false);

      if (error.message.toLowerCase().includes("invalid login")) {
        setErrorMessage("Correo o contraseña incorrectos.");
        return;
      }

      if (error.message.toLowerCase().includes("email not confirmed")) {
        setErrorMessage(
          "Debes confirmar tu correo electrónico antes de ingresar."
        );
        return;
      }

      setErrorMessage(error.message);
      return;
    }

    /*
     * Al destino pedido, no siempre al chat. Quien llega acá desde el aviso
     * de una renovación caída viene a pagar: dejarlo en el chat es hacerle
     * buscar de nuevo la pantalla que le habíamos puesto en la mano.
     */
    router.replace(destinoPedido());
    router.refresh();
  }

  async function entrarCon(proveedor: Proveedor) {
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: proveedor,
      options: {
        /*
         * Al destino pedido, igual que con contraseña: quien venía a pagar
         * tiene que volver al checkout y no al chat.
         */
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          destinoPedido(),
        )}`,
      },
    });

    if (error) {
      setErrorMessage(
        error.message.includes("not enabled")
          ? `Entrar con ${NOMBRE_PROVEEDOR[proveedor]} todavía no está disponible.`
          : error.message,
      );
    }
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-[#060c1c]/90 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
      <h2 className="text-4xl font-black">Iniciar sesión</h2>

      <p className="mt-3 text-slate-400">
        Accede a tu cuenta TransTech EOS.
      </p>

      <form onSubmit={login}>
        <label
          htmlFor="login-email"
          className="mt-8 block text-sm font-semibold text-slate-200"
        >
          Correo electrónico
        </label>

        <input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white outline-none transition placeholder:text-slate-500 focus:border-[#2f72d6] focus:bg-white/[0.05]"
          placeholder="nombre@empresa.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label
          htmlFor="login-password"
          className="mt-5 block text-sm font-semibold text-slate-200"
        >
          Contraseña
        </label>

        <CampoContrasena
          id="login-password"
          autoComplete="current-password"
          required
          className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white outline-none transition placeholder:text-slate-500 focus:border-[#2f72d6] focus:bg-white/[0.05]"
          placeholder="Tu contraseña"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onForgot}
            className="text-sm font-semibold text-[#6fa3e8] transition hover:text-[#a9c6ee]"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
          >
            {errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-8 w-full rounded-xl bg-gradient-to-br from-[#2f72d6] to-[#113f8c] p-4 font-bold text-white shadow-[0_8px_22px_rgba(22,86,189,.35)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {loading ? "Ingresando..." : "Iniciar sesión"}
        </button>
      </form>

      {/*
        Sin proveedores configurados no se dibuja ni el separador: una sección
        "o continuar con" vacía, o llena de botones apagados que prometen algo
        para más adelante, sólo ocupa lugar en la pantalla donde la gente
        quiere entrar.
      */}
      {proveedores.length > 0 && (
        <>
          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1 bg-slate-700" />
            <span className="text-sm text-slate-400">o continuar con</span>
            <div className="h-px flex-1 bg-slate-700" />
          </div>

          {proveedores.map((proveedor, i) => (
            <button
              key={proveedor}
              type="button"
              onClick={() => entrarCon(proveedor)}
              className={`${i > 0 ? "mt-3 " : ""}w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 font-semibold text-white transition hover:border-[#2f72d6] hover:bg-white/[0.06]`}
            >
              Continuar con {NOMBRE_PROVEEDOR[proveedor]}
            </button>
          ))}
        </>
      )}

      <div className="mt-8 text-center">
        <span className="text-slate-400">¿No tienes cuenta?</span>

        <button
          type="button"
          onClick={onRegister}
          className="ml-2 font-bold text-[#6fa3e8] transition hover:text-[#a9c6ee]"
        >
          Crear cuenta
        </button>
      </div>
    </div>
  );
}