"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isPasswordPwned } from "@/lib/pwnedPassword";
import CampoContrasena from "./CampoContrasena";

interface Props {
  onLogin: () => void;
}

function obtenerMensajeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "No se pudo crear la cuenta. Revisa los datos e intenta nuevamente.";
}

export default function RegisterForm({ onLogin }: Props) {
  const supabase = createClient();

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanName = nombre.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanWhatsapp = whatsapp.trim();

    setErrorMessage("");
    setSuccessMessage("");

    if (!cleanName || !cleanEmail || !password) {
      setErrorMessage("Completa nombre, correo y contraseña.");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    setLoading(true);

    try {
      if (await isPasswordPwned(password)) {
        setErrorMessage(
          "Esta contraseña apareció en filtraciones de datos conocidas. Elegí otra para proteger tu cuenta."
        );
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/eos/chat`,
          data: {
            nombre: cleanName,
            whatsapp: cleanWhatsapp,
            plan: "free",
          },
        },
      });

      if (error) {
        throw error;
      }

      if (!data.user) {
        throw new Error("Supabase no devolvió el usuario creado.");
      }

      // Si la confirmación de correo está desactivada,
      // ya existe sesión y podemos guardar el perfil inmediatamente.
      if (data.session) {
        const { error: profileError } = await supabase
          .from("usuarios")
          .upsert(
            {
              id: data.user.id,
              nombre: cleanName,
              email: cleanEmail,
              whatsapp: cleanWhatsapp || null,
              plan: "free",
            },
            {
              onConflict: "id",
            }
          );

        if (profileError) {
          throw profileError;
        }

        window.location.assign("/eos/chat");
        return;
      }

      setSuccessMessage(
        "Cuenta creada. Revisa tu correo y confirma tu cuenta para ingresar a EOS."
      );

      setNombre("");
      setEmail("");
      setWhatsapp("");
      setPassword("");
    } catch (error) {
      console.error("Error de registro:", error);
      setErrorMessage(obtenerMensajeError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-[#060c1c]/90 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
      <h2 className="text-4xl font-black">Crear cuenta</h2>

      <p className="mt-3 text-slate-400">
        Crea tu cuenta para comenzar a utilizar EOS.
      </p>

      <form onSubmit={register}>
        <input
          type="text"
          autoComplete="name"
          required
          className="mt-8 w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white outline-none transition focus:border-[#2f72d6] focus:bg-white/[0.05]"
          placeholder="Nombre completo"
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
        />

        <input
          type="email"
          autoComplete="email"
          required
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white outline-none transition focus:border-[#2f72d6] focus:bg-white/[0.05]"
          placeholder="Correo electrónico"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <input
          type="tel"
          autoComplete="tel"
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white outline-none transition focus:border-[#2f72d6] focus:bg-white/[0.05]"
          placeholder="WhatsApp (opcional)"
          value={whatsapp}
          onChange={(event) => setWhatsapp(event.target.value)}
        />

        <CampoContrasena
          autoComplete="new-password"
          required
          minLength={6}
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white outline-none transition focus:border-[#2f72d6] focus:bg-white/[0.05]"
          placeholder="Contraseña"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {errorMessage && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-300">
            {successMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-8 w-full rounded-xl bg-gradient-to-br from-[#2f72d6] to-[#113f8c] p-4 font-bold text-white shadow-[0_8px_22px_rgba(22,86,189,.35)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {loading ? "Creando cuenta..." : "Crear cuenta"}
        </button>
      </form>

      <div className="mt-8 text-center">
        <span className="text-slate-400">¿Ya tienes una cuenta?</span>

        <button
          type="button"
          onClick={onLogin}
          className="ml-2 font-bold text-[#6fa3e8] transition hover:text-[#a9c6ee]"
        >
          Iniciar sesión
        </button>
      </div>
    </div>
  );
}