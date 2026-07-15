"use client";

import Image from "next/image";
import { useState } from "react";
import { supabase } from "../lib/supabase";

const servicios = [
  {
    numero: "01",
    titulo: "Inteligencia Artificial",
    descripcion:
      "Diseñamos soluciones inteligentes que analizan información, acompañan decisiones y convierten datos en acciones concretas.",
  },
  {
    numero: "02",
    titulo: "Automatización",
    descripcion:
      "Conectamos procesos, sistemas y canales para reducir tareas manuales, errores operativos y tiempos de respuesta.",
  },
  {
    numero: "03",
    titulo: "Gestión empresarial",
    descripcion:
      "Creamos herramientas para organizar objetivos, tareas, finanzas, clientes, documentos y seguimiento.",
  },
  {
    numero: "04",
    titulo: "Transformación digital",
    descripcion:
      "Ayudamos a empresas y profesionales a modernizar su operación con tecnología práctica, escalable y medible.",
  },
];

const capacidadesEOS = [
  "Conversación ejecutiva y contextual",
  "Generación de documentos y archivos",
  "Memoria y continuidad entre conversaciones",
  "Objetivos, tareas y seguimiento",
  "Dashboard y métricas de progreso",
  "Automatización de procesos empresariales",
];

const metodologia = [
  {
    paso: "01",
    titulo: "Diagnóstico",
    texto: "Identificamos el problema real, las prioridades y las oportunidades.",
  },
  {
    paso: "02",
    titulo: "Estrategia",
    texto: "Diseñamos una solución clara, viable y alineada con los objetivos.",
  },
  {
    paso: "03",
    titulo: "Implementación",
    texto: "Construimos, conectamos y ponemos en funcionamiento la tecnología.",
  },
  {
    paso: "04",
    titulo: "Seguimiento",
    texto: "Medimos resultados, detectamos mejoras y acompañamos la evolución.",
  },
];

const sectores = [
  "Personas",
  "Emprendedores",
  "Profesionales",
  "Comercios",
  "Pymes",
  "Empresas",
];

const ventajasIntelligence = [
  {
    numero: "01",
    titulo: "Decisiones basadas en contexto",
    texto: "Información interpretada antes de ejecutar.",
  },
  {
    numero: "02",
    titulo: "Automatización inteligente",
    texto: "Menos tareas repetitivas y mayor productividad.",
  },
  {
    numero: "03",
    titulo: "Documentos en segundos",
    texto: "Archivos profesionales listos para utilizar.",
  },
  {
    numero: "04",
    titulo: "Información centralizada",
    texto: "Datos organizados, medibles y disponibles.",
  },
];

export default function Home() {
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [problema, setProblema] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviarLead() {
    if (!nombre.trim() || !whatsapp.trim() || !problema.trim()) {
      alert("Completá tu nombre, WhatsApp y principal necesidad.");
      return;
    }

    setEnviando(true);
    setEnviado(false);

    const { error } = await supabase.from("leads").insert([
      {
        nombre: nombre.trim(),
        whatsapp: whatsapp.trim(),
        empresa: empresa.trim(),
        problema: problema.trim(),
      },
    ]);

    setEnviando(false);

    if (error) {
      console.error(error);
      alert("No se pudo registrar la solicitud. Probá nuevamente.");
      return;
    }

    setNombre("");
    setWhatsapp("");
    setEmpresa("");
    setProblema("");
    setEnviado(true);
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#F7FAFC] text-[#071226]">
      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <a href="/" className="flex items-center gap-4">
  <div className="relative h-14 w-16 shrink-0">
    <Image
      src="/transtech-logo.png"
      alt="Logo oficial de TRANSTECH"
      fill
      priority
      sizes="64px"
      className="object-contain object-center mix-blend-multiply"
    />
  </div>

  <p className="text-[24px] font-black leading-none tracking-[-0.035em] text-[#071226]">
    TRANSTECH
  </p>
</a>

          <nav className="hidden items-center gap-8 text-sm font-bold text-slate-600 lg:flex">
            <a href="#empresa" className="transition hover:text-blue-600">
              Empresa
            </a>
            <a href="#servicios" className="transition hover:text-blue-600">
              Servicios
            </a>
            <a href="#eos" className="transition hover:text-blue-600">
              EOS
            </a>
            <a href="#metodologia" className="transition hover:text-blue-600">
              Metodología
            </a>
            <a href="#contacto" className="transition hover:text-blue-600">
              Contacto
            </a>
          </nav>

          <div className="flex items-center gap-2 md:gap-3">
            <a
              href="/login"
              className="hidden rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 shadow-sm transition hover:border-blue-300 sm:inline-flex"
            >
              Ingresar
            </a>

            <a
              href="/eos"
              className="rounded-full bg-[#071226] px-5 py-3 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Probar EOS
            </a>
          </div>
        </div>
      </header>

      {/* HERO */}
<section className="relative overflow-hidden border-b border-slate-200 bg-white">
  {/* Iluminación azul del fondo */}
  <div className="pointer-events-none absolute inset-0">
    <div className="absolute -left-40 bottom-[-180px] h-[650px] w-[650px] rounded-full bg-blue-500/25 blur-[110px]" />

    <div className="absolute -right-40 top-[-170px] h-[620px] w-[620px] rounded-full bg-blue-300/25 blur-[120px]" />

    <div className="absolute left-[38%] top-[20%] h-[480px] w-[480px] rounded-full bg-blue-100/25 blur-[130px]" />
  </div>

  {/* Logo gigante decorativo de fondo */}
  <div className="pointer-events-none absolute bottom-[70px] left-[-40px] hidden h-[520px] w-[570px] opacity-[0.055] lg:block">
    <Image
      src="/transtech-logo.png"
      alt=""
      fill
      priority
      sizes="570px"
      className="object-contain object-left mix-blend-multiply"
    />
  </div>

  <div className="relative mx-auto flex min-h-[740px] max-w-7xl items-center justify-center px-6 py-24 md:px-8 lg:min-h-[760px]">
    <div className="mx-auto flex w-full max-w-[930px] flex-col items-center text-center">
      <div className="inline-flex items-center rounded-full border border-blue-300 bg-white/85 px-5 py-2 text-xs font-black tracking-[0.16em] text-[#2563EB] shadow-sm backdrop-blur">
        EMPRESA PARAGUAYA DE TECNOLOGÍA
      </div>

      <h1 className="mt-9 text-[48px] font-black leading-[0.99] tracking-[-0.055em] text-[#071226] sm:text-6xl md:text-7xl lg:text-[74px]">
        Tecnología inteligente
        <br />
        para transformar
        <br />
        la forma de trabajar.
      </h1>

      <div className="mt-8 h-1 w-14 rounded-full bg-[#2563EB]" />

      <p className="mt-7 max-w-[760px] text-lg leading-8 text-slate-600 md:text-[20px] md:leading-9">
        En{" "}
        <strong className="font-black text-slate-700">
          TRANSTECH
        </strong>{" "}
        desarrollamos soluciones de inteligencia artificial, automatización y
        gestión para ayudar a personas y empresas a tomar mejores decisiones,
        optimizar procesos y crecer con mayor control.
      </p>

      <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <a
          href="#empresa"
          className="inline-flex min-w-[245px] items-center justify-center rounded-full bg-[#2563EB] px-8 py-4 font-black text-white shadow-[0_16px_35px_rgba(37,99,235,0.28)] transition duration-200 hover:-translate-y-1 hover:bg-[#1747C9]"
        >
          Conocer TRANSTECH
        </a>

        <a
          href="/eos"
          className="inline-flex min-w-[190px] items-center justify-center rounded-full border border-slate-200 bg-white px-8 py-4 font-black text-[#071226] shadow-[0_10px_25px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-1 hover:border-blue-300"
        >
          Probar EOS
        </a>
      </div>
    </div>
  </div>
</section>

      {/* TRANSTECH INTELLIGENCE */}
      <section className="bg-white py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <div className="relative overflow-hidden rounded-[2.8rem] border border-blue-100 bg-gradient-to-br from-white via-[#F3F7FF] to-[#DCEAFF] shadow-[0_30px_80px_rgba(37,99,235,0.13)]">
            <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-blue-400/20 blur-3xl" />
            <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-blue-200/30 blur-3xl" />

            <div className="relative grid gap-12 p-8 md:p-14 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
              <div>
                <div className="relative h-24 w-36 overflow-hidden md:h-28 md:w-44">
                  <Image
                    src="/transtech-logo.png"
                    alt="Logo de TRANSTECH Intelligence"
                    fill
                    className="object-contain object-left mix-blend-multiply"
                  />
                </div>

                <div className="mt-7 inline-flex items-center gap-3 rounded-full border border-blue-200 bg-white/80 px-4 py-2 shadow-sm backdrop-blur">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#2563EB] shadow-[0_0_12px_rgba(37,99,235,0.8)]" />

                  <p className="text-xs font-black tracking-[0.18em] text-[#2563EB]">
                    TRANSTECH INTELLIGENCE
                  </p>
                </div>

                <h2 className="mt-6 max-w-xl text-4xl font-black leading-[0.98] tracking-[-0.05em] text-slate-950 md:text-6xl">
                  Tecnología que entiende, ejecuta y mejora.
                </h2>

                <p className="mt-7 max-w-xl text-lg leading-8 text-slate-600">
                  Un ecosistema tecnológico diseñado para interpretar
                  necesidades, automatizar operaciones y convertir información
                  en decisiones concretas.
                </p>

                <div className="mt-8 flex items-center gap-4">
                  <div className="h-px w-16 bg-blue-500" />

                  <p className="text-sm font-black uppercase tracking-[0.12em] text-blue-700">
                    Inteligencia aplicada
                  </p>
                </div>
              </div>

              <div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {ventajasIntelligence.map((item) => (
                    <article
                      key={item.numero}
                      className="group rounded-[1.7rem] border border-white/80 bg-white/85 p-6 shadow-[0_12px_30px_rgba(15,23,42,0.07)] backdrop-blur transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl"
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 font-black text-[#2563EB]">
                          ✓
                        </span>

                        <span className="text-xs font-black tracking-widest text-slate-300">
                          {item.numero}
                        </span>
                      </div>

                      <h3 className="mt-6 text-lg font-black leading-6 text-slate-950">
                        {item.titulo}
                      </h3>

                      <p className="mt-3 text-sm leading-6 text-slate-500">
                        {item.texto}
                      </p>
                    </article>
                  ))}
                </div>

                <div className="relative mt-5 overflow-hidden rounded-[1.7rem] bg-gradient-to-r from-[#2563EB] to-[#1747C9] p-6 text-white shadow-xl shadow-blue-500/20">
                  <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full border border-white/20" />

                  <p className="relative text-lg font-black leading-7">
                    No desarrollamos tecnología para impresionar.
                  </p>

                  <p className="relative mt-2 leading-7 text-blue-100">
                    La desarrollamos para resolver problemas reales, producir
                    resultados y mejorar continuamente.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* EMPRESA */}
      <section id="empresa" className="bg-white py-24 md:py-32">
        <div className="mx-auto grid max-w-7xl gap-14 px-6 md:px-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-sm font-black tracking-[0.16em] text-blue-600">
              SOBRE NOSOTROS
            </p>

            <h2 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-6xl">
              Construimos tecnología con propósito empresarial.
            </h2>
          </div>

          <div className="space-y-6 text-lg leading-8 text-slate-600">
            <p>
              TRANSTECH es una empresa paraguaya enfocada en inteligencia
              artificial, automatización, gestión y transformación digital.
            </p>

            <p>
              Creamos soluciones que ayudan a ordenar información, reducir
              tareas manuales, generar documentos, controlar procesos y
              convertir objetivos en acciones medibles.
            </p>

            <p>
              Nuestra visión es acercar tecnología de alto nivel a personas,
              profesionales, emprendimientos y empresas de Paraguay,
              Latinoamérica y mercados internacionales.
            </p>

            <div className="grid gap-4 pt-4 sm:grid-cols-2">
              <Valor
                titulo="Visión"
                texto="Tecnología útil, accesible y escalable."
              />
              <Valor
                titulo="Enfoque"
                texto="Resultados, control y ejecución."
              />
              <Valor
                titulo="Origen"
                texto="Empresa constituida en Paraguay."
              />
              <Valor titulo="Alcance" texto="Personas, pymes y empresas." />
            </div>
          </div>
        </div>
      </section>

      {/* SERVICIOS */}
      <section
        id="servicios"
        className="border-y border-slate-200 bg-[#F7FAFC] py-24 md:py-32"
      >
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <div className="max-w-4xl">
            <p className="text-sm font-black tracking-[0.16em] text-blue-600">
              QUÉ HACEMOS
            </p>

            <h2 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-6xl">
              Soluciones para trabajar mejor, decidir antes y crecer con
              control.
            </h2>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-2">
            {servicios.map((servicio) => (
              <article
                key={servicio.numero}
                className="group rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl md:p-9"
              >
                <div className="flex items-start justify-between gap-6">
                  <span className="text-sm font-black text-blue-600">
                    {servicio.numero}
                  </span>

                  <span className="text-2xl text-slate-300 transition group-hover:text-blue-600">
                    ↗
                  </span>
                </div>

                <h3 className="mt-12 text-3xl font-black tracking-tight text-slate-950">
                  {servicio.titulo}
                </h3>

                <p className="mt-4 max-w-xl leading-7 text-slate-600">
                  {servicio.descripcion}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* EOS */}
      <section id="eos" className="bg-[#071226] py-24 text-white md:py-32">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 md:px-8 lg:grid-cols-2">
          <div>
            <div className="inline-flex rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-xs font-black tracking-[0.16em] text-blue-300">
              PRODUCTO ESTRELLA
            </div>

            <h2 className="mt-7 text-5xl font-black tracking-[-0.05em] md:text-7xl">
              EOS
            </h2>

            <p className="mt-3 text-xl font-black text-blue-300">
              El sistema operativo ejecutivo de TRANSTECH.
            </p>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
              EOS combina conversación, inteligencia artificial, documentos,
              memoria, tareas, objetivos, seguimiento y dashboards dentro de
              una sola experiencia.
            </p>

            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
              No es solamente un chat. Es una plataforma diseñada para
              acompañar decisiones y ejecutar acciones concretas.
            </p>

            <div className="mt-9 flex flex-wrap gap-4">
              <a
                href="/eos"
                className="rounded-full bg-[#2563EB] px-8 py-4 font-black text-white transition hover:bg-blue-700"
              >
                Abrir EOS
              </a>

              <a
                href="/login"
                className="rounded-full border border-white/15 px-8 py-4 font-black text-white transition hover:border-blue-400"
              >
                Iniciar sesión
              </a>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {capacidadesEOS.map((capacidad, index) => (
              <div
                key={capacidad}
                className="rounded-[1.7rem] border border-white/10 bg-white/5 p-6"
              >
                <span className="text-sm font-black text-blue-300">
                  0{index + 1}
                </span>

                <p className="mt-8 text-lg font-black leading-7">
                  {capacidad}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* METODOLOGÍA */}
      <section id="metodologia" className="bg-white py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-sm font-black tracking-[0.16em] text-blue-600">
              CÓMO TRABAJAMOS
            </p>

            <h2 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-6xl">
              De un problema real a una solución medible.
            </h2>
          </div>

          <div className="mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {metodologia.map((item) => (
              <div
                key={item.paso}
                className="rounded-[2rem] border border-slate-200 bg-[#F8FBFF] p-7"
              >
                <span className="text-sm font-black text-blue-600">
                  {item.paso}
                </span>

                <h3 className="mt-10 text-2xl font-black text-slate-950">
                  {item.titulo}
                </h3>

                <p className="mt-4 leading-7 text-slate-600">{item.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTORES */}
      <section className="border-y border-slate-200 bg-[#F7FAFC] py-24">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="text-sm font-black tracking-[0.16em] text-blue-600">
                PARA QUIÉNES
              </p>

              <h2 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-6xl">
                Tecnología adaptable a distintas etapas y necesidades.
              </h2>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                TRANSTECH desarrolla soluciones tanto para quien necesita
                organizar sus finanzas personales como para empresas que buscan
                automatizar procesos completos.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {sectores.map((sector) => (
                <div
                  key={sector}
                  className="flex min-h-28 items-center justify-center rounded-[1.7rem] border border-slate-200 bg-white p-5 text-center font-black text-slate-900 shadow-sm"
                >
                  {sector}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CONTACTO */}
      <section id="contacto" className="bg-white py-24 md:py-32">
        <div className="mx-auto grid max-w-7xl gap-14 px-6 md:px-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-sm font-black tracking-[0.16em] text-blue-600">
              CONTACTO
            </p>

            <h2 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-6xl">
              Contanos qué querés mejorar.
            </h2>

            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
              Analizaremos tu situación y te indicaremos qué solución de
              TRANSTECH o EOS puede generar mayor impacto.
            </p>}
          </div>

              <p className="mt-5 leading-7 text-slate-300">
                Inteligencia artificial, automatización y gestión para personas
                y empresas.
              </p>
            </div>
          </div>

          <div className="rounded-[2.4rem] border border-slate-200 bg-[#F8FBFF] p-7 shadow-xl shadow-slate-900/5 md:p-10">
            <div className="grid gap-4">
              <Campo
                placeholder="Nombre y apellido"
                value={nombre}
                onChange={setNombre}
              />

              <Campo
                placeholder="WhatsApp"
                value={whatsapp}
                onChange={setWhatsapp}
              />

              <Campo
                placeholder="Empresa, negocio o profesión"
                value={empresa}
                onChange={setEmpresa}
              />

              <textarea
                className="min-h-36 rounded-2xl border border-slate-200 bg-white p-4 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                placeholder="¿Cuál es tu principal problema o qué querés mejorar?"
                value={problema}
                onChange={(event) => setProblema(event.target.value)}
              />

              <button
                type="button"
                onClick={enviarLead}
                disabled={enviando}
                className="rounded-2xl bg-[#2563EB] px-6 py-4 font-black text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enviando
                  ? "Enviando solicitud..."
                  : "Solicitar diagnóstico"}
              </button>

              {enviado && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-700">
                  Solicitud registrada correctamente. TRANSTECH se pondrá en
                  contacto contigo.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#071226] px-6 py-14 text-white">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 border-b border-white/10 pb-12 md:grid-cols-[1.5fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-5">
                <div className="flex h-16 w-20 items-center justify-center rounded-xl bg-white p-2">
                  <div className="relative h-full w-full">
                    <Image
                      src="/transtech-logo.png"
                      alt="Logo de TRANSTECH"
                      fill
                      className="object-contain"
                    />
                  </div>
                </div>

                <div>
                  <p className="text-2xl font-black tracking-tight">
                    TRANSTECH
                  </p>

                  <p className="mt-1 text-xs font-bold tracking-[0.15em] text-blue-300">
                    INTELLIGENT TECHNOLOGY
                  </p>
                </div>
              </div>

              <p className="mt-5 max-w-md leading-7 text-slate-400">
                Tecnología, inteligencia artificial y automatización para
                transformar la forma en que personas y empresas trabajan.
              </p>
            </div>

            <div>
              <p className="font-black text-blue-300">Empresa</p>

              <div className="mt-4 grid gap-3 text-slate-400">
                <a href="#empresa" className="transition hover:text-white">
                  Sobre nosotros
                </a>
                <a href="#servicios" className="transition hover:text-white">
                  Servicios
                </a>
                <a href="#metodologia" className="transition hover:text-white">
                  Metodología
                </a>
                <a href="#contacto" className="transition hover:text-white">
                  Contacto
                </a>
              </div>
            </div>

            <div>
              <p className="font-black text-blue-300">Productos</p>

              <div className="mt-4 grid gap-3 text-slate-400">
                <a href="#eos" className="transition hover:text-white">
                  EOS
                </a>
                <a href="/eos" className="transition hover:text-white">
                  Abrir EOS
                </a>
                <a href="/login" className="transition hover:text-white">
                  Iniciar sesión
                </a>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-8 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
            <p>© 2026 TRANSTECH. Todos los derechos reservados.</p>
            <p>Asunción, Paraguay</p>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Campo({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Dato({ valor, texto }: { valor: string; texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      <p className="text-2xl font-black leading-none text-slate-950 md:text-3xl">
        {valor}
      </p>

      <p className="mt-3 text-xs font-black tracking-wide text-slate-400 md:text-sm">
        {texto}
      </p>
    </div>
  );
}

function Valor({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-[#F8FBFF] p-5">
      <p className="font-black text-slate-950">{titulo}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{texto}</p>
    </div>
  );
}