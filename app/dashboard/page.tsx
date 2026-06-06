"use client";

import { useEffect, useState } from "react";

export default function DashboardPage() {
  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");

  useEffect(() => {
    setNombre(localStorage.getItem("usuario_nombre") || "Usuario");
    setPlan(localStorage.getItem("usuario_plan") || "free");
  }, []);

  return (
    <main className="min-h-screen bg-[#020617] text-white p-8">
      <section className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-10">
          <div>
            <p className="text-cyan-400 font-bold">TransTech EOS</p>
            <h1 className="text-5xl font-black mt-2">
              Panel de crecimiento
            </h1>
            <p className="text-slate-400 mt-3">
              Bienvenido, {nombre}. Desde acá podés controlar tu negocio, tus objetivos y hablar con EOS.
            </p>
          </div>

          <div className="flex gap-3">
            <a href="/" className="px-5 py-3 rounded-2xl bg-slate-800">
              Inicio
            </a>
            <a href="/eos" className="px-5 py-3 rounded-2xl bg-cyan-400 text-slate-950 font-bold">
              Chat EOS
            </a>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-5 mb-8">
          <Card title="Plan actual" value={plan} text="Cuenta activa" />
          <Card title="Progreso" value="82.5%" text="Diagnóstico inicial" />
          <Card title="Objetivos" value="4" text="Acciones pendientes" />
          <Card title="Estado" value="Activo" text="Sistema funcionando" />
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <section className="md:col-span-2 bg-[#091633] border border-cyan-400/20 rounded-3xl p-7">
            <h2 className="text-3xl font-bold mb-4">Objetivo principal</h2>
            <p className="text-slate-300 text-lg mb-5">
              Ordenar el negocio, mejorar las ventas, automatizar procesos y aumentar la rentabilidad mensual.
            </p>

            <div className="w-full h-5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-400 w-[82.5%]" />
            </div>

            <p className="text-slate-400 mt-4">
              Faltan 17.5% para completar la primera etapa del diagnóstico.
            </p>
          </section>

          <section className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-7">
            <h2 className="text-2xl font-bold mb-5">Acciones sugeridas</h2>
            <ul className="space-y-4 text-slate-300">
              <li>✓ Revisar gastos fijos del mes</li>
              <li>✓ Clasificar clientes más rentables</li>
              <li>✓ Automatizar seguimiento comercial</li>
              <li>• Crear reporte financiero semanal</li>
            </ul>
          </section>

          <section className="bg-[#091633] border border-white/10 rounded-3xl p-7">
            <h2 className="text-2xl font-bold mb-3">Finanzas</h2>
            <p className="text-slate-400 mb-6">
              Controlá ingresos, gastos y rentabilidad.
            </p>
            <div className="space-y-3">
              <Metric label="Ingresos estimados" value="Gs. 0" />
              <Metric label="Gastos registrados" value="Gs. 0" />
              <Metric label="Margen actual" value="Pendiente" />
            </div>
          </section>

          <section className="bg-[#091633] border border-white/10 rounded-3xl p-7">
            <h2 className="text-2xl font-bold mb-3">Clientes</h2>
            <p className="text-slate-400 mb-6">
              Leads y oportunidades captadas.
            </p>
            <div className="space-y-3">
              <Metric label="Leads nuevos" value="2" />
              <Metric label="Seguimientos" value="0" />
              <Metric label="Conversaciones" value="1" />
            </div>
          </section>

          <section className="bg-[#091633] border border-white/10 rounded-3xl p-7">
            <h2 className="text-2xl font-bold mb-3">EOS</h2>
            <p className="text-slate-400 mb-6">
              Tu asesor inteligente para diagnosticar y mejorar el negocio.
            </p>
            <a href="/eos" className="block text-center bg-cyan-400 text-slate-950 font-black rounded-2xl py-4">
              Abrir chat EOS
            </a>
          </section>
        </div>
      </section>
    </main>
  );
}

function Card({ title, value, text }: any) {
  return (
    <div className="bg-[#091633] border border-white/10 rounded-3xl p-6">
      <p className="text-slate-400 text-sm">{title}</p>
      <h3 className="text-3xl font-black mt-2">{value}</h3>
      <p className="text-slate-500 mt-2">{text}</p>
    </div>
  );
}

function Metric({ label, value }: any) {
  return (
    <div className="flex justify-between border-b border-white/10 pb-3">
      <span className="text-slate-400">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}