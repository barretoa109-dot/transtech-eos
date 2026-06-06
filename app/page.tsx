"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function HomePage() {
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
      { nombre, whatsapp, empresa, problema },
    ]);

    setEnviando(false);

    if (error) {
      alert("No se pudo enviar. Probá de nuevo.");
      console.log(error);
      return;
    }

    alert("Solicitud registrada correctamente.");
    setNombre("");
    setWhatsapp("");
    setEmpresa("");
    setProblema("");
  }

  return (
    <main className="min-h-screen bg-[#020617] text-white">
      <section className="max-w-7xl mx-auto px-6 py-8">

        <header className="flex justify-between items-center mb-20">
          <div>
            <p className="text-cyan-400 font-black text-xl">TransTech</p>
            <h2 className="text-3xl font-black">EOS</h2>
          </div>

          <div className="flex gap-3">
            <a href="/login" className="px-5 py-3 rounded-xl bg-white/10">
              Ingresar
            </a>
            <a href="/eos" className="px-5 py-3 rounded-xl bg-cyan-400 text-slate-950 font-black">
              Acceder a EOS
            </a>
          </div>
        </header>

        <section className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-cyan-400 font-bold mb-4">Sistema empresarial inteligente</p>

            <h1 className="text-6xl font-black leading-tight mb-6">
              Ordená, automatizá y hacé crecer tu negocio con IA.
            </h1>

            <p className="text-slate-300 text-xl leading-relaxed mb-8">
              TransTech EOS ayuda a empresas, comercios y emprendedores a detectar problemas,
              ordenar procesos, mejorar ventas, controlar finanzas y tomar mejores decisiones
              con acompañamiento inteligente.
            </p>

            <div className="flex gap-4 flex-wrap">
              <a href="/login" className="bg-cyan-400 text-slate-950 px-8 py-4 rounded-2xl font-black">
                Comenzar gratis
              </a>
              <a href="/eos" className="border border-white/15 px-8 py-4 rounded-2xl">
                Probar Chat EOS
              </a>
              <a
                href="https://wa.me/595982226912"
                target="_blank"
                className="border border-emerald-400/40 text-emerald-300 px-8 py-4 rounded-2xl"
              >
                Hablar por WhatsApp
              </a>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mt-10">
              {[
                ["Diagnóstico", "Detecta problemas reales del negocio."],
                ["Dashboard", "Visualizá objetivos, avances y métricas."],
                ["Chat EOS", "Asistente conectado para guiarte paso a paso."],
              ].map(([t, d]) => (
                <div key={t} className="bg-[#091633] rounded-3xl p-5 border border-white/10">
                  <h3 className="text-cyan-400 font-bold">{t}</h3>
                  <p className="text-slate-400 text-sm mt-2">{d}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-8 shadow-2xl">
            <p className="text-cyan-400 font-bold mb-2">Diagnóstico gratuito</p>
            <h2 className="text-3xl font-black mb-2">Contanos qué necesitás mejorar</h2>
            <p className="text-slate-400 mb-6">
              Registrá tu solicitud y EOS iniciará el análisis de tu situación.
            </p>

            <div className="space-y-4">
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className="w-full bg-slate-800 rounded-xl p-4 border border-white/10" />
              <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp" className="w-full bg-slate-800 rounded-xl p-4 border border-white/10" />
              <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Empresa o negocio" className="w-full bg-slate-800 rounded-xl p-4 border border-white/10" />
              <textarea value={problema} onChange={(e) => setProblema(e.target.value)} rows={4} placeholder="¿Cuál es tu principal problema?" className="w-full bg-slate-800 rounded-xl p-4 border border-white/10" />

              <button onClick={enviarLead} disabled={enviando} className="w-full bg-cyan-400 text-slate-950 font-black py-4 rounded-xl">
                {enviando ? "Enviando..." : "Solicitar diagnóstico"}
              </button>
            </div>
          </div>
        </section>

        <section className="mt-32">
          <h2 className="text-5xl font-black text-center mb-6">¿Qué hace TransTech EOS?</h2>
          <p className="text-slate-400 text-center max-w-3xl mx-auto text-lg mb-14">
            EOS funciona como un sistema de gestión, diagnóstico y automatización con IA para ayudarte
            a tomar control del negocio desde un solo lugar.
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              ["Diagnóstico empresarial", "Analiza ventas, costos, clientes, procesos y puntos débiles."],
              ["Automatización", "Reduce tareas repetitivas y mejora tiempos de respuesta."],
              ["Finanzas", "Ayuda a ordenar ingresos, egresos, deudas, presupuestos y rentabilidad."],
              ["Seguimiento", "Registra avances, tareas y próximos pasos para no perder el control."],
              ["Atención inteligente", "Responde consultas y guía al usuario de forma natural."],
              ["Crecimiento", "Propone acciones comerciales para vender más y mejorar resultados."],
            ].map(([t, d]) => (
              <div key={t} className="bg-[#091633] p-7 rounded-3xl border border-white/10">
                <h3 className="text-2xl font-black mb-3">{t}</h3>
                <p className="text-slate-400">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-32">
          <h2 className="text-5xl font-black text-center mb-14">Planes</h2>

          <div className="grid md:grid-cols-4 gap-6">
            {[
              ["Free", "Gs. 0", "5 mensajes gratis para probar EOS."],
              ["Inicial", "Gs. 149.000/mes", "Para emprendedores y pequeños comercios."],
              ["Pro", "Gs. 349.000/mes", "Dashboard, seguimiento y asesoría más completa."],
              ["Empresa", "A medida", "Automatizaciones, WhatsApp, CRM y flujos personalizados."],
            ].map(([plan, precio, desc]) => (
              <div key={plan} className="bg-[#091633] rounded-3xl p-7 border border-cyan-400/20">
                <h3 className="text-2xl font-black text-cyan-400">{plan}</h3>
                <p className="text-3xl font-black mt-4">{precio}</p>
                <p className="text-slate-400 mt-4">{desc}</p>
                <a href="/login" className="block mt-6 text-center bg-cyan-400 text-slate-950 font-black py-3 rounded-xl">
                  Elegir plan
                </a>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-32 bg-[#091633] border border-cyan-400/20 rounded-3xl p-10 text-center">
          <h2 className="text-5xl font-black mb-4">Empezá con un diagnóstico gratuito</h2>
          <p className="text-slate-400 text-lg mb-8">
            EOS puede ayudarte a ordenar tu negocio, mejorar tus ventas y tomar mejores decisiones.
          </p>

          <div className="flex justify-center gap-4 flex-wrap">
            <a href="/login" className="bg-cyan-400 text-slate-950 px-8 py-4 rounded-2xl font-black">
              Crear acceso
            </a>
            <a href="https://wa.me/595982226912" target="_blank" className="bg-emerald-500 text-white px-8 py-4 rounded-2xl font-black">
              WhatsApp
            </a>
          </div>
        </section>

      </section>
    </main>
  );
}