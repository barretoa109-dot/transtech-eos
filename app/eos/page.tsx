"use client";

import Image from "next/image";

const capacidades = [
  {
    numero: "01",
    titulo: "Conversación con contexto",
    texto:
      "EOS comprende el objetivo del usuario, mantiene continuidad y responde con criterio ejecutivo.",
  },
  {
    numero: "02",
    titulo: "Documentos y archivos",
    texto:
      "Genera Excel y prepara la base para PDF, Word, reportes, presupuestos y otros entregables.",
  },
  {
    numero: "03",
    titulo: "Memoria inteligente",
    texto:
      "Conserva información relevante sobre preferencias, proyectos, objetivos y conversaciones.",
  },
  {
    numero: "04",
    titulo: "Objetivos y seguimiento",
    texto:
      "Convierte decisiones en tareas, registra avances y mantiene visible el próximo paso.",
  },
  {
    numero: "05",
    titulo: "Dashboard ejecutivo",
    texto:
      "Centraliza progreso, actividad, prioridades, métricas y recomendaciones en una sola vista.",
  },
  {
    numero: "06",
    titulo: "Automatización",
    texto:
      "Conecta conversación, datos y procesos para ejecutar acciones sin depender de tareas manuales.",
  },
];

const funcionamiento = [
  ["01", "Entiende", "Interpreta el mensaje actual y el contexto relevante."],
  ["02", "Decide", "Distingue entre conversar, generar un archivo o ejecutar una acción."],
  ["03", "Ejecuta", "Activa el proceso correspondiente y produce un resultado concreto."],
  ["04", "Registra", "Guarda información, avances y actividad para mantener continuidad."],
];

const ejemplos = [
  {
    pedido: "Generame un Excel para controlar mi negocio.",
    resultado: "EOS prepara el archivo y lo entrega en el mismo chat.",
  },
  {
    pedido: "Organizá mis objetivos para este mes.",
    resultado: "EOS estructura la meta, define tareas y registra el seguimiento.",
  },
  {
    pedido: "Recordá que prefiero reportes breves.",
    resultado: "EOS guarda esa preferencia y la utiliza cuando vuelve a ser relevante.",
  },
];

const comparacion = [
  ["Responder preguntas", true, true],
  ["Mantener contexto operativo", false, true],
  ["Generar archivos dentro del chat", false, true],
  ["Administrar objetivos y tareas", false, true],
  ["Conectar dashboard y seguimiento", false, true],
  ["Ejecutar acciones estructuradas", false, true],
];

export default function EOSLandingPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-[#071226]">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <a href="/" className="flex items-center gap-4">
            <div className="relative h-12 w-14 shrink-0">
              <Image
                src="/transtech-logo.png"
                alt="Logo de TRANSTECH"
                fill
                priority
                sizes="56px"
                className="object-contain mix-blend-multiply"
              />
            </div>
            <div>
              <p className="text-xl font-black tracking-[-0.03em]">TRANSTECH</p>
              <p className="mt-1 text-[10px] font-black tracking-[0.2em] text-blue-600">
                EOS
              </p>
            </div>
          </a>

          <nav className="hidden items-center gap-8 text-sm font-bold text-slate-600 lg:flex">
            <a href="#que-es" className="transition hover:text-blue-600">Qué es</a>
            <a href="#funciona" className="transition hover:text-blue-600">Cómo funciona</a>
            <a href="#capacidades" className="transition hover:text-blue-600">Capacidades</a>
            <a href="#comparacion" className="transition hover:text-blue-600">Diferencias</a>
          </nav>

          <div className="flex items-center gap-3">
            <a
              href="/"
              className="hidden rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-black shadow-sm sm:inline-flex"
            >
              TRANSTECH
            </a>
            <a
              href="/login"
              className="rounded-full bg-[#2563EB] px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-700"
            >
              Probar EOS
            </a>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-slate-200 bg-[#F7FAFC]">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-48 bottom-[-200px] h-[620px] w-[620px] rounded-full bg-blue-500/20 blur-[120px]" />
          <div className="absolute -right-48 top-[-190px] h-[640px] w-[640px] rounded-full bg-blue-300/25 blur-[130px]" />
        </div>

        <div className="relative mx-auto grid min-h-[760px] max-w-7xl items-center gap-14 px-6 py-24 md:px-8 lg:grid-cols-[0.92fr_1.08fr]">
          <div>
            <div className="inline-flex rounded-full border border-blue-200 bg-white/85 px-5 py-2 text-xs font-black tracking-[0.16em] text-blue-700 shadow-sm">
              PRODUCTO ESTRELLA DE TRANSTECH
            </div>

            <h1 className="mt-8 text-5xl font-black leading-[0.95] tracking-[-0.055em] text-slate-950 md:text-7xl">
              Un sistema que entiende, decide y ejecuta.
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600 md:text-xl">
              EOS es el sistema operativo ejecutivo de TRANSTECH. Conversa con contexto,
              genera archivos, organiza objetivos, conserva información relevante y conecta
              cada interacción con acciones reales.
            </p>

            <div className="mt-9 flex flex-wrap gap-4">
              <a
                href="/login"
                className="rounded-full bg-[#2563EB] px-8 py-4 font-black text-white shadow-xl shadow-blue-500/25 transition hover:-translate-y-0.5 hover:bg-blue-700"
              >
                Probar EOS
              </a>
              <a
                href="#funciona"
                className="rounded-full border border-slate-200 bg-white px-8 py-4 font-black text-slate-900 shadow-sm transition hover:border-blue-300"
              >
                Ver cómo funciona
              </a>
            </div>

            <p className="mt-5 text-sm font-bold text-slate-400">
              Experiencia web conectada con memoria, documentos y dashboard.
            </p>
          </div>

          <DemoEOS />
        </div>
      </section>

      <section id="que-es" className="bg-white py-24 md:py-32">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 md:px-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-black tracking-[0.16em] text-blue-600">QUÉ ES EOS</p>
            <h2 className="mt-5 text-4xl font-black tracking-[-0.045em] text-slate-950 md:text-6xl">
              Mucho más que una conversación.
            </h2>
          </div>

          <div className="space-y-6 text-lg leading-8 text-slate-600">
            <p>
              EOS combina un motor conversacional con una capa de ejecución. Primero entiende
              lo que el usuario necesita y después decide si debe responder, generar un archivo,
              registrar una tarea, guardar información o consultar datos.
            </p>
            <p>
              La experiencia permanece natural para el usuario, mientras el sistema trabaja detrás
              conectando memoria, documentos, objetivos, seguimiento y métricas.
            </p>

            <div className="grid gap-4 pt-3 sm:grid-cols-3">
              <Mini titulo="Comprende" texto="Mensaje y contexto" />
              <Mini titulo="Ejecuta" texto="Acciones concretas" />
              <Mini titulo="Continúa" texto="Memoria y progreso" />
            </div>
          </div>
        </div>
      </section>

      <section id="funciona" className="border-y border-slate-200 bg-[#F7FAFC] py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-sm font-black tracking-[0.16em] text-blue-600">CÓMO FUNCIONA</p>
            <h2 className="mt-5 text-4xl font-black tracking-[-0.045em] text-slate-950 md:text-6xl">
              Una conversación. Un proceso completo.
            </h2>
          </div>

          <div className="mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {funcionamiento.map(([numero, titulo, texto]) => (
              <article key={numero} className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm">
                <span className="text-sm font-black text-blue-600">{numero}</span>
                <h3 className="mt-10 text-2xl font-black text-slate-950">{titulo}</h3>
                <p className="mt-4 leading-7 text-slate-600">{texto}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="capacidades" className="bg-[#071226] py-24 text-white md:py-32">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <div className="max-w-4xl">
            <p className="text-sm font-black tracking-[0.16em] text-blue-300">CAPACIDADES</p>
            <h2 className="mt-5 text-4xl font-black tracking-[-0.045em] md:text-6xl">
              Diseñado para acompañar y producir resultados.
            </h2>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {capacidades.map((item) => (
              <article key={item.numero} className="rounded-[2rem] border border-white/10 bg-white/5 p-7">
                <span className="text-sm font-black text-blue-300">{item.numero}</span>
                <h3 className="mt-10 text-2xl font-black">{item.titulo}</h3>
                <p className="mt-4 leading-7 text-slate-300">{item.texto}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <div className="max-w-4xl">
            <p className="text-sm font-black tracking-[0.16em] text-blue-600">EJEMPLOS REALES</p>
            <h2 className="mt-5 text-4xl font-black tracking-[-0.045em] text-slate-950 md:text-6xl">
              Pedidos simples. Entregables concretos.
            </h2>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {ejemplos.map((item) => (
              <article key={item.pedido} className="rounded-[2rem] border border-slate-200 bg-[#F8FBFF] p-7">
                <p className="text-sm font-black text-blue-600">USUARIO</p>
                <p className="mt-4 text-xl font-black leading-8 text-slate-950">“{item.pedido}”</p>
                <div className="my-6 h-px bg-slate-200" />
                <p className="text-sm font-black text-slate-400">EOS</p>
                <p className="mt-3 leading-7 text-slate-600">{item.resultado}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="comparacion" className="border-y border-slate-200 bg-[#F7FAFC] py-24 md:py-32">
        <div className="mx-auto max-w-5xl px-6 md:px-8">
          <div className="text-center">
            <p className="text-sm font-black tracking-[0.16em] text-blue-600">DIFERENCIA PRINCIPAL</p>
            <h2 className="mt-5 text-4xl font-black tracking-[-0.045em] text-slate-950 md:text-6xl">
              Conversar es solo el comienzo.
            </h2>
          </div>

          <div className="mt-14 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
            <div className="grid grid-cols-[1.5fr_.75fr_.75fr] bg-[#071226] px-6 py-5 text-sm font-black text-white">
              <span>Capacidad</span>
              <span className="text-center text-slate-400">Asistente</span>
              <span className="text-center text-blue-300">EOS</span>
            </div>
            {comparacion.map(([texto, asistente, eos]) => (
              <div key={String(texto)} className="grid grid-cols-[1.5fr_.75fr_.75fr] items-center border-t border-slate-100 px-6 py-5">
                <span className="font-bold text-slate-700">{String(texto)}</span>
                <span className="text-center font-black text-slate-300">{asistente ? "✓" : "—"}</span>
                <span className="text-center font-black text-blue-600">{eos ? "✓" : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6 md:px-8">
          <div className="relative overflow-hidden rounded-[2.7rem] bg-[#071226] px-7 py-16 text-center text-white shadow-2xl md:px-14 md:py-20">
            <div className="absolute -left-20 bottom-[-120px] h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="absolute -right-20 top-[-120px] h-72 w-72 rounded-full bg-blue-400/20 blur-3xl" />
            <div className="relative">
              <p className="text-sm font-black tracking-[0.16em] text-blue-300">EMPEZÁ CON EOS</p>
              <h2 className="mx-auto mt-5 max-w-4xl text-4xl font-black tracking-[-0.045em] md:text-6xl">
                Trabajá con un sistema que no solo responde.
              </h2>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                Iniciá una conversación y convertí una necesidad en una acción, un documento o un próximo paso claro.
              </p>
              <a
                href="/eos/chat"
                className="mt-9 inline-flex rounded-full bg-[#2563EB] px-9 py-4 font-black text-white shadow-xl shadow-blue-500/25 transition hover:bg-blue-700"
              >
                Abrir EOS
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-6 py-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
          <p>EOS, desarrollado por TRANSTECH.</p>
          <div className="flex gap-6">
            <a href="/" className="font-bold hover:text-blue-600">TRANSTECH</a>
            <a href="/login" className="font-bold hover:text-blue-600">Iniciar sesión</a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function DemoEOS() {
  return (
    <div className="relative">
      <div className="absolute inset-0 translate-x-6 translate-y-8 rounded-[2.5rem] bg-blue-500/15 blur-2xl" />
      <div className="relative overflow-hidden rounded-[2.5rem] border border-white bg-white p-4 shadow-2xl shadow-slate-900/15">
        <div className="rounded-[2rem] bg-[#071226] p-5 text-white md:p-7">
          <div className="flex items-center justify-between border-b border-white/10 pb-5">
            <div>
              <p className="text-xs font-black tracking-[0.15em] text-blue-300">EOS</p>
              <p className="mt-1 font-black">Executive Operating System</p>
            </div>
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300">
              Activo
            </span>
          </div>

          <div className="mt-6 space-y-4">
            <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-blue-600 p-4 text-sm leading-6">
              Generame un Excel para controlar los ingresos y gastos de mi negocio.
            </div>
            <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-200">
              Perfecto. Voy a preparar una planilla financiera con ingresos, gastos, resultado y estructura de control.
            </div>
            <div className="max-w-[90%] rounded-2xl border border-blue-400/25 bg-blue-500/10 p-4">
              <p className="text-xs font-black text-blue-300">ARCHIVO GENERADO</p>
              <div className="mt-3 flex items-center justify-between gap-4">
                <div>
                  <p className="font-black">control_financiero.xlsx</p>
                  <p className="mt-1 text-xs text-slate-400">Listo para descargar</p>
                </div>
                <span className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black">Descargar</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Mini({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-[#F8FBFF] p-5">
      <p className="font-black text-slate-950">{titulo}</p>
      <p className="mt-2 text-sm text-slate-500">{texto}</p>
    </div>
  );
}