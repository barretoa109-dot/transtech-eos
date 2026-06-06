"use client";

import { useState } from "react";

export default function Home() {
  const [form, setForm] = useState({
    nombre: "",
    whatsapp: "",
    tipo: "",
    problema: "",
  });

  const whatsappLink =
    "https://wa.me/595982226912?text=Hola%20TransTech%20EOS%2C%20quiero%20solicitar%20un%20diagn%C3%B3stico%20gratuito.";

  const irLogin = () => {
    window.location.href = "/login";
  };

  const irEOS = () => {
    window.location.href = "/eos";
  };

  const enviarDiagnostico = () => {
    alert("Solicitud recibida. TransTech EOS te contactará para iniciar el diagnóstico.");
  };

  return (
    <main className="min-h-screen bg-[#020617] text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#020617]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="text-2xl font-black">
            TransTech <span className="text-cyan-400">EOS</span>
          </div>

          <nav className="hidden gap-8 text-sm font-bold md:flex">
            <a href="#soluciones">Soluciones</a>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#enfoque">Enfoque</a>
            <a href="#proposito">Propósito</a>
            <a href="#planes">Planes</a>
          </nav>

          <div className="flex gap-3">
            <button onClick={irLogin} className="rounded-full border border-white/15 px-5 py-3 font-bold">
              Ingresar
            </button>
            <button onClick={irEOS} className="rounded-full bg-cyan-400 px-5 py-3 font-black text-[#020617]">
              Chat EOS
            </button>
            <a href={whatsappLink} className="rounded-full bg-emerald-400 px-5 py-3 font-black text-[#020617]">
              WhatsApp
            </a>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 lg:grid-cols-2">
        <div>
          <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-5 py-2 text-sm font-bold text-cyan-300">
            Consultoría + IA + Automatización
          </span>

          <h1 className="mt-8 text-5xl font-black leading-tight md:text-7xl">
            Tu sistema inteligente para crecer con más orden, control y claridad.
          </h1>

          <p className="mt-8 max-w-2xl text-xl leading-relaxed text-slate-300">
            TransTech EOS ayuda a personas, emprendedores y empresas a diagnosticar problemas,
            ordenar procesos, mejorar decisiones, automatizar tareas y crecer de forma rentable
            y sostenible.
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <a href="#diagnostico" className="rounded-full bg-cyan-400 px-8 py-4 font-black text-[#020617]">
              Solicitar diagnóstico gratuito
            </a>
            <a href="#planes" className="rounded-full border border-white/15 px-8 py-4 font-bold">
              Ver planes
            </a>
          </div>
        </div>

        <div className="rounded-[32px] border border-cyan-400/20 bg-[#091633] p-8">
          <p className="font-bold text-cyan-300">Sistema EOS</p>
          <h2 className="mt-4 text-4xl font-black">
            Diagnóstico, gestión y automatización para avanzar paso a paso.
          </h2>

          <div className="mt-8 space-y-4">
            {[
              "Análisis del negocio o situación personal",
              "Chat inteligente conectado a EOS",
              "Dashboard con objetivos, avances y próximos pasos",
              "Automatización de tareas, respuestas y seguimiento",
              "Acompañamiento por WhatsApp",
            ].map((item) => (
              <div key={item} className="rounded-2xl bg-white/7 p-4 text-slate-200">
                ✓ {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="soluciones" className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-center text-5xl font-black">Qué hace TransTech EOS</h2>
        <p className="mx-auto mt-6 max-w-3xl text-center text-xl text-slate-300">
          EOS no es solo una web. Es un sistema de diagnóstico, gestión y seguimiento diseñado para ayudarte
          a ordenar tu realidad actual y convertirla en un plan de crecimiento.
        </p>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            ["Diagnóstico", "Detectamos problemas reales, puntos débiles, fugas de dinero, falta de procesos y oportunidades ocultas."],
            ["Gestión", "Organizamos objetivos, tareas, prioridades, clientes, finanzas y seguimiento de avances."],
            ["Automatización", "Creamos flujos con IA, WhatsApp, respuestas automáticas, recordatorios y reportes."],
            ["Finanzas", "Ayudamos a ordenar ingresos, gastos, presupuesto, deudas, rentabilidad y decisiones económicas."],
            ["Crecimiento", "Construimos un plan para mejorar ventas, eficiencia, atención al cliente y estabilidad."],
            ["Acompañamiento", "EOS guía al usuario paso a paso, sin importar si recién empieza o si ya tiene un negocio funcionando."],
          ].map(([title, text]) => (
            <div key={title} className="rounded-3xl border border-cyan-400/15 bg-[#091633] p-8">
              <h3 className="text-2xl font-black text-cyan-300">{title}</h3>
              <p className="mt-4 text-slate-300">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-center text-5xl font-black">Cómo funciona</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-4">
          {[
            ["1", "Diagnóstico inicial", "Conocemos tu situación actual, tus problemas y tus objetivos."],
            ["2", "Plan de acción", "EOS define prioridades, tareas y pasos claros para avanzar."],
            ["3", "Dashboard y seguimiento", "Visualizás avances, objetivos, próximos pasos y estado general."],
            ["4", "Automatización", "Implementamos procesos para ahorrar tiempo, ordenar y vender mejor."],
          ].map(([num, title, text]) => (
            <div key={num} className="rounded-3xl bg-white/5 p-7">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-400 font-black text-[#020617]">
                {num}
              </div>
              <h3 className="text-xl font-black">{title}</h3>
              <p className="mt-3 text-slate-300">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="enfoque" className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-center text-5xl font-black">En qué nos enfocamos</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            ["Crecimiento sostenible", "Que puedas avanzar sin depender del desorden ni de decisiones improvisadas."],
            ["Rentabilidad", "Mejorar ingresos, controlar costos y entender qué realmente genera valor."],
            ["Orden financiero", "Presupuesto, control de gastos, objetivos y salud financiera."],
            ["Procesos claros", "Convertir tareas repetidas en sistemas simples y medibles."],
            ["Mejor atención al cliente", "Responder mejor, dar seguimiento y no perder oportunidades."],
            ["Automatización inteligente", "Usar IA para ahorrar tiempo y aumentar productividad."],
          ].map(([title, text]) => (
            <div key={title} className="rounded-3xl bg-[#091633] p-8">
              <h3 className="text-2xl font-black text-cyan-300">{title}</h3>
              <p className="mt-4 text-slate-300">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="proposito" className="mx-auto max-w-6xl px-6 py-20 text-center">
        <div className="rounded-[36px] border border-cyan-400/20 bg-[#091633] p-10 md:p-16">
          <h2 className="text-5xl font-black">Nuestro propósito</h2>
          <p className="mx-auto mt-8 max-w-4xl text-xl leading-relaxed text-slate-300">
            Nuestro objetivo es que cada cliente pueda crecer de forma rentable, ordenada y sostenida
            con el tiempo. No importa si está empezando, si tiene problemas, si necesita organizar sus
            finanzas personales o si quiere escalar una empresa: EOS busca darle claridad, estructura,
            seguimiento y herramientas reales para salir adelante.
          </p>
        </div>
      </section>

      <section id="planes" className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-center text-5xl font-black">Planes</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-4">
          {[
            ["Free", "Gs. 0", "5 mensajes gratis para probar EOS.", ["Acceso inicial", "Chat limitado", "Prueba del sistema"]],
            ["Inicial", "Gs. 99.000/mes", "Ideal para personas, emprendedores y pequeños negocios.", ["Diagnóstico", "Dashboard básico", "Seguimiento inicial"]],
            ["Pro", "Gs. 250.000/mes", "Para quienes quieren más control, gestión y automatización.", ["Dashboard completo", "Chat EOS", "Seguimiento", "Automatizaciones"]],
            ["Business", "A medida", "Para empresas que necesitan soluciones personalizadas.", ["CRM", "WhatsApp", "Flujos IA", "Automatización avanzada"]],
          ].map(([name, price, desc, features]: any) => (
            <div key={name} className="rounded-3xl border border-cyan-400/20 bg-[#091633] p-8">
              <h3 className="text-3xl font-black text-cyan-300">{name}</h3>
              <p className="mt-6 text-4xl font-black">{price}</p>
              <p className="mt-5 text-slate-300">{desc}</p>
              <ul className="mt-6 space-y-2 text-slate-300">
                {features.map((f: string) => (
                  <li key={f}>✓ {f}</li>
                ))}
              </ul>
              <a href={whatsappLink} className="mt-8 block rounded-2xl bg-cyan-400 py-4 text-center font-black text-[#020617]">
                Elegir plan
              </a>
            </div>
          ))}
        </div>
      </section>

      <section id="diagnostico" className="mx-auto max-w-5xl px-6 py-24">
        <div className="rounded-[36px] border border-cyan-400/20 bg-[#091633] p-10">
          <h2 className="text-center text-5xl font-black">Solicitá tu diagnóstico gratuito</h2>
          <p className="mx-auto mt-5 max-w-3xl text-center text-slate-300">
            Completá tus datos y contanos qué necesitás mejorar. EOS puede ayudarte a ordenar,
            diagnosticar y construir un plan de acción.
          </p>

          <div className="mt-10 grid gap-4">
            <input className="rounded-2xl bg-white/10 p-4 outline-none" placeholder="Nombre" onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            <input className="rounded-2xl bg-white/10 p-4 outline-none" placeholder="WhatsApp" onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
            <input className="rounded-2xl bg-white/10 p-4 outline-none" placeholder="Persona física, emprendimiento o empresa" onChange={(e) => setForm({ ...form, tipo: e.target.value })} />
            <textarea className="min-h-32 rounded-2xl bg-white/10 p-4 outline-none" placeholder="¿Cuál es tu principal problema o meta?" onChange={(e) => setForm({ ...form, problema: e.target.value })} />

            <button onClick={enviarDiagnostico} className="rounded-2xl bg-cyan-400 py-4 font-black text-[#020617]">
              Enviar diagnóstico
            </button>

            <a href={whatsappLink} className="rounded-2xl bg-emerald-400 py-4 text-center font-black text-[#020617]">
              Hablar por WhatsApp
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-10 text-center text-slate-400">
        TransTech EOS - Grupo TransTech
      </footer>
    </main>
  );
}