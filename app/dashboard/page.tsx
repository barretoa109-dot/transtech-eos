"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function DashboardPage() {
  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");
  const [objetivos, setObjetivos] = useState<any[]>([]);
  const [tareas, setTareas] = useState<any[]>([]);
  const [seguimientos, setSeguimientos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    const usuarioId = localStorage.getItem("usuario_id");
    const usuarioNombre = localStorage.getItem("usuario_nombre") || "Usuario";
    const usuarioPlan = localStorage.getItem("usuario_plan") || "free";

    setNombre(usuarioNombre);
    setPlan(usuarioPlan);

    if (!usuarioId) {
      window.location.href = "/login";
      return;
    }

    const { data: objetivosData } = await supabase
      .from("objetivos")
      .select("*")
      .eq("usuario_id", usuarioId)
      .order("creado_en", { ascending: false });

    const { data: tareasData } = await supabase
      .from("tareas")
      .select("*")
      .eq("usuario_id", usuarioId)
      .order("creado_en", { ascending: false });

    const { data: seguimientosData } = await supabase
      .from("seguimientos")
      .select("*")
      .eq("usuario_id", usuarioId)
      .order("creado_en", { ascending: false })
      .limit(5);

    setObjetivos(objetivosData || []);
    setTareas(tareasData || []);
    setSeguimientos(seguimientosData || []);
    setCargando(false);
  }

  const tareasCompletadas = tareas.filter(
    (t) => t.estado === "completada" || t.estado === "completado"
  ).length;

  const progreso =
    tareas.length > 0 ? Math.round((tareasCompletadas / tareas.length) * 100) : 0;

  return (
    <main className="min-h-screen bg-[#020617] text-white p-8">
      <section className="max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-cyan-400 font-bold">TransTech EOS</p>
            <h1 className="text-4xl font-black">Panel de {nombre}</h1>
            <p className="text-slate-400">Plan actual: {plan}</p>
          </div>

          <div className="flex gap-3">
            <a href="/eos" className="bg-cyan-400 text-slate-950 px-6 py-3 rounded-2xl font-black">
              Chat EOS
            </a>
            <a href="/" className="border border-white/10 px-6 py-3 rounded-2xl">
              Inicio
            </a>
          </div>
        </div>

        {cargando ? (
          <p className="text-slate-400">Cargando tu progreso...</p>
        ) : (
          <>
            <div className="grid md:grid-cols-4 gap-5">
              <Card titulo="Objetivos activos" valor={objetivos.length} />
              <Card titulo="Tareas totales" valor={tareas.length} />
              <Card titulo="Tareas completadas" valor={tareasCompletadas} />
              <Card titulo="Avance general" valor={`${progreso}%`} />
            </div>

            <section className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-8">
              <h2 className="text-3xl font-black mb-4">Progreso general</h2>

              <div className="w-full bg-slate-800 rounded-full h-5 overflow-hidden">
                <div
                  className="bg-cyan-400 h-full"
                  style={{ width: `${progreso}%` }}
                />
              </div>

              <p className="text-slate-400 mt-4">
                EOS calcula tu avance según las tareas completadas dentro de tu proceso.
              </p>
            </section>

            <section className="grid md:grid-cols-2 gap-6">
              <div className="bg-[#091633] border border-white/10 rounded-3xl p-8">
                <h2 className="text-3xl font-black mb-5">Objetivos</h2>

                {objetivos.length === 0 ? (
                  <p className="text-slate-400">
                    Todavía no tenés objetivos cargados. Hablá con EOS para crearlos.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {objetivos.map((obj) => (
                      <div key={obj.id} className="bg-slate-800/70 p-4 rounded-2xl">
                        <p className="font-bold">{obj.titulo || obj.nombre || "Objetivo"}</p>
                        <p className="text-slate-400 text-sm">{obj.estado || "activo"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#091633] border border-white/10 rounded-3xl p-8">
                <h2 className="text-3xl font-black mb-5">Próximas tareas</h2>

                {tareas.length === 0 ? (
                  <p className="text-slate-400">
                    EOS todavía no generó tareas para este proceso.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {tareas.slice(0, 6).map((tarea) => (
                      <div key={tarea.id} className="bg-slate-800/70 p-4 rounded-2xl">
                        <p className="font-bold">{tarea.titulo || tarea.nombre || tarea.descripcion}</p>
                        <p className="text-slate-400 text-sm">{tarea.estado || "pendiente"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="bg-[#091633] border border-white/10 rounded-3xl p-8">
              <h2 className="text-3xl font-black mb-5">Últimos seguimientos</h2>

              {seguimientos.length === 0 ? (
                <p className="text-slate-400">
                  Cuando EOS detecte avances, aparecerán acá.
                </p>
              ) : (
                <div className="space-y-3">
                  {seguimientos.map((s) => (
                    <div key={s.id} className="bg-slate-800/70 p-4 rounded-2xl">
                      <p>{s.mensaje || s.descripcion || s.resumen}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function Card({ titulo, valor }: { titulo: string; valor: any }) {
  return (
    <div className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-6">
      <p className="text-slate-400">{titulo}</p>
      <h3 className="text-4xl font-black mt-2">{valor}</h3>
    </div>
  );
}