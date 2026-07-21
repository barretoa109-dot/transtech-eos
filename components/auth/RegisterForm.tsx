"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  onLogin: () => void;
}

export default function RegisterForm({ onLogin }: Props) {
  const supabase = createClient();

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setMensaje("");
    setErrorMessage("");

    const cleanEmail = email.trim().toLowerCase();

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo:
          window.location.origin +
          "/auth/callback?next=/dashboard",
      },
    });

    if (error) {
      setLoading(false);
      setErrorMessage(error.message);
      return;
    }

    if (!data.user) {
      setLoading(false);
      setErrorMessage("No fue posible crear el usuario.");
      return;
    }

    const { error: insertError } = await supabase
      .from("usuarios")
      .upsert({
        id: data.user.id,
        nombre,
        email: cleanEmail,
        whatsapp,
        plan: "free",
      });

    setLoading(false);

    if (insertError) {
      setErrorMessage(insertError.message);
      return;
    }

    setMensaje(
      "Cuenta creada correctamente. Revisa tu correo electrónico para confirmar tu cuenta antes de iniciar sesión."
    );

    setNombre("");
    setEmail("");
    setWhatsapp("");
    setPassword("");
  }

  return (
    <div className="rounded-3xl border border-slate-700 bg-slate-900 p-10 shadow-2xl">

      <h2 className="text-4xl font-black">
        Crear cuenta
      </h2>

      <p className="mt-3 text-slate-400">
        Crea tu cuenta para comenzar a utilizar EOS.
      </p>

      <form onSubmit={register}>

        <input
          className="mt-8 w-full rounded-xl bg-slate-800 p-4"
          placeholder="Nombre completo"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
        />

        <input
          type="email"
          className="mt-4 w-full rounded-xl bg-slate-800 p-4"
          placeholder="Correo electrónico"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <input
          className="mt-4 w-full rounded-xl bg-slate-800 p-4"
          placeholder="WhatsApp"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
        />

        <input
          type="password"
          className="mt-4 w-full rounded-xl bg-slate-800 p-4"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {errorMessage && (
          <div className="mt-4 rounded-xl bg-red-500/20 p-4 text-red-300">
            {errorMessage}
          </div>
        )}

        {mensaje && (
          <div className="mt-4 rounded-xl bg-green-500/20 p-4 text-green-300">
            {mensaje}
          </div>
        )}

        <button
          disabled={loading}
          className="mt-8 w-full rounded-xl bg-blue-600 p-4 font-bold"
        >
          {loading ? "Creando cuenta..." : "Crear cuenta"}
        </button>

      </form>

      <div className="mt-8 text-center">

        <span className="text-slate-400">
          ¿Ya tienes una cuenta?
        </span>

        <button
          onClick={onLogin}
          className="ml-2 font-bold text-blue-400"
        >
          Iniciar sesión
        </button>

      </div>

    </div>
  );
}