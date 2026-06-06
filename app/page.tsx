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
      alert("Completá nombre, WhatsApp y tu principal necesidad.");
      return;
    }

    setEnviando(true);

    const { error } = await supabase.from("leads").insert([
      { nombre, whatsapp, empresa, problema },
    ]);

    setEnviando(false);

    if (error) {
      alert("No se pudo registrar la solicitud. Probá nuevamente.");
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
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#020617]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <a href="#" className="text-xl font-black">
            TransTech <span className="text-cyan-400">EOS</span>
          </a>

          <div className="hidden gap-8 text-sm font-bold md:flex">
            <a href="#soluciones">Soluciones</a>
            <a href="#funciona">Cómo funciona</a>
            <a href="#enfoque">Enfoque</a>
            <a href="#proposito">Propósito</a>
            <a href="#planes">Planes</a>
            <a href="#diagnostico">Diagnóstico</a>
          </div>

          <div className="flex gap-3">
            <a href="/login" className="rounded-full border border-white/15 px-5 py-3 text-sm font-bold">
              Ingresar
            </a>
            <a href="/eos" className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-black text-slate-950">
              Chat EOS
            </a>
            <a href="https://wa.me/595982226912" target="_blank" className="rounded-full bg-emerald-500 px-5 py-3 text-sm font-black">
              WhatsApp
            </a>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-6 py-28">
        <div className="max-w-4xl">
          <div className="mb-7 inline-flex rounded-full border border-cyan-400/40 bg-cyan-400/10 px-5 py-2 text-sm font-bold text-cyan-300">
            Consultoría + IA + Automatización
          </div>

          <h1 className="text-5xl font-black leading-tight md:text-7xl">
            Tu sistema inteligente para crecer con más orden, control y claridad.
          </h1>

          <p className="mt-8 max-w-3xl text-xl leading-relaxed text-slate-300">
            TransTech EOS ayuda a personas físicas, emprendedores, comercios y empresas a diagnosticar problemas,
            ordenar procesos, automatizar tareas, mejorar la toma de decisiones y crecer de forma rentable,
            sostenible y medible.
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <a href="#diagnostico" className="rounded-full bg-cyan-400 px-8 py-4 font-black text-slate-950">
              Solicitar diagnóstico gratuito
            </a>
            <a href="#planes" className="rounded-full border border-white/15 px-8 py-4 font-bold">
              Ver planes
            </a>
          </div>
        </div>
      </section>

      <section id="soluciones" className="mx-auto max-w-7xl px-6 py-20">
        <p className="text-center font-bold text-cyan-300">QUÉ HACEMOS</p>
        <h2 className="mt-4 text-center text-5xl font-black">Todo en un solo sistema</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            ["Diagnóstico inteligente", "Analizamos tu situación actual, detectamos problemas reales, oportunidades y prioridades."],
            ["Gestión y organización", "Ordenamos clientes, objetivos, tareas, procesos, finanzas, seguimiento y próximos pasos."],
            ["Automatización con IA", "Reducimos tareas repetitivas, mejoramos respuestas y aumentamos tu capacidad operativa."],
            ["Dashboard de progreso", "Visualizás avances, objetivos, métricas, estado general y acciones pendientes."],
            ["Asesoría estratégica", "Recibís orientación clara para tomar mejores decisiones y avanzar paso a paso."],
            ["Seguimiento por WhatsApp", "Acompañamiento directo, práctico y cercano desde el canal que más usás."],
          ].map(([titulo, texto]) => (
            <div key={titulo} className="rounded-3xl border border-cyan-400/20 bg-[#091633] p-8">
              <h3 className="text-2xl font-black text-cyan-300">{titulo}</h3>
              <p className="mt-4 text-lg leading-relaxed text-slate-300">{texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="funciona" className="mx-auto max-w-7xl px-6 py-20">
        <p className="text-center font-bold text-cyan-300">PROCESO</p>
        <h2 className="mt-4 text-center text-5xl font-black">Cómo funciona</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-4">
          {[
            ["1", "Entendemos tu situación", "Vemos tu punto actual, tus problemas, tus recursos y tus objetivos."],
            ["2", "Detectamos prioridades", "EOS identifica qué frena tu avance y qué se debe ordenar primero."],
            ["3", "Creamos un plan claro", "Definimos acciones concretas, simples y medibles para avanzar."],
            ["4", "Medimos y mejoramos", "Hacemos seguimiento para lograr crecimiento real y sostenido."],
          ].map(([num, titulo, texto]) => (
            <div key={num} className="rounded-3xl border border-white/10 bg-white/5 p-7">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-400 font-black text-slate-950">
                {num}
              </div>
              <h3 className="text-xl font-black">{titulo}</h3>
              <p className="mt-3 leading-relaxed text-slate-300">{texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="enfoque" className="mx-auto max-w-7xl px-6 py-20">
        <p className="text-center font-bold text-cyan-300">ENFOQUE</p>
        <h2 className="mt-4 text-center text-5xl font-black">En qué nos enfocamos</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            ["Crecimiento sostenible", "Buscamos crecimiento real, ordenado y estable, no soluciones rápidas sin base."],
            ["Rentabilidad", "Ayudamos a mejorar ingresos, costos, decisiones, procesos y uso del tiempo."],
            ["Orden financiero", "Claridad sobre gastos, ingresos, deudas, presupuestos, prioridades y próximos movimientos."],
            ["Procesos claros", "Convertimos el desorden operativo en sistemas simples, repetibles y fáciles de seguir."],
            ["Mejor atención al cliente", "Respuestas más rápidas, mejor seguimiento y una experiencia más profesional."],
            ["Automatización inteligente", "La IA trabaja para ahorrar tiempo, reducir errores y aumentar productividad."],
          ].map(([titulo, texto]) => (
            <div key={titulo} className="rounded-3xl bg-[#091633] p-8">
              <h3 className="text-2xl font-black text-cyan-300">{titulo}</h3>
              <p className="mt-4 leading-relaxed text-slate-300">{texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="proposito" className="mx-auto max-w-7xl px-6 py-20">
        <div className="rounded-[2rem] border border-cyan-400/20 bg-[#091633] p-10 text-center">
          <p className="font-bold text-cyan-300">NUESTRO PROPÓSITO</p>
          <h2 className="mt-4 text-5xl font-black">Ayudarte a salir adelante con un sistema claro</h2>
          <p className="mx-auto mt-8 max-w-4xl text-xl leading-relaxed text-slate-300">
            TransTech EOS existe para acompañar a personas físicas, emprendedores y empresas,
            sin importar en qué situación estén actualmente. El objetivo es ayudarte a ordenar tu realidad,
            entender qué está fallando, crear un camino de mejora y crecer con más control, rentabilidad
            y estabilidad en el tiempo.
          </p>
        </div>
      </section>

      <section id="planes" className="mx-auto max-w-7xl px-6 py-20">
        <p className="text-center font-bold text-cyan-300">PLANES</p>
        <h2 className="mt-4 text-center text-5xl font-black">Elegí cómo querés empezar</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-4">
          {[
            ["Free", "Gs. 0", "5 mensajes gratis para probar EOS, conocer el sistema y entender cómo puede ayudarte."],
            ["Inicial", "Gs. 99.000/mes", "Para personas, emprendedores y pequeños negocios que necesitan orden, guía y seguimiento básico."],
            ["Pro", "Gs. 250.000/mes", "Incluye dashboard, seguimiento, asesoría más completa, análisis y acompañamiento continuo."],
            ["Business", "A medida", "Para empresas que necesitan flujos personalizados, CRM, WhatsApp, reportes y automatizaciones avanzadas."],
          ].map(([plan, precio, texto]) => (
            <div key={plan} className="rounded-3xl border border-cyan-400/20 bg-[#091633] p-8">
              <h3 className="text-3xl font-black text-cyan-300">{plan}</h3>
              <p className="mt-6 text-4xl font-black">{precio}</p>
              <p className="mt-5 leading-relaxed text-slate-300">{texto}</p>
              <a href="#diagnostico" className="mt-8 block rounded-2xl bg-cyan-400 px-6 py-4 text-center font-black text-slate-950">
                Elegir plan
              </a>
            </div>
          ))}
        </div>
      </section>

      <section id="diagnostico" className="mx-auto max-w-5xl px-6 py-24">
        <div className="rounded-[2rem] border border-cyan-400/20 bg-[#091633] p-8 md:p-12">
          <p className="font-bold text-cyan-300">DIAGNÓSTICO GRATUITO</p>
          <h2 className="mt-4 text-5xl font-black">Contanos qué necesitás mejorar</h2>
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-slate-300">
            Completá tus datos y EOS va a registrar tu solicitud para iniciar el análisis.
            Esta es la primera etapa para entender tu situación y recomendarte el mejor camino.
          </p>

          <div className="mt-10 grid gap-4">
            <input className="rounded-2xl border border-white/10 bg-white/10 p-4 outline-none" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <input className="rounded-2xl border border-white/10 bg-white/10 p-4 outline-none" placeholder="WhatsApp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            <input className="rounded-2xl border border-white/10 bg-white/10 p-4 outline-none" placeholder="Empresa, negocio o situación personal" value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
            <textarea className="min-h-32 rounded-2xl border border-white/10 bg-white/10 p-4 outline-none" placeholder="¿Cuál es tu principal problema o qué querés mejorar?" value={problema} onChange={(e) => setProblema(e.target.value)} />

            <button onClick={enviarLead} disabled={enviando} className="rounded-2xl bg-cyan-400 px-6 py-4 font-black text-slate-950 disabled:opacity-60">
              {enviando ? "Enviando..." : "Solicitar diagnóstico gratuito"}
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