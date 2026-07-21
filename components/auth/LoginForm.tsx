"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

    router.replace("/dashboard");
    router.refresh();
  }

  async function loginGoogle() {
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });

    if (error) {
      setErrorMessage(error.message);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-700 bg-slate-900 p-8 shadow-2xl sm:p-10">
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
          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 p-4 text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
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

        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 p-4 text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
          placeholder="Tu contraseña"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onForgot}
            className="text-sm font-semibold text-blue-400 transition hover:text-blue-300"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-8 w-full rounded-xl bg-blue-600 p-4 font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Ingresando..." : "Iniciar sesión"}
        </button>
      </form>

      <div className="my-8 flex items-center gap-4">
        <div className="h-px flex-1 bg-slate-700" />
        <span className="text-sm text-slate-500">o continuar con</span>
        <div className="h-px flex-1 bg-slate-700" />
      </div>

      <button
        type="button"
        onClick={loginGoogle}
        className="w-full rounded-xl border border-slate-700 p-4 font-semibold transition hover:border-slate-500 hover:bg-slate-800"
      >
        Continuar con Google
      </button>

      <button
        type="button"
        disabled
        className="mt-3 w-full cursor-not-allowed rounded-xl border border-slate-800 p-4 font-semibold text-slate-500"
      >
        Continuar con Apple — próximamente
      </button>

      <div className="mt-8 text-center">
        <span className="text-slate-400">¿No tienes cuenta?</span>

        <button
          type="button"
          onClick={onRegister}
          className="ml-2 font-bold text-blue-400 transition hover:text-blue-300"
        >
          Crear cuenta
        </button>
      </div>
    </div>
  );
}