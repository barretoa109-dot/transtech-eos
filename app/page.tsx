"use client";

import { useState } from "react";

export default function Home() {
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [problema, setProblema] = useState("");

  async function enviarLead() {
    try {
      const response = await fetch(
        "https://transtechsrl.app.n8n.cloud/webhook-test/whatsapp-in",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre,
            whatsapp,
            empresa,
            problema,
            origen: "Web TransTech EOS",
          }),
        }
      );

      if (!response.ok) throw new Error("Error al enviar");

      alert("Solicitud enviada correctamente");
      setNombre("");
      setWhatsapp("");
      setEmpresa("");
      setProblema("");
    } catch (error: any) {
      alert(error.message);
      console.log(error);
    }
  }

  return (
    <main className="min-h-screen bg-[#020617] text-white">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#020617]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="text-xl font-bold tracking-tight">
            TransTech <span className="text-cyan-400">EOS</span>
          </div>

          <div className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#soluciones" className="hover:text-white">Soluciones</a>
            <a href="#funciona" className="hover:text-white">Cómo funciona</a>
            <a href="#planes" className="hover:text-white">Planes</a>
            <a href="#diagnostico" className="hover:text-white">Diagnóstico</a>
<a
  href="/login"
  className="hover:text-white"
>
  Acceder al sistema
</a>
          </div>

          <a
            href="#diagnostico"
            className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-bold text-slate-950"
          >
            Empezar
          </a>
        </div>
      </nav>

      <section className="relative overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-cyan-500/20 blur-[120px]" />

        <div className="relative mx-auto max-w-7xl px-6 py-24">
          <div className="max-w-4xl">
            <p className="mb-5 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-300">
              Consultoría + IA + Automatización
            </p>

            <h1 className="text-5xl font-black tracking-tight md:text-7xl">
              Tu sistema inteligente para crecer con más orden, control y claridad.
            </h1>

            <p className="mt-8 max-w-2xl text-xl leading-8 text-slate-300">
              TransTech EOS ayuda a personas, emprendedores y empresas a
              diagnosticar problemas, crear planes de acción y automatizar
              procesos para crecer de forma sostenible.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <a
                href="#diagnostico"
                className="rounded-full bg-cyan-400 px-8 py-4 text-center font-bold text-slate-950"
              >
                Solicitar diagnóstico gratuito
              </a>

              <a
                href="#planes"
                className="rounded-full border border-white/15 px-8 py-4 text-center font-bold text-white hover:bg-white/10"
              >
                Ver planes
              </a>
            </div>
          </div>

          <div className="mt-20 grid gap-4 md:grid-cols-4">
            {[
              ["Diagnóstico", "Detectamos problemas reales."],
              ["Estrategia", "Creamos planes claros."],
              ["Automatización", "Reducimos tareas manuales."],
              ["Seguimiento", "Acompañamos el avance."],
            ].map(([title, text]) => (
              <div
                key={title}
                className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur"
              >
                <h3 className="font-bold text-cyan-300">{title}</h3>
                <p className="mt-2 text-sm text-slate-400">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="soluciones" className="mx-auto max-w-7xl px-6 py-24">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-sm font-bold uppercase tracking-widest text-cyan-400">
            Soluciones
          </p>
          <h2 className="text-4xl font-black">
            Diseñado para negocios y personas que quieren avanzar.
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {[
            ["Personas físicas", "Finanzas personales, deudas, metas, organización y toma de mejores decisiones."],
            ["Emprendedores", "Validación de ideas, estructura inicial, ventas, procesos y control financiero."],
            ["Empresas", "Automatización, CRM, atención al cliente, reportes y optimización operativa."],
            ["Comercios", "Control de ventas, inventario, clientes recurrentes y seguimiento comercial."],
            ["Profesionales", "Agenda, captación de clientes, propuestas, cobros y automatización administrativa."],
            ["Equipos", "Procesos internos, indicadores, tareas, documentación y productividad."],
          ].map(([title, text]) => (
            <div
              key={title}
              className="rounded-3xl border border-white/10 bg-slate-900/60 p-7 transition hover:border-cyan-400/40"
            >
              <h3 className="text-2xl font-bold">{title}</h3>
              <p className="mt-4 leading-7 text-slate-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="funciona" className="border-y border-white/10 bg-white/[0.03]">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-bold uppercase tracking-widest text-cyan-400">
              Cómo funciona
            </p>
            <h2 className="text-4xl font-black">
              Un proceso simple, guiado y orientado a resultados.
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-5">
            {[
              ["01", "Contás tu situación"],
              ["02", "EOS analiza el caso"],
              ["03", "Recibís diagnóstico"],
              ["04", "Creamos un plan"],
              ["05", "Seguimos tu avance"],
            ].map(([num, text]) => (
              <div key={num} className="rounded-3xl bg-slate-950 p-6">
                <p className="text-sm font-bold text-cyan-400">{num}</p>
                <h3 className="mt-4 text-lg font-bold">{text}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="planes" className="mx-auto max-w-7xl px-6 py-24">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-sm font-bold uppercase tracking-widest text-cyan-400">
            Planes
          </p>
          <h2 className="text-4xl font-black">
            Opciones accesibles para empezar y escalar.
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-4">
          {[
            ["Gratis", "0", "Diagnóstico inicial y primeras recomendaciones."],
            ["Inicio", "Gs. 99.000", "Ideal para personas y emprendedores."],
            ["Pro", "Gs. 299.000", "Seguimiento, estrategia y automatización básica."],
            ["Business", "A medida", "Sistemas e IA para negocios en crecimiento."],
          ].map(([plan, price, desc]) => (
            <div
              key={plan}
              className={`rounded-3xl border p-7 ${
                plan === "Pro"
                  ? "border-cyan-400 bg-cyan-400 text-slate-950"
                  : "border-white/10 bg-slate-900/60"
              }`}
            >
              <h3 className="text-2xl font-black">{plan}</h3>
              <p className="mt-4 text-3xl font-black">{price}</p>
              <p
                className={`mt-4 leading-7 ${
                  plan === "Pro" ? "text-slate-800" : "text-slate-400"
                }`}
              >
                {desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="diagnostico" className="bg-white/[0.03] px-6 py-24">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-2">
          <div>
            <p className="mb-3 text-sm font-bold uppercase tracking-widest text-cyan-400">
              Diagnóstico gratuito
            </p>
            <h2 className="text-4xl font-black">
              Empezá con una conversación clara sobre tu situación actual.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-400">
              Dejanos tus datos y TransTech EOS analizará tu caso para detectar
              oportunidades de mejora, automatización o crecimiento.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950 p-8">
            <div className="space-y-4">
              <input
                className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 outline-none placeholder:text-slate-500"
                placeholder="Nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />

              <input
                className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 outline-none placeholder:text-slate-500"
                placeholder="WhatsApp"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
              />

              <input
                className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 outline-none placeholder:text-slate-500"
                placeholder="Empresa o actividad"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
              />

              <textarea
                className="min-h-32 w-full rounded-2xl border border-white/10 bg-white/5 p-4 outline-none placeholder:text-slate-500"
                placeholder="¿Qué te gustaría mejorar?"
                value={problema}
                onChange={(e) => setProblema(e.target.value)}
              />

              <button
                onClick={enviarLead}
                className="w-full rounded-2xl bg-cyan-400 px-8 py-4 font-black text-slate-950"
              >
                Enviar diagnóstico
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 py-8 text-center text-sm text-slate-500">
        © 2026 TransTech EOS · Grupo TransTech
      </footer>
    </main>
  );
}