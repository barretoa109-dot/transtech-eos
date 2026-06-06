"use client";

import { useState } from "react";

export default function LoginPage() {
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  function entrar() {
    if (!whatsapp.trim()) {
      alert("Ingresá tu WhatsApp");
      return;
    }

    localStorage.setItem("usuario_id", whatsapp);
    localStorage.setItem("usuario_nombre", nombre || "Usuario");
    localStorage.setItem("usuario_plan", "free");

    window.location.href = "/dashboard";
  }

  return (
    <main className="min-h-screen bg-[#020617] text-white flex items-center justify-center p-6">
      <section className="w-full max-w-md bg-[#091633] border border-cyan-400/20 rounded-3xl p-8">
        <p className="text-cyan-400 font-bold mb-2">TransTech EOS</p>
        <h1 className="text-4xl font-black mb-4">
          Accedé a tu sistema
        </h1>
        <p className="text-slate-400 mb-8">
          Ingresá con tu nombre y WhatsApp para abrir tu panel.
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
            className="w-full rounded-2xl bg-cyan-400 text-slate-950 py-4 text-xl font-black"
          >
            Entrar
          </button>
        </div>

        <a href="/" className="block text-center text-slate-400 mt-6">
          Volver al inicio
        </a>
      </section>
    </main>
  );
}