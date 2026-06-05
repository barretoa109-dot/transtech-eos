"use client";

import { useState } from "react";

export default function Login() {
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  async function entrar() {
    if (!whatsapp) {
      alert("Ingresá tu WhatsApp");
      return;
    }

    const usuario = {
      id: whatsapp,
      nombre: nombre || "Usuario",
      whatsapp,
      plan: "free",
    };

    localStorage.setItem("usuario_id", usuario.id);
    localStorage.setItem("usuario_nombre", usuario.nombre);
    localStorage.setItem("usuario_plan", usuario.plan);

    window.location.href = "/dashboard";
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#020617] text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/70 p-10">
        <p className="text-cyan-400 font-bold text-xl">TransTech EOS</p>
        <h1 className="mt-4 text-6xl font-black leading-none">Acceder al sistema</h1>
        <p className="mt-4 text-slate-400">Ingresá con tu WhatsApp para ver tu panel.</p>

        <div className="mt-8 space-y-4">
          <input className="w-full rounded-2xl border border-white/10 bg-slate-800 p-4 outline-none" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <input className="w-full rounded-2xl border border-white/10 bg-slate-800 p-4 outline-none" placeholder="WhatsApp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />

          <button onClick={entrar} className="w-full rounded-2xl bg-cyan-400 py-4 text-xl font-bold text-slate-950">
            Entrar
          </button>
        </div>
      </div>
    </main>
  );
}