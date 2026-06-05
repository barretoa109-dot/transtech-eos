"use client";

import { useState } from "react";

export default function DashboardPage() {
  const [mensaje, setMensaje] = useState("");
  const [historial, setHistorial] = useState<string[]>([
    "👤 Tú: Hola EOS",
    "🤖 EOS: Hola Augusto, EOS conectado correctamente.",
  ]);

  const nombre = "Augusto";
  const plan = "Free";

  const enviarMensaje = async () => {
    if (!mensaje.trim()) return;

    const textoUsuario = mensaje;

    setHistorial((prev) => [
      ...prev,
      `👤 Tú: ${textoUsuario}`,
      `🤖 EOS: Conectando con n8n...`,
    ]);

    setMensaje("");

    try {
      const response = await fetch(
        "https://transtechsrl.app.n8n.cloud/webhook/eos-chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nombre,
            plan,
            mensaje: textoUsuario,
            origen: "dashboard-web",
          }),
        }
      );

      const texto = await response.text();

      let respuestaFinal = texto;

      try {
        const json = JSON.parse(texto);

        respuestaFinal =
          json.respuesta ||
          json.message ||
          json.text ||
          texto;
      } catch {
        respuestaFinal = texto;
      }

      setHistorial((prev) => [
        ...prev.slice(0, -1),
        `🤖 EOS: ${respuestaFinal}`,
      ]);
    } catch (error: any) {
      setHistorial((prev) => [
        ...prev.slice(0, -1),
        `🤖 EOS: Error: ${error.message}`,
      ]);
    }
  };

  return (
    <main className="min-h-screen bg-[#020B24] text-white p-8">
      <section className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-[#091633] rounded-3xl p-8 border border-cyan-500/20">
            <h2 className="text-4xl font-bold mb-6">
              Objetivo principal
            </h2>

            <p className="text-xl text-slate-300 mb-6">
              Ordenar las finanzas del negocio y mejorar la rentabilidad
              mensual.
            </p>

            <div className="w-full bg-slate-800 rounded-full h-6 overflow-hidden">
              <div className="bg-cyan-400 h-full w-[82.5%]" />
            </div>

            <p className="mt-4 text-slate-400">
              Faltan 17.5% para completar la meta.
            </p>
          </div>

          <div className="bg-[#091633] rounded-3xl p-8 border border-cyan-500/20">
            <h2 className="text-4xl font-bold mb-6">
              Próximas acciones
            </h2>

            <ul className="space-y-4 text-xl text-slate-300">
              <li>✓ Revisar gastos fijos del mes</li>
              <li>✓ Clasificar clientes más rentables</li>
              <li>• Automatizar seguimiento comercial</li>
              <li>• Crear reporte financiero semanal</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 bg-[#091633] rounded-3xl p-8 border border-cyan-500/20">
          <h2 className="text-5xl font-bold mb-2">
            Chat con EOS
          </h2>

          <p className="text-slate-400 text-xl mb-8">
            Tu asistente empresarial inteligente.
          </p>

          <div className="bg-[#01081F] rounded-3xl p-6 min-h-[320px] max-h-[500px] overflow-y-auto">
            {historial.map((item, index) => (
              <div
                key={index}
                className="mb-4 bg-slate-800/70 rounded-xl p-4 text-lg"
              >
                {item}
              </div>
            ))}
          </div>

          <div className="mt-6 flex gap-4">
            <input
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  enviarMensaje();
                }
              }}
              placeholder="Escribí tu consulta..."
              className="flex-1 rounded-2xl border border-white/10 bg-white/5 p-4 text-lg outline-none"
            />

            <button
              onClick={enviarMensaje}
              className="rounded-2xl bg-cyan-400 px-10 font-bold text-slate-950 text-lg"
            >
              Enviar
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}