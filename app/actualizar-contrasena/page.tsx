"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function ActualizarContrasenaPage() {
  const supabase = createClient();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");

  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");

  async function actualizar(e: FormEvent) {
    e.preventDefault();

    setMensaje("");
    setError("");

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (password !== confirmar) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMensaje("Contraseña actualizada correctamente.");

    setTimeout(() => {
      router.replace("/login");
    }, 1500);
  }

  return (
    <main className="min-h-screen bg-[#040816] flex items-center justify-center p-6">

      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-700 p-10">

        <h1 className="text-4xl font-black text-white">
          Nueva contraseña
        </h1>

        <p className="mt-3 text-slate-400">
          Ingresa una nueva contraseña para tu cuenta.
        </p>

        <form onSubmit={actualizar}>

          <input
            type="password"
            placeholder="Nueva contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-8 w-full rounded-xl bg-slate-800 p-4 text-white"
          />

          <input
            type="password"
            placeholder="Confirmar contraseña"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            className="mt-4 w-full rounded-xl bg-slate-800 p-4 text-white"
          />

          {error && (
            <div className="mt-4 rounded-xl bg-red-500/20 p-4 text-red-300">
              {error}
            </div>
          )}

          {mensaje && (
            <div className="mt-4 rounded-xl bg-green-500/20 p-4 text-green-300">
              {mensaje}
            </div>
          )}

          <button
            disabled={loading}
            className="mt-8 w-full rounded-xl bg-blue-600 p-4 font-bold text-white"
          >
            {loading
              ? "Actualizando..."
              : "Actualizar contraseña"}
          </button>

        </form>

      </div>

    </main>
  );
}