"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [problema, setProblema] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviarLead() {
    if (!nombre || !whatsapp || !problema) {
      alert("Completá nombre, WhatsApp y problema principal.");
      return;
    }

    setEnviando(true);

    const { error } = await supabase.from("leads").insert([
      {
        nombre,
        whatsapp,
        empresa,
        problema,
      },
    ]);

    setEnviando(false);

    if (error) {
      alert("Error al guardar. Revisá Supabase.");
      console.log(error);
      return;
    }

    alert("Solicitud enviada correctamente.");

    setNombre("");
    setWhatsapp("");
    setEmpresa("");
    setProblema("");
  }

  return (
    <main className="min-h-screen bg-[#020617] text-white">
      <section className="max-w-6xl mx-auto px-6 py-12">
        <nav className="flex justify-between items-center mb-16">
          <div>
            <p className="text-cyan-400 font-bold text-lg">TransTech</p>
            <h1 className="text-3xl font-black">EOS</h1>
          </div>

          <div className="flex gap-3">
            <a href="/login" className="px-5 py-3 rounded-xl bg-white/10 border border-white/10">
              Ingresar
            </a>
            <a href="/eos" className="px-5 py-3 rounded-xl bg-cyan-400 text-slate-950 font-bold">
              Chat EOS
            </a>
          </div>
        </nav>

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-cyan-400 font-bold mb-4">Asesor empresarial inteligente</p>

            <h2 className="text-5xl md:text-6xl font-black leading-tight mb-6">
              Ordená, diagnosticá y hacé crecer tu negocio con IA.
            </h2>

            <p className="text-slate-300 text-xl mb-8">
              TransTech EOS ayuda a detectar problemas, mejorar ventas, organizar finanzas
              y automatizar procesos desde una sola plataforma.
            </p>

            <div className="grid md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="font-bold text-cyan-300">Diagnóstico</h3>
                <p className="text-slate-400 text-sm mt-2">Analizamos tu situación actual.</p>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="font-bold text-cyan-300">Dashboard</h3>
                <p className="text-slate-400 text-sm mt-2">Visualizá avances y objetivos.</p>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="font-bold text-cyan-300">Chat EOS</h3>
                <p className="text-slate-400 text-sm mt-2">Asistente conectado con n8n.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <a href="/dashboard" className="px-6 py-4 rounded-2xl bg-white text-slate-950 font-bold">
                Ver dashboard
              </a>
              <a href="/login" className="px-6 py-4 rounded-2xl border border-white/20 font-bold">
                Crear acceso
              </a>
            </div>
          </div>

          <div className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-8 shadow-2xl">
            <h3 className="text-3xl font-black mb-2">Solicitá un diagnóstico gratuito</h3>
            <p className="text-slate-400 mb-8">
              Dejanos tus datos y EOS registra tu solicitud.
            </p>

            <div className="space-y-4">
              <input
                className="w-full p-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-slate-400 outline-none"
                placeholder="Nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />

              <input
                className="w-full p-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-slate-400 outline-none"
                placeholder="WhatsApp"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
              />

              <input
                className="w-full p-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-slate-400 outline-none"
                placeholder="Empresa"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
              />

              <textarea
                className="w-full p-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder-slate-400 outline-none min-h-[130px]"
                placeholder="¿Cuál es tu principal problema?"
                value={problema}
                onChange={(e) => setProblema(e.target.value)}
              />

              <button
                onClick={enviarLead}
                disabled={enviando}
                className="w-full bg-cyan-400 text-slate-950 py-4 rounded-xl font-black text-lg disabled:opacity-60"
              >
                {enviando ? "Enviando..." : "Enviar solicitud"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}