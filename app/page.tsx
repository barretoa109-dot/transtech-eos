"use client";

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
    <main className="min-h-screen overflow-x-hidden bg-[#f7fafc] text-[#071226]">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <a href="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#071226] text-lg font-black text-cyan-300">
              T
            </div>

            <div>
              <p className="text-lg font-black leading-none tracking-tight">
                TRANSTECH
              </p>
              <p className="mt-1 text-[10px] font-black tracking-[0.22em] text-slate-400">
                E.A.S.
              </p>
            </div>
          </a>

          <nav className="hidden items-center gap-8 text-sm font-bold text-slate-600 lg:flex">
            <a href="#empresa" className="transition hover:text-cyan-600">
              Empresa
            </a>
            <a href="#servicios" className="transition hover:text-cyan-600">
              Servicios
            </a>
            <a href="#eos" className="transition hover:text-cyan-600">
              EOS
            </a>
            <a href="#metodologia" className="transition hover:text-cyan-600">
              Metodología
            </a>
            <a href="#contacto" className="transition hover:text-cyan-600">
              Contacto
            </a>
          </nav>

          <div className="flex items-center gap-2 md:gap-3">
            <a
              href="/login"
              className="hidden rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 shadow-sm transition hover:border-cyan-300 sm:inline-flex"
            >
              Ingresar
            </a>

            <a
              href="/eos"
              className="rounded-full bg-[#071226] px-5 py-3 text-sm font-black text-white shadow-lg transition hover:bg-slate-800"
            >
              Probar EOS
            </a>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-slate-200">
        <div className="absolute left-[-140px] top-[-100px] h-[420px] w-[420px] rounded-full bg-cyan-300/25 blur-3xl" />
        <div className="absolute bottom-[-160px] right-[-120px] h-[460px] w-[460px] rounded-full bg-blue-300/20 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 py-24 md:px-8 md:py-32 lg:grid-cols-[1.15fr_.85fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white px-4 py-2 text-xs font-black tracking-[0.12em] text-cyan-700 shadow-sm">
              EMPRESA PARAGUAYA DE TECNOLOGÍA
            </div>

            <h1 className="mt-7 max-w-4xl text-5xl font-black leading-[0.96] tracking-[-0.055em] text-slate-950 md:text-7xl">
              Tecnología inteligente para transformar la forma de trabajar.
            </h1>

            <p className="mt-7 max-w-3xl text-lg leading-8 text-slate-600 md:text-xl">
              En TRANSTECH E.A.S. desarrollamos soluciones de inteligencia
              artificial, automatización y gestión para ayudar a personas y
              empresas a tomar mejores decisiones, optimizar procesos y crecer
              con mayor control.
            </p>

            <div className="mt-9 flex flex-wrap gap-4">
              <a
                href="#eos"
                className="rounded-full bg-cyan-400 px-8 py-4 font-black text-slate-950 shadow-xl shadow-cyan-400/25 transition hover:-translate-y-0.5"
              >
                Conocer EOS
              </a>

              <a
                href="#empresa"
                className="rounded-full border border-slate-200 bg-white px-8 py-4 font-black text-slate-900 shadow-sm transition hover:border-cyan-300"
              >
                Conocer TRANSTECH
              </a>
            </div>

            <div className="mt-12 grid max-w-2xl grid-cols-3 gap-4 border-t border-slate-200 pt-7">
              <Dato valor="IA" texto="aplicada" />
              <Dato valor="24/7" texto="disponibilidad" />
              <Dato valor="360°" texto="gestión" />
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 translate-x-6 translate-y-6 rounded-[2.4rem] bg-cyan-300/30 blur-2xl" />

            <div className="relative rounded-[2.4rem] border border-white bg-white p-4 shadow-2xl shadow-slate-900/10">
              <div className="rounded-[2rem] bg-[#071226] p-7 text-white md:p-9">
                <div className="flex items-start justify-between gap-5">
                  <div>
                    <p className="text-xs font-black tracking-[0.18em] text-cyan-300">
                      TRANSTECH INTELLIGENCE
                    </p>
                    <h2 className="mt-3 text-3xl font-black tracking-tight">
                      Tecnología que entiende, ejecuta y mejora.
                    </h2>
                  </div>

                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-cyan-400 text-xl font-black text-slate-950">
                    T
                  </div>
                </div>

                <div className="mt-8 grid gap-3">
                  {[
                    "Decisiones basadas en contexto",
                    "Automatización de tareas repetitivas",
                    "Documentos generados en segundos",
                    "Información centralizada y medible",
                  ].map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-400/15 font-black text-cyan-300">
                        ✓
                      </span>
                      <p className="font-bold text-slate-100">{item}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-7 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-5">
                  <p className="text-sm leading-6 text-cyan-100">
                    No desarrollamos tecnología para impresionar. La
                    desarrollamos para resolver problemas reales.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="empresa" className="bg-white py-24 md:py-32">
        <div className="mx-auto grid max-w-7xl gap-14 px-6 md:px-8 lg:grid-cols-[.85fr_1.15fr]">
          <div>
            <p className="text-sm font-black tracking-[0.16em] text-cyan-600">
              SOBRE NOSOTROS
            </p>

            <h2 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-6xl">
              Construimos tecnología con propósito empresarial.
            </h2>
          </div>

          <div className="space-y-6 text-lg leading-8 text-slate-600">
            <p>
              TRANSTECH E.A.S. es una empresa paraguaya enfocada en
              inteligencia artificial, automatización, gestión y transformación
              digital.
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
              <Valor titulo="Visión" texto="Tecnología útil, accesible y escalable." />
              <Valor titulo="Enfoque" texto="Resultados, control y ejecución." />
              <Valor titulo="Origen" texto="Empresa constituida en Paraguay." />
              <Valor titulo="Alcance" texto="Personas, pymes y empresas." />
            </div>
          </div>
        </div>
      </section>

      <section id="servicios" className="border-y border-slate-200 bg-[#f7fafc] py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <div className="max-w-4xl">
            <p className="text-sm font-black tracking-[0.16em] text-cyan-600">
              QUÉ HACEMOS
            </p>

            <h2 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-6xl">
              Soluciones para trabajar mejor, decidir antes y crecer con control.
            </h2>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-2">
            {servicios.map((servicio) => (
              <article
                key={servicio.numero}
                className="group rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-cyan-300 hover:shadow-xl md:p-9"
              >
                <div className="flex items-start justify-between gap-6">
                  <span className="text-sm font-black text-cyan-600">
                    {servicio.numero}
                  </span>

                  <span className="text-2xl text-slate-300 transition group-hover:text-cyan-500">
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

      <section id="eos" className="bg-[#071226] py-24 text-white md:py-32">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 md:px-8 lg:grid-cols-2">
          <div>
            <div className="inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-black tracking-[0.16em] text-cyan-300">
              PRODUCTO ESTRELLA
            </div>

            <h2 className="mt-7 text-5xl font-black tracking-[-0.05em] md:text-7xl">
              EOS
            </h2>

            <p className="mt-3 text-xl font-black text-cyan-300">
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
                className="rounded-full bg-cyan-400 px-8 py-4 font-black text-slate-950 transition hover:bg-cyan-300"
              >
                Abrir EOS
              </a>

              <a
                href="/login"
                className="rounded-full border border-white/15 px-8 py-4 font-black text-white transition hover:border-cyan-300"
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
                <span className="text-sm font-black text-cyan-300">
                  0{index + 1}
                </span>
                <p className="mt-8 text-lg font-black leading-7">{capacidad}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="metodologia" className="bg-white py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-sm font-black tracking-[0.16em] text-cyan-600">
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
                className="rounded-[2rem] border border-slate-200 bg-[#f8fbff] p-7"
              >
                <span className="text-sm font-black text-cyan-600">
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

      <section className="border-y border-slate-200 bg-[#f7fafc] py-24">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="text-sm font-black tracking-[0.16em] text-cyan-600">
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

      <section id="contacto" className="bg-white py-24 md:py-32">
        <div className="mx-auto grid max-w-7xl gap-14 px-6 md:px-8 lg:grid-cols-[.85fr_1.15fr]">
          <div>
            <p className="text-sm font-black tracking-[0.16em] text-cyan-600">
              CONTACTO
            </p>

            <h2 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-6xl">
              Contanos qué querés mejorar.
            </h2>

            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
              Analizaremos tu situación y te indicaremos qué solución de
              TRANSTECH o EOS puede generar mayor impacto.
            </p>

            <div className="mt-10 rounded-[2rem] bg-[#071226] p-7 text-white">
              <p className="text-sm font-black text-cyan-300">
                TRANSTECH E.A.S.
              </p>
              <p className="mt-4 leading-7 text-slate-300">
                Inteligencia artificial, automatización y gestión para personas
                y empresas.
              </p>
            </div>
          </div>

          <div className="rounded-[2.4rem] border border-slate-200 bg-[#f8fbff] p-7 shadow-xl shadow-slate-900/5 md:p-10">
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
                className="min-h-36 rounded-2xl border border-slate-200 bg-white p-4 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                placeholder="¿Cuál es tu principal problema o qué querés mejorar?"
                value={problema}
                onChange={(event) => setProblema(event.target.value)}
              />

              <button
                type="button"
                onClick={enviarLead}
                disabled={enviando}
                className="rounded-2xl bg-cyan-400 px-6 py-4 font-black text-slate-950 shadow-lg shadow-cyan-400/20 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enviando ? "Enviando solicitud..." : "Solicitar diagnóstico"}
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

      <footer className="bg-[#071226] px-6 py-14 text-white">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 border-b border-white/10 pb-12 md:grid-cols-[1.5fr_1fr_1fr]">
            <div>
              <p className="text-2xl font-black">TRANSTECH E.A.S.</p>
              <p className="mt-4 max-w-md leading-7 text-slate-400">
                Tecnología, inteligencia artificial y automatización para
                transformar la forma en que personas y empresas trabajan.
              </p>
            </div>

            <div>
              <p className="font-black text-cyan-300">Empresa</p>
              <div className="mt-4 grid gap-3 text-slate-400">
                <a href="#empresa">Sobre nosotros</a>
                <a href="#servicios">Servicios</a>
                <a href="#metodologia">Metodología</a>
                <a href="#contacto">Contacto</a>
              </div>
            </div>

            <div>
              <p className="font-black text-cyan-300">Productos</p>
              <div className="mt-4 grid gap-3 text-slate-400">
                <a href="#eos">EOS</a>
                <a href="/eos">Abrir EOS</a>
                <a href="/login">Iniciar sesión</a>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-8 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
            <p>© 2026 TRANSTECH E.A.S. Todos los derechos reservados.</p>
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
      className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Dato({ valor, texto }: { valor: string; texto: string }) {
  return (
    <div>
      <p className="text-xl font-black text-slate-950 md:text-2xl">{valor}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">
        {texto}
      </p>
    </div>
  );
}

function Valor({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-[#f8fbff] p-5">
      <p className="font-black text-slate-950">{titulo}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{texto}</p>
    </div>
  );
}