"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [loading, setLoading] = useState(false);

  async function ingresar() {
    if (!nombre.trim() || !whatsapp.trim()) {
      alert("Completá todos los campos.");
      return;
    }

    setLoading(true);

    try {
      let { data: usuario } = await supabase
        .from("usuarios")
        .select("*")
        .eq("whatsapp", whatsapp)
        .maybeSingle();

      if (!usuario) {
        const { data, error } = await supabase
          .from("usuarios")
          .insert({
            nombre,
            whatsapp,
            plan: "free",
          })
          .select()
          .single();

        if (error) throw error;

        usuario = data;
      }

      localStorage.setItem("usuario_uuid", usuario.id);
      localStorage.setItem("usuario_nombre", usuario.nombre);
      localStorage.setItem("usuario_plan", usuario.plan ?? "free");

      router.replace("/dashboard");

    } catch (e) {
      console.error(e);
      alert("Error al ingresar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-700 p-8">

        <h1 className="text-3xl font-black text-white mb-8">
          Ingresar a EOS
        </h1>

        <input
          className="w-full rounded-xl p-4 mb-4 bg-slate-800 text-white"
          placeholder="Nombre"
          value={nombre}
          onChange={(e)=>setNombre(e.target.value)}
        />

        <input
          className="w-full rounded-xl p-4 mb-6 bg-slate-800 text-white"
          placeholder="WhatsApp"
          value={whatsapp}
          onChange={(e)=>setWhatsapp(e.target.value)}
        />

        <button
          onClick={ingresar}
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 p-4 font-bold text-white"
        >
          {loading ? "Ingresando..." : "Ingresar"}
        </button>

      </div>
    </main>
  );
}