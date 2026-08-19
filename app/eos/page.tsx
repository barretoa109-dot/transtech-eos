"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import AmbientBackground from "@/components/effects/AmbientBackground";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  Database,
  FileSpreadsheet,
  FolderKanban,
  Menu,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
  X,
  Zap,
} from "lucide-react";

const capacidades = [
  {
    numero: "01",
    titulo: "Conversación con contexto",
    texto:
      "EOS comprende el objetivo, conserva la continuidad y responde con criterio ejecutivo.",
    icono: MessageSquareText,
  },
  {
    numero: "02",
    titulo: "Documentos y archivos",
    texto:
      "Genera Excel y prepara reportes, presupuestos, análisis y otros entregables.",
    icono: FileSpreadsheet,
  },
  {
    numero: "03",
    titulo: "Memoria inteligente",
    texto:
      "Conserva preferencias, proyectos, objetivos y datos relevantes para próximas conversaciones.",
    icono: Database,
  },
  {
    numero: "04",
    titulo: "Objetivos y seguimiento",
    texto:
      "Convierte decisiones en tareas, registra avances y mantiene visible el próximo paso.",
    icono: Target,
  },
  {
    numero: "05",
    titulo: "Dashboard ejecutivo",
    texto:
      "Centraliza progreso, actividad, métricas, prioridades y recomendaciones en una sola vista.",
    icono: BarChart3,
  },
  {
    numero: "06",
    titulo: "Automatización operativa",
    texto:
      "Conecta conversación, datos y procesos para ejecutar acciones sin trabajo manual repetitivo.",
    icono: Workflow,
  },
];

const funcionamiento = [
  {
    numero: "01",
    titulo: "Entiende",
    texto: "Interpreta el mensaje actual, la intención y el contexto relevante.",
    icono: BrainCircuit,
  },
  {
    numero: "02",
    titulo: "Decide",
    texto: "Distingue entre responder, generar un archivo o ejecutar una acción.",
    icono: FolderKanban,
  },
  {
    numero: "03",
    titulo: "Ejecuta",
    texto: "Activa el proceso correspondiente y produce un resultado concreto.",
    icono: Zap,
  },
  {
    numero: "04",
    titulo: "Registra",
    texto: "Guarda información, avances y actividad para mantener continuidad.",
    icono: Database,
  },
];

const ejemplos = [
  {
    pedido: "Generame un Excel para controlar mi negocio.",
    resultado:
      "EOS prepara una planilla profesional con ingresos, gastos, resultado y estructura de control.",
    tipo: "Archivo Excel",
  },
  {
    pedido: "Organizá mis objetivos para este mes.",
    resultado:
      "EOS estructura la meta, define acciones, registra tareas y mantiene el seguimiento.",
    tipo: "Plan de ejecución",
  },
  {
    pedido: "Recordá que prefiero reportes breves.",
    resultado:
      "EOS guarda esa preferencia y la aplica cuando vuelve a resultar relevante.",
    tipo: "Memoria activa",
  },
];

const comparacion = [
  {
    capacidad: "Responder preguntas",
    asistente: true,
    eos: true,
  },
  {
    capacidad: "Mantener contexto operativo",
    asistente: false,
    eos: true,
  },
  {
    capacidad: "Generar archivos en el chat",
    asistente: false,
    eos: true,
  },
  {
    capacidad: "Administrar objetivos y tareas",
    asistente: false,
    eos: true,
  },
  {
    capacidad: "Conectar dashboard y seguimiento",
    asistente: false,
    eos: true,
  },
  {
    capacidad: "Ejecutar acciones estructuradas",
    asistente: false,
    eos: true,
  },
];

const indicadores = [
  {
    valor: "24/7",
    etiqueta: "Disponibilidad",
  },
  {
    valor: "1",
    etiqueta: "Entorno centralizado",
  },
  {
    valor: "100%",
    etiqueta: "Enfoque ejecutivo",
  },
];

export default function EOSLandingPage() {
  const [menuAbierto, setMenuAbierto] = useState(false);

  function cerrarMenu() {
    setMenuAbierto(false);
  }

  return (
    <main
      data-eos-theme="light"
      className="relative min-h-screen overflow-x-hidden bg-white text-[#071226]"
      style={{ fontFamily: "var(--font-inter)" }}
    >
      <AmbientBackground spanCount={3} />

      <div className="relative z-10">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-2xl">
        <div className="mx-auto flex min-h-[76px] max-w-7xl items-center justify-between px-5 md:px-8">
          <Link
            href="/"
            onClick={cerrarMenu}
            className="flex items-center gap-3"
          >
            <div className="relative h-11 w-12 shrink-0">
              <Image
                src="/transtech-logo.png"
                alt="Logo de TRANSTECH"
                fill
                priority
                sizes="48px"
                className="object-contain mix-blend-multiply"
              />
            </div>

            <div>
              <p className="text-[17px] font-black tracking-[-0.035em] text-slate-950">
                TRANSTECH
              </p>

              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#1656bd] shadow-[0_0_10px_rgba(37,99,235,0.7)]" />

                <p className="text-[9px] font-black tracking-[0.24em] text-[#1656bd]">
                  EOS
                </p>
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-bold text-slate-600 lg:flex">
            <a
              href="#que-es"
              className="transition hover:text-[#1656bd]"
            >
              Qué es
            </a>

            <a
              href="#funciona"
              className="transition hover:text-[#1656bd]"
            >
              Cómo funciona
            </a>

            <a
              href="#capacidades"
              className="transition hover:text-[#1656bd]"
            >
              Capacidades
            </a>

            <a
              href="#comparacion"
              className="transition hover:text-[#1656bd]"
            >
              Diferencias
            </a>
          </nav>

          <div className="hidden items-center gap-3 sm:flex">
            <Link
              href="/"
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-800 shadow-sm transition hover:border-[#a9c6ee] hover:text-[#1656bd]"
            >
              TRANSTECH
            </Link>

            <Link
              href="/login"
              className="group inline-flex items-center gap-2 rounded-full bg-[#1656bd] px-5 py-3 text-sm font-black text-white shadow-lg shadow-[#2f72d6]/20 transition hover:-translate-y-0.5 hover:bg-[#113f8c]"
            >
              Probar EOS
              <ArrowRight
                size={16}
                className="transition group-hover:translate-x-0.5"
              />
            </Link>
          </div>

          <button
            type="button"
            aria-label={menuAbierto ? "Cerrar menú" : "Abrir menú"}
            onClick={() => setMenuAbierto((actual) => !actual)}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm lg:hidden"
          >
            {menuAbierto ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>

        {menuAbierto ? (
          <div className="border-t border-slate-200 bg-white px-5 py-5 shadow-xl lg:hidden">
            <nav className="mx-auto grid max-w-7xl gap-2">
              <MobileLink
                href="#que-es"
                label="Qué es EOS"
                onClick={cerrarMenu}
              />

              <MobileLink
                href="#funciona"
                label="Cómo funciona"
                onClick={cerrarMenu}
              />

              <MobileLink
                href="#capacidades"
                label="Capacidades"
                onClick={cerrarMenu}
              />

              <MobileLink
                href="#comparacion"
                label="Diferencias"
                onClick={cerrarMenu}
              />

              <Link
                href="/login"
                onClick={cerrarMenu}
                className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#1656bd] px-5 font-black text-white"
              >
                Probar EOS
                <ArrowRight size={17} />
              </Link>
            </nav>
          </div>
        ) : null}
      </header>

      <section className="relative overflow-hidden border-b border-slate-200 bg-transparent">
        <BackgroundGrid />

        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-56 bottom-[-250px] h-[650px] w-[650px] rounded-full bg-[#2f72d6]/20 blur-[130px]" />
          <div className="absolute -right-48 top-[-230px] h-[680px] w-[680px] rounded-full bg-[#6fa3e8]/20 blur-[140px]" />
        </div>

        <div className="relative mx-auto grid min-h-[760px] max-w-7xl items-center gap-16 px-6 py-20 md:px-8 md:py-24 lg:grid-cols-[0.94fr_1.06fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#a9c6ee] bg-white/85 px-4 py-2 text-[11px] font-black tracking-[0.15em] text-[#113f8c] shadow-sm backdrop-blur-xl">
              <Sparkles size={14} />
              PRODUCTO ESTRELLA DE TRANSTECH
            </div>

            <h1 className="mt-8 max-w-3xl break-words text-4xl font-black leading-[0.96] tracking-[-0.06em] text-slate-950 sm:text-5xl md:text-7xl">
              Un sistema que entiende, decide y{" "}
              <span className="bg-gradient-to-r from-[#113f8c] via-[#1656bd] to-[#113f8c] bg-clip-text text-transparent">
                ejecuta.
              </span>
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600 md:text-xl">
              EOS es el sistema operativo ejecutivo de TRANSTECH.
              Conversa con contexto, genera archivos, organiza objetivos,
              conserva información y conecta cada interacción con acciones
              reales.
            </p>

            <div className="mt-9 flex flex-wrap gap-4">
              <Link
                href="/login"
                className="group inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-[#1656bd] px-8 font-black text-white shadow-xl shadow-[#2f72d6]/25 transition hover:-translate-y-0.5 hover:bg-[#113f8c]"
              >
                Probar EOS
                <ArrowRight
                  size={18}
                  className="transition group-hover:translate-x-1"
                />
              </Link>

              <a
                href="#funciona"
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-8 font-black text-slate-900 shadow-sm transition hover:border-[#6fa3e8] hover:text-[#1656bd]"
              >
                Ver cómo funciona
                <ChevronRight size={18} />
              </a>
            </div>

            <div className="mt-9 grid max-w-xl grid-cols-3 gap-3">
              {indicadores.map((item) => (
                <div
                  key={item.etiqueta}
                  className="rounded-2xl border border-white/80 bg-white/65 p-4 shadow-sm backdrop-blur-xl"
                >
                  <p className="text-xl font-black tracking-[-0.03em] text-slate-950">
                    {item.valor}
                  </p>

                  <p className="mt-1 text-[10px] font-bold leading-4 text-slate-500">
                    {item.etiqueta}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <DemoEOS />
        </div>
      </section>

      <section
        id="que-es"
        className="scroll-mt-24 bg-white py-24 md:py-32"
      >
        <div className="mx-auto grid max-w-7xl items-center gap-16 px-6 md:px-8 lg:grid-cols-[0.78fr_1.22fr]">
          <div>
            <SectionLabel>QUÉ ES EOS</SectionLabel>

            <h2 className="mt-5 text-4xl font-black tracking-[-0.05em] text-slate-950 md:text-6xl">
              Mucho más que una conversación.
            </h2>
          </div>

          <div>
            <div className="space-y-6 text-lg leading-8 text-slate-600">
              <p>
                EOS combina un motor conversacional con una capa de
                ejecución. Primero entiende lo que el usuario necesita y
                después decide si debe responder, generar un archivo,
                registrar una tarea, guardar información o consultar datos.
              </p>

              <p>
                La experiencia permanece natural mientras el sistema
                trabaja detrás, conectando memoria, documentos, objetivos,
                seguimiento y métricas.
              </p>
            </div>

            <div className="mt-9 grid gap-4 sm:grid-cols-3">
              <Mini
                icono={<BrainCircuit size={20} />}
                titulo="Comprende"
                texto="Mensaje, intención y contexto."
              />

              <Mini
                icono={<Zap size={20} />}
                titulo="Ejecuta"
                texto="Acciones y entregables concretos."
              />

              <Mini
                icono={<Clock3 size={20} />}
                titulo="Continúa"
                texto="Memoria, seguimiento y progreso."
              />
            </div>
          </div>
        </div>
      </section>

      <section
        id="funciona"
        className="scroll-mt-24 border-y border-slate-200 bg-[#f6f9fe] py-24 md:py-32"
      >
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <SectionHeading
            label="CÓMO FUNCIONA"
            title="Una conversación. Un proceso completo."
            description="EOS transforma una necesidad expresada naturalmente en una decisión, una acción y un resultado verificable."
            centered
          />

          <div className="relative mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <div className="pointer-events-none absolute left-[12%] right-[12%] top-9 hidden h-px bg-gradient-to-r from-transparent via-[#6fa3e8] to-transparent lg:block" />

            {funcionamiento.map((item) => {
              const Icono = item.icono;

              return (
                <article
                  key={item.numero}
                  className="group relative rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-[#a9c6ee] hover:shadow-xl hover:shadow-blue-950/5"
                >
                  <div className="flex items-center justify-between">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[#dbe7f9] bg-[#eef3fb] text-[#1656bd] transition group-hover:bg-[#1656bd] group-hover:text-white">
                      <Icono size={25} />
                    </div>

                    <span className="text-sm font-black text-[#1656bd]">
                      {item.numero}
                    </span>
                  </div>

                  <h3 className="mt-9 text-2xl font-black tracking-[-0.03em] text-slate-950">
                    {item.titulo}
                  </h3>

                  <p className="mt-4 leading-7 text-slate-600">
                    {item.texto}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="capacidades"
        className="relative scroll-mt-24 overflow-hidden bg-[#071226] py-24 text-white md:py-32"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-60 top-0 h-[550px] w-[550px] rounded-full bg-[#1656bd]/15 blur-[130px]" />
          <div className="absolute -right-52 bottom-[-160px] h-[600px] w-[600px] rounded-full bg-[#113f8c]/10 blur-[140px]" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 md:px-8">
          <SectionHeading
            label="CAPACIDADES"
            title="Diseñado para acompañar y producir resultados."
            description="Cada capacidad forma parte de un mismo sistema conectado, no de herramientas aisladas."
            dark
          />

          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {capacidades.map((item) => {
              const Icono = item.icono;

              return (
                <article
                  key={item.numero}
                  className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.055] p-7 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-[#6fa3e8]/30 hover:bg-white/[0.08]"
                >
                  <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#2f72d6]/10 blur-3xl transition group-hover:bg-[#2f72d6]/20" />

                  <div className="relative flex items-center justify-between">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[#6fa3e8]/15 bg-[#2f72d6]/10 text-[#6fa3e8]">
                      <Icono size={25} />
                    </div>

                    <span className="text-sm font-black text-[#6fa3e8]">
                      {item.numero}
                    </span>
                  </div>

                  <h3 className="relative mt-9 text-2xl font-black tracking-[-0.03em]">
                    {item.titulo}
                  </h3>

                  <p className="relative mt-4 leading-7 text-slate-300">
                    {item.texto}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-white py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <SectionHeading
            label="EJEMPLOS REALES"
            title="Pedidos simples. Entregables concretos."
            description="El usuario conversa naturalmente. EOS organiza el proceso necesario detrás de cada respuesta."
          />

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {ejemplos.map((item, index) => (
              <article
                key={item.pedido}
                className="group flex min-h-[390px] flex-col rounded-[2rem] border border-slate-200 bg-[#f8fbff] p-7 transition duration-300 hover:-translate-y-1 hover:border-[#a9c6ee] hover:shadow-xl hover:shadow-slate-900/5"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-[#dbe7f9] bg-[#eef3fb] px-3 py-1 text-[10px] font-black tracking-[0.1em] text-[#1656bd]">
                    {item.tipo.toUpperCase()}
                  </span>

                  <span className="text-sm font-black text-slate-300">
                    0{index + 1}
                  </span>
                </div>

                <div className="mt-8 flex items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#1656bd] text-white">
                    <MessageSquareText size={17} />
                  </div>

                  <div>
                    <p className="text-[10px] font-black tracking-[0.13em] text-[#1656bd]">
                      USUARIO
                    </p>

                    <p className="mt-3 text-xl font-black leading-8 tracking-[-0.025em] text-slate-950">
                      “{item.pedido}”
                    </p>
                  </div>
                </div>

                <div className="my-7 h-px bg-slate-200" />

                <div className="mt-auto rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center gap-2">
                    <Sparkles size={15} className="text-[#1656bd]" />

                    <p className="text-[10px] font-black tracking-[0.13em] text-slate-400">
                      RESPUESTA EOS
                    </p>
                  </div>

                  <p className="mt-3 leading-7 text-slate-600">
                    {item.resultado}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="comparacion"
        className="scroll-mt-24 border-y border-slate-200 bg-[#f6f9fe] py-24 md:py-32"
      >
        <div className="mx-auto max-w-5xl px-6 md:px-8">
          <SectionHeading
            label="DIFERENCIA PRINCIPAL"
            title="Conversar es solo el comienzo."
            description="EOS no se limita a producir texto. Conecta cada conversación con información, procesos y ejecución."
            centered
          />

          <div className="mt-14 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
            <div className="grid grid-cols-[1.5fr_.75fr_.75fr] bg-[#071226] px-5 py-5 text-xs font-black text-white sm:px-7 sm:text-sm">
              <span>Capacidad</span>

              <span className="text-center text-slate-400">
                Asistente
              </span>

              <span className="text-center text-[#6fa3e8]">
                EOS
              </span>
            </div>

            {comparacion.map((item) => (
              <div
                key={item.capacidad}
                className="grid grid-cols-[1.5fr_.75fr_.75fr] items-center border-t border-slate-100 px-5 py-5 sm:px-7"
              >
                <span className="pr-3 text-sm font-bold text-slate-700 sm:text-base">
                  {item.capacidad}
                </span>

                <ComparisonValue enabled={item.asistente} muted />

                <ComparisonValue enabled={item.eos} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6 md:px-8">
          <div className="relative overflow-hidden rounded-[2.7rem] bg-[#071226] px-7 py-16 text-center text-white shadow-2xl md:px-14 md:py-20">
            <div className="absolute -left-20 bottom-[-120px] h-72 w-72 rounded-full bg-[#2f72d6]/25 blur-3xl" />
            <div className="absolute -right-20 top-[-120px] h-72 w-72 rounded-full bg-[#2f72d6]/20 blur-3xl" />

            <div className="relative">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-[#6fa3e8]/20 bg-[#2f72d6]/10 text-[#6fa3e8]">
                <Sparkles size={29} />
              </div>

              <p className="mt-7 text-sm font-black tracking-[0.16em] text-[#6fa3e8]">
                EMPEZÁ CON EOS
              </p>

              <h2 className="mx-auto mt-5 max-w-4xl text-4xl font-black tracking-[-0.05em] md:text-6xl">
                Trabajá con un sistema que no solo responde.
              </h2>

              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                Convertí una necesidad en una acción, un documento o un
                próximo paso claro desde una sola conversación.
              </p>

              <Link
                href="/login"
                className="group mt-9 inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-[#1656bd] px-9 font-black text-white shadow-xl shadow-[#2f72d6]/25 transition hover:-translate-y-0.5 hover:bg-[#113f8c]"
              >
                Probar EOS
                <ArrowRight
                  size={18}
                  className="transition group-hover:translate-x-1"
                />
              </Link>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm font-bold text-slate-400">
                <TrustItem label="Memoria conectada" />
                <TrustItem label="Datos protegidos" />
                <TrustItem label="Ejecución centralizada" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-6 py-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-7 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="relative h-10 w-11 shrink-0">
              <Image
                src="/transtech-logo.png"
                alt="Logo de TRANSTECH"
                fill
                sizes="44px"
                className="object-contain mix-blend-multiply"
              />
            </div>

            <div>
              <p className="font-black tracking-[-0.025em] text-slate-950">
                TRANSTECH EOS
              </p>

              <p className="mt-1 text-xs text-slate-500">
                Sistema operativo ejecutivo.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-500">
            <Link
              href="/"
              className="font-bold transition hover:text-[#1656bd]"
            >
              TRANSTECH
            </Link>

            <Link
              href="/login"
              className="font-bold transition hover:text-[#1656bd]"
            >
              Iniciar sesión
            </Link>

            <a
              href="#que-es"
              className="font-bold transition hover:text-[#1656bd]"
            >
              Producto
            </a>
          </div>
        </div>
      </footer>
      </div>
    </main>
  );
}

function DemoEOS() {
  return (
    <div className="relative">
      <div className="absolute inset-0 translate-x-8 translate-y-10 rounded-[2.7rem] bg-[#2f72d6]/20 blur-3xl" />

      <div className="relative overflow-hidden rounded-[2.6rem] border border-white/90 bg-white/75 p-3 shadow-2xl shadow-slate-900/20 backdrop-blur-2xl md:p-4">
        <div className="overflow-hidden rounded-[2.1rem] bg-[#071226] text-white">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-5 md:px-7">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-[#6fa3e8]/20 bg-[#2f72d6]/10 text-[#6fa3e8]">
                <BrainCircuit size={23} />
              </div>

              <div>
                <p className="text-[10px] font-black tracking-[0.15em] text-[#6fa3e8]">
                  TRANSTECH EOS
                </p>

                <p className="mt-1 text-sm font-black sm:text-base">
                  Executive Operating System
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-black text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,0.8)]" />
              ACTIVO
            </span>
          </div>

          <div className="relative p-5 md:p-7">
            <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-[#2f72d6]/10 blur-3xl" />

            <div className="relative space-y-4">
              <div className="ml-auto max-w-[86%] rounded-2xl rounded-br-md bg-[#1656bd] p-4 text-sm leading-6 shadow-lg shadow-blue-950/20">
                Generame un Excel para controlar los ingresos y gastos de
                mi negocio.
              </div>

              <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.055] p-4 text-sm leading-6 text-slate-200">
                Perfecto. Voy a preparar una planilla financiera con
                ingresos, gastos, resultado y estructura de control.
              </div>

              <div className="max-w-[94%] overflow-hidden rounded-2xl border border-blue-400/25 bg-[#2f72d6]/10">
                <div className="border-b border-[#6fa3e8]/10 px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] font-black tracking-[0.12em] text-[#6fa3e8]">
                    <CircleCheck size={14} />
                    ARCHIVO GENERADO
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
                      <FileSpreadsheet size={22} />
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-black">
                        control_financiero.xlsx
                      </p>

                      <p className="mt-1 text-[10px] text-slate-400">
                        Listo para descargar
                      </p>
                    </div>
                  </div>

                  <span className="shrink-0 rounded-xl bg-[#1656bd] px-4 py-2 text-[10px] font-black">
                    Descargar
                  </span>
                </div>
              </div>
            </div>

            <div className="relative mt-6 grid grid-cols-3 gap-2 border-t border-white/10 pt-5">
              <DemoStatus
                icono={<Database size={15} />}
                label="Memoria"
                value="Activa"
              />

              <DemoStatus
                icono={<Target size={15} />}
                label="Objetivo"
                value="Detectado"
              />

              <DemoStatus
                icono={<ShieldCheck size={15} />}
                label="Sistema"
                value="Seguro"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoStatus({
  icono,
  label,
  value,
}: {
  icono: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center gap-1.5 text-[#6fa3e8]">
        {icono}

        <span className="text-[9px] font-black uppercase tracking-[0.08em]">
          {label}
        </span>
      </div>

      <p className="mt-2 truncate text-[10px] font-bold text-slate-300">
        {value}
      </p>
    </div>
  );
}

function Mini({
  icono,
  titulo,
  texto,
}: {
  icono: React.ReactNode;
  titulo: string;
  texto: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-[#f8fbff] p-5 transition hover:border-[#a9c6ee] hover:bg-[#eef3fb]/40">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#eef3fb] text-[#1656bd]">
        {icono}
      </div>

      <p className="mt-4 font-black text-slate-950">{titulo}</p>

      <p className="mt-2 text-sm leading-6 text-slate-500">
        {texto}
      </p>
    </div>
  );
}

function SectionLabel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <p className="inline-flex items-center gap-2 text-sm font-black tracking-[0.16em] text-[#1656bd]">
      <span className="h-2 w-2 rounded-full bg-[#1656bd]" />
      {children}
    </p>
  );
}

function SectionHeading({
  label,
  title,
  description,
  centered = false,
  dark = false,
}: {
  label: string;
  title: string;
  description?: string;
  centered?: boolean;
  dark?: boolean;
}) {
  return (
    <div
      className={
        centered
          ? "mx-auto max-w-4xl text-center"
          : "max-w-4xl"
      }
    >
      <p
        className={`text-sm font-black tracking-[0.16em] ${
          dark ? "text-[#6fa3e8]" : "text-[#1656bd]"
        }`}
      >
        {label}
      </p>

      <h2
        className={`mt-5 text-4xl font-black tracking-[-0.05em] md:text-6xl ${
          dark ? "text-white" : "text-slate-950"
        }`}
      >
        {title}
      </h2>

      {description ? (
        <p
          className={`mt-6 text-lg leading-8 ${
            dark ? "text-slate-300" : "text-slate-600"
          }`}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

function ComparisonValue({
  enabled,
  muted = false,
}: {
  enabled: boolean;
  muted?: boolean;
}) {
  return (
    <span className="flex justify-center">
      {enabled ? (
        <span
          className={`grid h-8 w-8 place-items-center rounded-full ${
            muted
              ? "bg-slate-100 text-slate-400"
              : "bg-[#eef3fb] text-[#1656bd]"
          }`}
        >
          <Check size={17} strokeWidth={3} />
        </span>
      ) : (
        <span className="text-xl font-black text-slate-300">—</span>
      )}
    </span>
  );
}

function TrustItem({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CircleCheck size={16} className="text-emerald-400" />
      {label}
    </span>
  );
}

function MobileLink({
  href,
  label,
  onClick,
}: {
  href: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="flex min-h-12 items-center justify-between rounded-2xl px-4 font-bold text-slate-700 transition hover:bg-[#eef3fb] hover:text-[#1656bd]"
    >
      {label}
      <ChevronRight size={17} />
    </a>
  );
}

function BackgroundGrid() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-[0.32]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(15,23,42,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.055) 1px, transparent 1px)",
        backgroundSize: "42px 42px",
        maskImage:
          "linear-gradient(to bottom, black, transparent 88%)",
      }}
    />
  );
}