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
            <p className="text-white font-black text-2xl">EOS</p>
          </div>

          <nav className="hidden md:flex gap-6 text-slate-300">
            <a href="#servicios">Servicios</a>
            <a href="#sistema">Sistema</a>
            <a href="#planes">Planes</a>
            <a href="#proposito">Propósito</a>
          </nav>

          <div className="flex gap-3">
            <a href="/login" className="px-5 py-3 rounded-xl bg-white/10">
              Ingresar
            </a>
            <a href="/eos" className="px-5 py-3 rounded-xl bg-cyan-400 text-slate-950 font-black">
              Chat EOS
            </a>
          </div>
        </header>

        <section className="grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <p className="text-cyan-400 font-bold mb-4">
              Sistema de gestión, automatización y crecimiento con IA
            </p>

            <h1 className="text-5xl md:text-7xl font-black leading-tight mb-6">
              Ordená, automatizá y hacé crecer tu negocio con IA.
            </h1>

            <p className="text-slate-300 text-xl leading-relaxed mb-8">
              TransTech EOS ayuda a empresas, comercios y emprendedores a entender qué está fallando,
              ordenar sus procesos, mejorar ventas, controlar finanzas y tomar mejores decisiones desde
              una sola plataforma.
            </p>

            <div className="flex gap-4 flex-wrap">
              <a href="/login" className="bg-cyan-400 text-slate-950 px-8 py-4 rounded-2xl font-black">
                Crear acceso
              </a>
              <a href="/eos" className="border border-white/15 px-8 py-4 rounded-2xl">
                Probar EOS
              </a>
              <a href="https://wa.me/595982226912" target="_blank" className="border border-emerald-400/40 text-emerald-300 px-8 py-4 rounded-2xl">
                WhatsApp
              </a>
            </div>
          </div>

          <div className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-8 shadow-2xl">
            <p className="text-cyan-400 font-bold mb-2">Diagnóstico gratuito</p>
            <h2 className="text-3xl font-black mb-3">Contanos qué necesitás mejorar</h2>
            <p className="text-slate-400 mb-6">
              Dejanos tus datos y analizamos tu situación para iniciar un plan de mejora.
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

        <section id="proposito" className="mt-32 grid md:grid-cols-3 gap-6">
          {[
            ["Quiénes somos", "TransTech EOS es una solución creada para ayudar a negocios a trabajar mejor, vender más y tener mayor control."],
            ["Qué hacemos", "Combinamos gestión, automatización, diagnóstico empresarial e inteligencia artificial para mejorar procesos reales."],
            ["Nuestro propósito", "Hacer que cualquier negocio pueda acceder a herramientas inteligentes sin depender de sistemas caros o complicados."],
          ].map(([t, d]) => (
            <div key={t} className="bg-[#091633] rounded-3xl p-8 border border-white/10">
              <h3 className="text-2xl font-black text-cyan-400 mb-4">{t}</h3>
              <p className="text-slate-300 leading-relaxed">{d}</p>
            </div>
          ))}
        </section>

        <section id="servicios" className="mt-32">
          <h2 className="text-5xl font-black text-center mb-6">Nuestros servicios</h2>
          <p className="text-slate-400 text-center max-w-3xl mx-auto text-lg mb-14">
            EOS no es solo un chat. Es una estructura de acompañamiento para diagnosticar, ordenar,
            automatizar y hacer crecer tu negocio.
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              ["Diagnóstico empresarial", "Analizamos ventas, costos, procesos, clientes, organización, puntos débiles y oportunidades."],
              ["Automatización con IA", "Automatizamos respuestas, seguimiento, tareas repetitivas, organización de datos y procesos internos."],
              ["Gestión comercial", "Ayudamos a mejorar captación, seguimiento de clientes, propuestas, ventas y retención."],
              ["Finanzas del negocio", "Ordenamos ingresos, egresos, márgenes, deudas, presupuestos y rentabilidad mensual."],
              ["Dashboard de control", "Visualizás objetivos, progreso, próximas acciones, métricas y estado general del negocio."],
              ["Chat EOS", "Un asistente inteligente que conversa, guía, responde y acompaña paso a paso."],
            ].map(([t, d]) => (
              <div key={t} className="bg-[#091633] p-7 rounded-3xl border border-white/10">
                <h3 className="text-2xl font-black mb-3">{t}</h3>
                <p className="text-slate-400 leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="sistema" className="mt-32 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-cyan-400 font-bold mb-3">Cómo funciona</p>
            <h2 className="text-5xl font-black mb-6">Un sistema para acompañar el crecimiento</h2>
            <p className="text-slate-300 text-lg leading-relaxed">
              Primero EOS recopila información del negocio, luego analiza los problemas principales,
              organiza prioridades y propone acciones concretas. El objetivo es que el cliente no solo
              reciba ideas, sino un camino claro para ejecutar.
            </p>
          </div>

          <div className="space-y-4">
            {[
              "1. Diagnóstico inicial del negocio",
              "2. Identificación de problemas y oportunidades",
              "3. Organización de objetivos y tareas",
              "4. Seguimiento mediante dashboard y chat",
              "5. Automatización de procesos y respuestas",
              "6. Mejora continua de ventas, finanzas y gestión",
            ].map((item) => (
              <div key={item} className="bg-[#091633] rounded-2xl p-5 border border-cyan-400/20 font-bold">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section id="planes" className="mt-32">
          <h2 className="text-5xl font-black text-center mb-14">Planes</h2>

          <div className="grid md:grid-cols-4 gap-6">
            {[
              ["Free", "Gs. 0", "5 mensajes gratis para probar EOS.", ["Acceso básico", "Chat inicial", "Prueba del sistema"]],
              ["Inicial", "Gs. 99.000/mes", "Para emprendedores y pequeños comercios.", ["Chat EOS", "Diagnóstico simple", "Seguimiento básico"]],
              ["Pro", "Gs. 250.000/mes", "Para negocios que quieren orden y crecimiento.", ["Dashboard", "Seguimiento", "Asesoría más completa", "Acciones comerciales"]],
              ["Business", "A medida", "Para empresas que necesitan automatización personalizada.", ["WhatsApp", "CRM", "Flujos automáticos", "Integraciones"]],
            ].map(([plan, precio, desc, items]: any) => (
              <div key={plan} className="bg-[#091633] rounded-3xl p-7 border border-cyan-400/20">
                <h3 className="text-2xl font-black text-cyan-400">{plan}</h3>
                <p className="text-3xl font-black mt-4">{precio}</p>
                <p className="text-slate-400 mt-4 mb-5">{desc}</p>

                <ul className="space-y-2 text-slate-300 mb-6">
                  {items.map((i: string) => (
                    <li key={i}>✓ {i}</li>
                  ))}
                </ul>

                <a href="/login" className="block text-center bg-cyan-400 text-slate-950 font-black py-3 rounded-xl">
                  Elegir plan
                </a>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-32">
          <h2 className="text-5xl font-black text-center mb-14">En qué nos enfocamos</h2>

          <div className="grid md:grid-cols-2 gap-6">
            {[
              ["Orden", "Que el negocio tenga claridad sobre tareas, clientes, ventas, costos y prioridades."],
              ["Rentabilidad", "Que las decisiones estén orientadas a mejorar márgenes y resultados."],
              ["Automatización", "Que las tareas repetitivas dejen de consumir tiempo innecesario."],
              ["Experiencia del cliente", "Que cada cliente reciba atención clara, rápida y acompañamiento real."],
            ].map(([t, d]) => (
              <div key={t} className="bg-[#091633] p-8 rounded-3xl border border-white/10">
                <h3 className="text-3xl font-black mb-3">{t}</h3>
                <p className="text-slate-400 text-lg">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-32 bg-[#091633] border border-cyan-400/20 rounded-3xl p-10 text-center">
          <h2 className="text-5xl font-black mb-4">Empezá con TransTech EOS</h2>
          <p className="text-slate-400 text-lg mb-8">
            Probá el sistema, solicitá tu diagnóstico o hablá directamente por WhatsApp.
          </p>

          <div className="flex justify-center gap-4 flex-wrap">
            <a href="/login" className="bg-cyan-400 text-slate-950 px-8 py-4 rounded-2xl font-black">
              Crear acceso
            </a>
            <a href="/eos" className="bg-white/10 px-8 py-4 rounded-2xl font-black">
              Abrir Chat EOS
            </a>
            <a href="https://wa.me/595982226912" target="_blank" className="bg-emerald-500 px-8 py-4 rounded-2xl font-black">
              WhatsApp
            </a>
          </div>
        </section>

        <footer className="py-12 text-center text-slate-500">
          TransTech EOS — Gestión, automatización y crecimiento con IA.
        </footer>

      </section>
    </main>
  );
}