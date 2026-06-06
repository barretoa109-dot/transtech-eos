export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#020617] text-white overflow-hidden">
      <section className="max-w-7xl mx-auto px-6 py-10">

        <header className="flex justify-between items-center mb-20">
          <div>
            <p className="text-cyan-400 font-bold text-xl">
              TransTech EOS
            </p>
          </div>

          <div className="flex gap-3">
            <a
              href="/login"
              className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700"
            >
              Ingresar
            </a>

            <a
              href="/eos"
              className="px-5 py-3 rounded-xl bg-cyan-400 text-slate-950 font-bold"
            >
              Chat EOS
            </a>
          </div>
        </header>

        <div className="grid lg:grid-cols-2 gap-12 items-center">

          <div>
            <p className="text-cyan-400 font-bold mb-3">
              Sistema empresarial inteligente
            </p>

            <h1 className="text-6xl font-black leading-tight mb-6">
              Ordená,
              <br />
              automatizá y hacé
              <br />
              crecer tu negocio
              <span className="text-cyan-400"> con IA.</span>
            </h1>

            <p className="text-slate-400 text-xl leading-relaxed mb-8">
              TransTech EOS analiza tu empresa, detecta problemas,
              organiza procesos, mejora ventas y te acompaña
              paso a paso para aumentar tu rentabilidad.
            </p>

            <div className="flex gap-4 flex-wrap">
              <a
                href="/login"
                className="bg-cyan-400 text-slate-950 px-8 py-4 rounded-2xl font-black"
              >
                Comenzar gratis
              </a>

              <a
                href="/eos"
                className="border border-white/10 px-8 py-4 rounded-2xl"
              >
                Probar EOS
              </a>
            </div>

            <div className="grid grid-cols-3 gap-4 mt-12">
              <div className="bg-[#091633] rounded-3xl p-5">
                <h3 className="text-cyan-400 font-bold">
                  Diagnóstico
                </h3>
                <p className="text-slate-400 text-sm mt-2">
                  Detecta problemas ocultos.
                </p>
              </div>

              <div className="bg-[#091633] rounded-3xl p-5">
                <h3 className="text-cyan-400 font-bold">
                  Dashboard
                </h3>
                <p className="text-slate-400 text-sm mt-2">
                  Visualizá objetivos y progreso.
                </p>
              </div>

              <div className="bg-[#091633] rounded-3xl p-5">
                <h3 className="text-cyan-400 font-bold">
                  Chat EOS
                </h3>
                <p className="text-slate-400 text-sm mt-2">
                  Asistente conectado con IA.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-8">

            <p className="text-cyan-400 font-bold mb-2">
              Diagnóstico gratuito
            </p>

            <h2 className="text-3xl font-black mb-2">
              Contanos qué necesitás mejorar
            </h2>

            <p className="text-slate-400 mb-6">
              Completá tus datos y EOS va a registrar tu solicitud
              para iniciar el análisis.
            </p>

            <form className="space-y-4">
              <input
                placeholder="Nombre"
                className="w-full bg-slate-800 rounded-xl p-4 border border-white/10"
              />

              <input
                placeholder="WhatsApp"
                className="w-full bg-slate-800 rounded-xl p-4 border border-white/10"
              />

              <input
                placeholder="Empresa o negocio"
                className="w-full bg-slate-800 rounded-xl p-4 border border-white/10"
              />

              <textarea
                rows={4}
                placeholder="¿Cuál es tu principal problema?"
                className="w-full bg-slate-800 rounded-xl p-4 border border-white/10"
              />

              <button
                type="button"
                className="w-full bg-cyan-400 text-slate-950 font-black py-4 rounded-xl"
              >
                Solicitar diagnóstico
              </button>
            </form>
          </div>

        </div>

        <section className="mt-32">
          <h2 className="text-5xl font-black text-center mb-14">
            Todo en un solo sistema
          </h2>

          <div className="grid md:grid-cols-3 gap-6">

            <div className="bg-[#091633] p-8 rounded-3xl">
              <h3 className="text-2xl font-bold mb-4">
                Gestión
              </h3>

              <p className="text-slate-400">
                Control de clientes, tareas, seguimiento y procesos.
              </p>
            </div>

            <div className="bg-[#091633] p-8 rounded-3xl">
              <h3 className="text-2xl font-bold mb-4">
                Finanzas
              </h3>

              <p className="text-slate-400">
                Organización financiera y análisis de rentabilidad.
              </p>
            </div>

            <div className="bg-[#091633] p-8 rounded-3xl">
              <h3 className="text-2xl font-bold mb-4">
                Automatización
              </h3>

              <p className="text-slate-400">
                IA trabajando para vos 24/7.
              </p>
            </div>

          </div>
        </section>

      </section>
    </main>
  );
}