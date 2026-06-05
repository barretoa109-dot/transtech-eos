"use client";

import { useState } from "react";
import { supabase } from "./lib/supabase";

export default function Home() {
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [problema, setProblema] = useState("");

  async function enviarLead() {
    const { error } = await supabase.from("leads").insert([
      {
        nombre,
        whatsapp,
        empresa,
        problema,
      },
    ]);

    if (error) {
      alert("Error al guardar");
      console.log(error);
      return;
    }

    alert("Lead registrado correctamente");

    setNombre("");
    setWhatsapp("");
    setEmpresa("");
    setProblema("");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-10">
      <div className="max-w-3xl mx-auto">

        <h1 className="text-5xl font-bold mb-4">
          TransTech EOS 🚀
        </h1>

        <p className="mb-10 text-slate-300">
          Solicita un diagnóstico gratuito.
        </p>

        <div className="space-y-4">

          <input
            className="w-full p-3 rounded text-black"
            placeholder="Nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />

          <input
            className="w-full p-3 rounded text-black"
            placeholder="WhatsApp"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
          />

          <input
            className="w-full p-3 rounded text-black"
            placeholder="Empresa"
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
          />

          <textarea
            className="w-full p-3 rounded text-black"
            placeholder="¿Cuál es tu principal problema?"
            value={problema}
            onChange={(e) => setProblema(e.target.value)}
          />

          <button
            onClick={enviarLead}
            className="bg-emerald-500 text-black px-6 py-3 rounded font-bold"
          >
            Enviar solicitud
          </button>

        </div>

      </div>
    </main>
  );
}