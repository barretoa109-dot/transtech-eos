"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cargando, setCargando] = useState(false);

  async function entrar() {
    if (!whatsapp.trim()) {
      alert("Ingresá tu WhatsApp");
      return;
    }

    setCargando(true);

    const nombreFinal = nombre.trim() || "Usuario";
    const whatsappFinal = whatsapp.trim();

    try {
      const { data: usuarioExistente, error: errorBuscar } = await supabase
        .from("usuarios")
        .select("*")
        .eq("whatsapp", whatsappFinal)
        .maybeSingle();

      if (errorBuscar) {
        console.log(errorBuscar);
        alert("No se pudo verificar el usuario.");
        setCargando(false);
        return;
      }

      let usuario = usuarioExistente;

      if (!usuario) {
        const { data: nuevoUsuario, error: errorCrear } = await supabase
          .from("usuarios")
          .insert([
            {
              nombre: nombreFinal,
              whatsapp: whatsappFinal,
              plan: "free",
              progreso: 0,
              estado: "Activo",
            },
          ])
          .select()
          .single();

        if (errorCrear) {
          console.log(errorCrear);
          alert("No se pudo crear el usuario.");
          setCargando(false);
          return;
        }

        usuario = nuevoUsuario;
      }

      localStorage.setItem("usuario_uuid", usuario.id);
      localStorage.setItem("usuario_id", usuario.whatsapp);
      localStorage.setItem("usuario_nombre", usuario.nombre || nombreFinal);
      localStorage.setItem("usuario_whatsapp", usuario.whatsapp);
      localStorage.setItem("usuario_plan", usuario.plan || "free");

      window.location.href = "/dashboard";
    } catch (error) {
      console.log(error);
      alert("Ocurrió un error al ingresar.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#020617] text-white flex items-center justify-center p-6">
      <section className="w-full max-w-md bg-[#091633] border border-cyan-400/20 rounded-3xl p-8">
        <p className="text-cyan-400 font-bold mb-2">TransTech EOS</p>

        <h1 className="text-4xl font-black mb-4">
          Accedé a tu sistema
        </h1>

        <p className="text-slate-400 mb-8">
          Ingresá con tu nombre y WhatsApp para abrir tu panel, guardar tu progreso y continuar tu proceso con EOS.
        </p>

        <div className="space-y-4">
          <input
            className="w-full rounded-2xl bg-slate-800 border border-white/10 p-4 outline-none"
            placeholder="Nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />

          <input
            className="w-full rounded-2xl bg-slate-800 border border-white/10 p-4 outline-none"
            placeholder="WhatsApp"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
          />

          <button
            onClick={entrar}
            disabled={cargando}
            className="w-full rounded-2xl bg-cyan-400 text-slate-950 py-4 text-xl font-black disabled:opacity-60"
          >
            {cargando ? "Ingresando..." : "Entrar"}
          </button>
        </div>

        <a href="/" className="block text-center text-slate-400 mt-6">
          Volver al inicio
        </a>
      </section>
    </main>
  );
}