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
      alert("No se pudo enviar. Probá nuevamente.");
      console.log(error);
      return;
    }

    alert("Diagnóstico solicitado correctamente.");
    setNombre("");
    setWhatsapp("");
    setEmpresa("");
    setProblema("");
  }

  return (
    <main className="min-h-screen bg-[#020617] text-white">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#020617]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="text-xl font-black">
            TransTech <span className="text-cyan-400">EOS</span>
          </div>

          <div className="hidden gap-8 text-sm font-semibold md:flex">
            <a href="#soluciones">Soluciones</a>
            <a href="#funciona">Cómo funciona</a>
            <a href="#enfoque">Enfoque</a>
            <a href="#planes">Planes</a>
            <a href="#proposito">Propósito</a>
          </div>

          <div className="flex gap-3">
            <a
              href="/login"
              className="rounded-full border border-white/10 px-4 py-2 text-sm font-bold"
            >
              Ingresar
            </a>
            <a
              href="/eos"
              className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-black text-slate-950"
            >
              Chat EOS
            </a>
            <a
              href="https://wa.me/595982226912"
              target="_blank"
              className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-black text-white"
            >
              WhatsApp
            </a>
          </div>
        </div>
      </nav>

      <section className="mx-auto grid max-w-7xl gap-12 px-6 py-24 md:grid-cols-2 md:items-center">
        <div>
          <div className="mb-6 inline-flex rounded-full border border-cyan-400/40 bg-cyan-400/10 px-5 py-2 text-sm font-bold text-cyan-300">
            Consultoría + IA + Automatización
          </div>

          <h1 className="text-5xl font-black leading-tight md:text-7xl">
            Tu sistema inteligente para crecer con más orden, control y
            claridad.
          </h1>

          <p className="mt-8 max-w-2xl text-xl leading-relaxed text-slate-300">
            TransTech EOS ayuda a personas, emprendedores y empresas a
            diagnosticar problemas, crear planes de acción, ordenar procesos,
            automatizar tareas y tomar mejores decisiones para crecer de forma
            sostenible.
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <a
              href="#diagnostico"
              className="rounded-full bg-cyan-400 px-8 py-4 font-black text-slate-950"
            >
              Solicitar diagnóstico gratuito
            </a>
            <a
              href="#planes"
              className="rounded-full border border-white/15 px-8 py-4 font-bold"
            >
              Ver planes
            </a>
          </div>
        </div>

        <div className="rounded-[2rem] border border-cyan-400/20 bg-[#091633] p-8 shadow-2xl">
          <p className="text-sm font-bold text-cyan-300">Sistema EOS</p>
          <h2 className="mt-3 text-3xl font-black">
            Diagnóstico, gestión y automatización en una sola plataforma.
          </h2>

          <div className="mt-8 grid gap-4">
            {[
              "Análisis del negocio o situación personal",
              "Chat inteligente conectado a EOS",
              "Dashboard con objetivos y progreso",
              "Automatización de tareas y respuestas",
              "Seguimiento por WhatsApp",
            ].map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 text-slate-200"
              >
                ✓ {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="soluciones" className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-center text-5xl font-black">Qué hace TransTech EOS</h2>
        <p className="mx-auto mt-6 max-w-3xl text-center text-xl text-slate-300">
          Creamos un sistema para que puedas entender dónde estás, qué está
          fallando y qué pasos concretos tenés que tomar para mejorar.
        </p>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            [
              "Diagnóstico",
              "Analizamos tu situación, detectamos problemas ocultos y priorizamos lo más importante.",
            ],
            [
              "Gestión",
              "Ordenamos clientes, tareas, procesos, finanzas, objetivos y seguimiento.",
            ],
            [
              "Automatización",
              "Usamos IA para reducir trabajo manual, responder mejor y ahorrar tiempo.",
            ],
            [
              "Asesoría",
              "Te guiamos paso a paso con recomendaciones claras y aplicables.",
            ],
            [
              "Dashboard",
              "Visualizás avance, metas, prioridades y puntos críticos del negocio.",
            ],
            [
              "WhatsApp",
              "Mantenemos una experiencia simple, rápida y cercana desde el canal que más usás.",
            ],
          ].map(([titulo, texto]) => (
            <div
              key={titulo}
              className="rounded-3xl border border-cyan-400/20 bg-[#091633] p-8"
            >
              <h3 className="text-2xl font-black text-cyan-300">{titulo}</h3>
              <p className="mt-4 text-slate-300">{texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="funciona" className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-center text-5xl font-black">Cómo funciona</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-4">
          {[
            ["1", "Diagnóstico inicial", "Recolectamos datos clave."],
            ["2", "Análisis EOS", "Detectamos problemas y oportunidades."],
            ["3", "Plan de acción", "Creamos pasos claros y prioridades."],
            ["4", "Seguimiento", "Acompañamos el avance y ajustamos mejoras."],
          ].map(([num, titulo, texto]) => (
            <div
              key={num}
              className="rounded-3xl border border-white/10 bg-white/5 p-7"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-400 font-black text-slate-950">
                {num}
              </div>
              <h3 className="text-xl font-black">{titulo}</h3>
              <p className="mt-3 text-slate-300">{texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="enfoque" className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-center text-5xl font-black">En qué nos enfocamos</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            "Crecimiento sostenible",
            "Rentabilidad",
            "Orden financiero",
            "Procesos claros",
            "Mejor atención al cliente",
            "Automatización inteligente",
          ].map((item) => (
            <div
              key={item}
              className="rounded-3xl bg-[#091633] p-8 text-2xl font-black text-cyan-300"
            >
              {item}
            </div>
          ))}
        </div>
      </section>

      <section id="planes" className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-center text-5xl font-black">Planes</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-4">
          {[
            ["Free", "Gs. 0", "5 mensajes gratis para probar EOS."],
            [
              "Inicial",
              "Gs. 99.000/mes",
              "Ideal para emprendedores y pequeños negocios.",
            ],
            [
              "Pro",
              "Gs. 250.000/mes",
              "Dashboard, seguimiento y asesoría más completa.",
            ],
            [
              "Business",
              "A medida",
              "Automatizaciones, WhatsApp, CRM y flujos personalizados.",
            ],
          ].map(([plan, precio, texto]) => (
            <div
              key={plan}
              className="rounded-3xl border border-cyan-400/20 bg-[#091633] p-8"
            >
              <h3 className="text-3xl font-black text-cyan-300">{plan}</h3>
              <p className="mt-6 text-4xl font-black">{precio}</p>
              <p className="mt-5 text-slate-300">{texto}</p>
              <a
                href="#diagnostico"
                className="mt-8 block rounded-2xl bg-cyan-400 px-6 py-4 text-center font-black text-slate-950"
              >
                Elegir plan
              </a>
            </div>
          ))}
        </div>
      </section>

      <section id="proposito" className="mx-auto max-w-7xl px-6 py-20">
        <div className="rounded-[2rem] border border-cyan-400/20 bg-[#091633] p-10 text-center">
          <h2 className="text-5xl font-black">Nuestro propósito</h2>
          <p className="mx-auto mt-6 max-w-4xl text-xl leading-relaxed text-slate-300">
            Ayudar a personas y empresas a tener más claridad, más control y
            mejores herramientas para crecer. TransTech EOS combina consultoría,
            inteligencia artificial y automatización para transformar problemas
            desordenados en planes simples, medibles y accionables.
          </p>
        </div>
      </section>

      <section id="diagnostico" className="mx-auto max-w-4xl px-6 py-24">
        <div className="rounded-[2rem] border border-cyan-400/20 bg-[#091633] p-8">
          <p className="font-bold text-cyan-300">Diagnóstico gratuito</p>
          <h2 className="mt-3 text-4xl font-black">
            Contanos qué necesitás mejorar
          </h2>
          <p className="mt-4 text-slate-300">
            Completá tus datos y EOS va a registrar tu solicitud para iniciar el
            análisis.
          </p>

          <div className="mt-8 grid gap-4">
            <input
              className="rounded-2xl border border-white/10 bg-white/10 p-4 outline-none"
              placeholder="Nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />

            <input
              className="rounded-2xl border border-white/10 bg-white/10 p-4 outline-none"
              placeholder="WhatsApp"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
            />

            <input
              className="rounded-2xl border border-white/10 bg-white/10 p-4 outline-none"
              placeholder="Empresa o negocio"
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
            />

            <textarea
              className="min-h-32 rounded-2xl border border-white/10 bg-white/10 p-4 outline-none"
              placeholder="¿Cuál es tu principal problema?"
              value={problema}
              onChange={(e) => setProblema(e.target.value)}
            />

            <button
              onClick={enviarLead}
              disabled={enviando}
              className="rounded-2xl bg-cyan-400 px-6 py-4 font-black text-slate-950 disabled:opacity-60"
            >
              {enviando ? "Enviando..." : "Solicitar diagnóstico"}
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-10 text-center text-slate-400">
        TransTech EOS - Grupo TransTech
      </footer>
    </main>
  );
}