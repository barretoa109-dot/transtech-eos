"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  onBack: () => void;
}

export default function ForgotPassword({ onBack }: Props) {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function recoverPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setErrorMessage("Ingresa tu correo electrónico.");
      return;
    }

    setLoading(true);
    setMessage("");
    setErrorMessage("");

    const redirectTo = `${window.location.origin}/actualizar-contrasena`;

    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo,
    });

    setLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage(
      "Te enviamos un enlace para restablecer tu contraseña. Revisa también la carpeta de spam."
    );
  }

  return (
    <div className="rounded-3xl border border-slate-700 bg-slate-900 p-10 shadow-2xl">
      <button
        type="button"
        onClick={onBack}
        className="mb-8 text-sm font-semibold text-blue-400 transition hover:text-blue-300"
      >
        ← Volver al inicio de sesión
      </button>

      <h2 className="text-4xl font-black">Recuperar contraseña</h2>

      <p className="mt-3 leading-7 text-slate-400">
        Ingresa tu correo y te enviaremos un enlace para crear una nueva
        contraseña.
      </p>

      <form onSubmit={recoverPassword}>
        <label
          htmlFor="recovery-email"
          className="mt-8 block text-sm font-semibold text-slate-200"
        >
          Correo electrónico
        </label>

        <input
          id="recovery-email"
          type="email"
          autoComplete="email"
          required
          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 p-4 text-white outline-none transition placeholder:text-slate-500 focus:border-blue-500"
          placeholder="nombre@empresa.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        {errorMessage && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        {message && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-300">
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-8 w-full rounded-xl bg-blue-600 p-4 font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Enviando enlace..." : "Enviar enlace de recuperación"}
        </button>
      </form>
    </div>
  );
}