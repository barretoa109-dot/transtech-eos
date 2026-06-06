"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [problema, setProblema] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviarLead() {
    if (!nombre || !whatsapp || !problema) {
      alert("Completá nombre, WhatsApp y el problema principal.");
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
      console.log(error);
      alert("No se pudo enviar. Revisá Supabase.");
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
      <section className="max-w-7xl mx-auto px-6 py-8">
        <nav className="flex items-center justify-between mb-20">
          <div>
            <p className="text-cyan-400 font-bold">TransTech</p>
            <h1 className="text-3xl font-black">EOS</h1>
          </div>

          <div className="flex gap-3">
            <Link href="/login" className="px-5 py-3 rounded-xl bg-white/10 border border-white/10">
              Ingresar
            </Link>
            <Link href="/eos" className="px-5 py-3 rounded-xl bg-cyan-400 text-slate-950 font-bold">
              Chat EOS
            </Link>
          </div>
        </nav>

        <div className="grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <p className="text-cyan-400 font-bold mb-4">
              Sistema empresarial inteligente
            </p>

            <h2 className="text-5xl md:text-6xl font-black leading-tight mb-6">
              Ordená, automatizá y hacé crecer tu negocio con IA.
            </h2>

            <p className="text-slate-300 text-xl mb-8 leading-relaxed">
              TransTech EOS es un sistema de diagnóstico, gestión y automatización
              para empresas y emprendedores. Te ayuda a entender qué está fallando,
              ordenar tus procesos, mejorar ventas y tomar mejores decisiones.
            </p>

            <div className="grid sm:grid-cols-3 gap-4 mb-10">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="font-bold text-cyan-300 mb-2">Diagnóstico</h3>
                <p className="text-sm text-slate-400">
                  Detecta problemas reales de ventas, gestión y finanzas.
                </p>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="font-bold text-cyan-300 mb-2">Dashboard</h3>
                <p className="text-sm text-slate-400">
                  Visualizá tu avance, objetivos y próximos pasos.
                </p>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <h3 className="font-bold text-cyan-300 mb-2">Chat EOS</h3>
                <p className="text-sm text-slate-400">
                  Asistente conectado para guiarte paso a paso.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <Link href="/login" className="px-7 py-4 rounded-2xl bg-cyan-400 text-slate-950 font-black">
                Empezar ahora
              </Link>

              <Link href="/dashboard" className="px-7 py-4 rounded-2xl border border-white/20 font-bold">
                Ver panel
              </Link>
            </div>
          </div>

          <div className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-8 shadow-2xl">
            <p className="text-cyan-400 font-bold mb-2">Diagnóstico gratuito</p>
            <h3 className="text-3xl font-black mb-3">
              Contanos qué necesitás mejorar
            </h3>

            <p className="text-slate-400 mb-8">
              Completá tus datos y EOS va a registrar tu solicitud para iniciar el análisis.
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
                placeholder="Empresa o negocio"
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