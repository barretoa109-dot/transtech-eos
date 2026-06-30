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
    <main className="min-h-screen bg-[#f6fbff] text-[#071226]">
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <a href="/" className="text-2xl font-black tracking-tight">
            TransTech <span className="text-cyan-500">EOS</span>
          </a>

          <div className="hidden items-center gap-8 text-sm font-bold text-slate-700 md:flex">
            <a href="#personas">Personas</a>
            <a href="#empresas">Empresas</a>
            <a href="#documentos">Documentos</a>
            <a href="#planes">Planes</a>
            <a href="#diagnostico">Diagnóstico</a>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/login"
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 shadow-sm"
            >
              Ingresar
            </a>

            <a
              href="/eos"
              className="rounded-full bg-[#071226] px-5 py-3 text-sm font-black text-white shadow-lg"
            >
              Abrir EOS
            </a>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-cyan-300/30 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2 md:py-32">
          <div>
            <div className="mb-6 inline-flex rounded-full border border-cyan-200 bg-white px-5 py-2 text-sm font-black text-cyan-700 shadow-sm">
              IA + gestión + documentos + seguimiento
            </div>

            <h1 className="text-5xl font-black leading-[0.95] tracking-tight text-slate-950 md:text-7xl">
              El sistema inteligente para ordenar tu vida, negocio o empresa.
            </h1>

            <p className="mt-7 max-w-2xl text-xl leading-relaxed text-slate-600">
              TransTech EOS ayuda a personas físicas, emprendedores y empresas a diagnosticar problemas,
              crear planes, generar documentos profesionales, medir avances y tomar mejores decisiones.
            </p>

            <div className="mt-9 flex flex-wrap gap-4">
              <a
                href="#diagnostico"
                className="rounded-full bg-cyan-400 px-8 py-4 font-black text-slate-950 shadow-xl shadow-cyan-400/30"
              >
                Probar diagnóstico gratis
              </a>

              <a
                href="/eos"
                className="rounded-full border border-slate-200 bg-white px-8 py-4 font-black text-slate-900 shadow-sm"
              >
                Ir al chat EOS
              </a>
            </div>
          </div>

          <div className="rounded-[2.2rem] border border-white bg-white p-5 shadow-2xl shadow-cyan-900/10">
            <div className="rounded-[1.8rem] bg-[#071226] p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-black text-cyan-300">EOS DAILY BRIEFING</p>
                  <h3 className="mt-2 text-2xl font-black">Resumen inteligente</h3>
                </div>

                <div className="rounded-2xl bg-cyan-400 px-4 py-3 text-center text-slate-950">
                  <p className="text-2xl font-black">82</p>
                  <p className="text-xs font-black">Score</p>
                </div>
              </div>

              <div className="mt-7 grid gap-3">
                {[
                  "Detectar prioridad principal del día",
                  "Crear tareas y acciones recomendadas",
                  "Generar Excel profesional automáticamente",
                  "Recordar conversaciones y avances",
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-bold">{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-7 rounded-2xl bg-cyan-400/10 p-5 text-cyan-100">
                EOS no es solo un chat. Es un sistema operativo inteligente para avanzar con claridad.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="personas" className="mx-auto max-w-7xl px-6 py-20">
        <div className="grid gap-8 md:grid-cols-2">
          <FeatureBlock
            eyebrow="PARA PERSONAS FÍSICAS"
            title="Ordená tus finanzas, metas y decisiones personales."
            text="EOS puede ayudarte con presupuesto mensual, deudas, ahorro, organización personal, decisiones importantes, documentos y seguimiento."
            items={["Presupuesto personal", "Control de deudas", "Plan de ahorro", "Metas y tareas"]}
          />

          <FeatureBlock
            eyebrow="PARA NEGOCIOS Y EMPRESAS"
            title="Controlá ventas, clientes, gastos y crecimiento."
            text="EOS ayuda a emprendedores, comercios y empresas a ordenar procesos, medir resultados, generar reportes y automatizar tareas."
            items={["Dashboard", "Clientes", "Flujo de caja", "Documentos profesionales"]}
          />
        </div>
      </section>

      <section id="empresas" className="bg-white py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-center text-sm font-black text-cyan-600">QUÉ HACE EOS</p>
          <h2 className="mx-auto mt-4 max-w-4xl text-center text-5xl font-black tracking-tight text-slate-950">
            Todo lo que necesitás para avanzar, en un solo sistema.
          </h2>

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {[
              ["Diagnóstico inteligente", "Detecta el problema principal y define prioridades."],
              ["Daily Briefing", "Muestra qué necesita atención hoy."],
              ["Documentos premium", "Crea Excel, reportes y archivos listos para usar."],
              ["Dashboard", "Mide progreso, score, objetivos y tareas."],
              ["Automatizaciones", "Conecta procesos, WhatsApp y seguimiento."],
              ["Memoria EOS", "Recuerda contexto y acompaña el avance del usuario."],
            ].map(([title, text]) => (
              <div key={title} className="rounded-[2rem] border border-slate-100 bg-[#f8fbff] p-7">
                <h3 className="text-2xl font-black text-slate-950">{title}</h3>
                <p className="mt-4 leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="documentos" className="mx-auto max-w-7xl px-6 py-24">
        <div className="rounded-[2.4rem] bg-[#071226] p-8 text-white md:p-14">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <p className="text-sm font-black text-cyan-300">EOS DOCUMENTS</p>
              <h2 className="mt-4 text-5xl font-black tracking-tight">
                Archivos profesionales generados por IA.
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-slate-300">
                EOS puede generar documentos para personas físicas, emprendimientos y empresas:
                planillas financieras, dashboards, reportes, propuestas, presupuestos y más.
              </p>
            </div>

            <div className="grid gap-3">
              {[
                "Excel premium con dashboard",
                "Presupuesto personal",
                "Control financiero de negocio",
                "Recomendaciones inteligentes",
                "Preparado para futuras versiones PDF, Word y PowerPoint",
              ].map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-4 font-bold">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="planes" className="bg-white py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-center text-sm font-black text-cyan-600">PLANES</p>
          <h2 className="mt-4 text-center text-5xl font-black tracking-tight text-slate-950">
            Empezá simple. Escalá cuando lo necesites.
          </h2>

          <div className="mt-14 grid gap-5 md:grid-cols-4">
            {[
              ["Free", "Gs. 0", "5 mensajes gratis para probar EOS."],
              ["Inicial", "Gs. 99.000/mes", "Para personas y pequeños emprendimientos."],
              ["Pro", "Gs. 250.000/mes", "Dashboard, documentos y seguimiento."],
              ["Business", "A medida", "Automatizaciones, flujos y soporte avanzado."],
            ].map(([plan, price, desc]) => (
              <div key={plan} className="rounded-[2rem] border border-slate-100 bg-[#f8fbff] p-7 shadow-sm">
                <h3 className="text-2xl font-black text-slate-950">{plan}</h3>
                <p className="mt-5 text-3xl font-black text-cyan-600">{price}</p>
                <p className="mt-4 min-h-[72px] leading-relaxed text-slate-600">{desc}</p>
                <a
                  href="#diagnostico"
                  className="mt-7 block rounded-full bg-[#071226] px-6 py-4 text-center font-black text-white"
                >
                  Elegir plan
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="diagnostico" className="mx-auto max-w-5xl px-6 py-24">
        <div className="rounded-[2.4rem] border border-cyan-100 bg-white p-8 shadow-2xl shadow-cyan-900/10 md:p-12">
          <p className="text-sm font-black text-cyan-600">DIAGNÓSTICO GRATUITO</p>
          <h2 className="mt-4 text-5xl font-black tracking-tight text-slate-950">
            Contanos qué querés mejorar.
          </h2>
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-slate-600">
            Puede ser algo personal, financiero, operativo o empresarial. EOS registra tu solicitud
            y te ayuda a iniciar con claridad.
          </p>

          <div className="mt-10 grid gap-4">
            <input className="rounded-2xl border border-slate-200 bg-slate-50 p-4 outline-none" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <input className="rounded-2xl border border-slate-200 bg-slate-50 p-4 outline-none" placeholder="WhatsApp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            <input className="rounded-2xl border border-slate-200 bg-slate-50 p-4 outline-none" placeholder="Empresa, negocio o situación personal" value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
            <textarea className="min-h-32 rounded-2xl border border-slate-200 bg-slate-50 p-4 outline-none" placeholder="¿Cuál es tu principal problema o qué querés mejorar?" value={problema} onChange={(e) => setProblema(e.target.value)} />

            <button onClick={enviarLead} disabled={enviando} className="rounded-2xl bg-cyan-400 px-6 py-4 font-black text-slate-950 disabled:opacity-60">
              {enviando ? "Enviando..." : "Solicitar diagnóstico gratuito"}
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-6 py-10 text-center text-slate-500">
        TransTech EOS · Grupo TransTech
      </footer>
    </main>
  );
}

function FeatureBlock({
  eyebrow,
  title,
  text,
  items,
}: {
  eyebrow: string;
  title: string;
  text: string;
  items: string[];
}) {
  return (
    <div className="rounded-[2.4rem] border border-slate-100 bg-white p-8 shadow-xl shadow-cyan-900/5 md:p-10">
      <p className="text-sm font-black text-cyan-600">{eyebrow}</p>
      <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-950">{title}</h2>
      <p className="mt-5 text-lg leading-relaxed text-slate-600">{text}</p>

      <div className="mt-7 grid gap-3">
        {items.map((item) => (
          <div key={item} className="rounded-2xl bg-cyan-50 px-5 py-4 font-bold text-cyan-900">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}