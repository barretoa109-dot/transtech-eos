"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function DashboardPage() {
  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");
  const [objetivos, setObjetivos] = useState<any[]>([]);
  const [tareas, setTareas] = useState<any[]>([]);
  const [seguimientos, setSeguimientos] = useState<any[]>([]);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    const usuarioId = localStorage.getItem("usuario_uuid");
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
      .order("created_at", { ascending: false });

    const { data: tareasData } = await supabase
      .from("tareas")
      .select("*")
      .eq("usuario_id", usuarioId)
      .order("created_at", { ascending: false });

    const { data: seguimientosData } = await supabase
      .from("seguimientos")
      .select("*")
      .eq("usuario_id", usuarioId)
      .order("created_at", { ascending: false })
      .limit(5);

    const { data: conversacionesData } = await supabase
      .from("conversaciones")
      .select("id")
      .eq("usuario_id", usuarioId)
      .limit(1);

    if (conversacionesData?.[0]?.id) {
      const { data: mensajesData } = await supabase
        .from("mensajes")
        .select("*")
        .eq("conversacion_id", conversacionesData[0].id)
        .order("created_at", { ascending: false })
        .limit(5);

      setMensajes(mensajesData || []);
    }

    setObjetivos(objetivosData || []);
    setTareas(tareasData || []);
    setSeguimientos(seguimientosData || []);
    setCargando(false);
  }

  async function completarTarea(id: string, completada: boolean) {
    await supabase
      .from("tareas")
      .update({ completada: !completada })
      .eq("id", id);

    await cargarDatos();
  }

  const tareasCompletadas = tareas.filter((t) => t.completada === true).length;
  const tareasPendientes = tareas.length - tareasCompletadas;

  const progreso =
    tareas.length > 0 ? Math.round((tareasCompletadas / tareas.length) * 100) : 0;

  const objetivoPrincipal =
    objetivos[0]?.titulo || "Todavía no hay objetivo principal definido";

  const proximaTarea =
    tareas.find((t) => !t.completada)?.titulo ||
    "Hablá con EOS para definir tu próximo paso.";

  return (
    <main className="min-h-screen bg-[#020617] text-white p-8">
      <section className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-wrap justify-between items-center gap-5">
          <div>
            <p className="text-cyan-400 font-bold">TransTech EOS</p>
            <h1 className="text-4xl font-black">Panel de {nombre}</h1>
            <p className="text-slate-400 mt-2">
              Plan actual: <span className="text-white font-bold">{plan}</span>
            </p>
          </div>

          <div className="flex gap-3">
            <a href="/eos" className="bg-cyan-400 text-slate-950 px-6 py-3 rounded-2xl font-black">
              Abrir EOS
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
              <Card titulo="Objetivos" valor={objetivos.length} />
              <Card titulo="Tareas pendientes" valor={tareasPendientes} />
              <Card titulo="Completadas" valor={tareasCompletadas} />
              <Card titulo="Avance general" valor={`${progreso}%`} />
            </div>

            <section className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-8">
              <p className="text-cyan-400 font-bold mb-2">Objetivo principal</p>
              <h2 className="text-3xl font-black mb-5">{objetivoPrincipal}</h2>

              <div className="w-full bg-slate-800 rounded-full h-5 overflow-hidden">
                <div className="bg-cyan-400 h-full" style={{ width: `${progreso}%` }} />
              </div>

              <p className="text-slate-400 mt-4">
                Avance calculado según tareas completadas. Próximo paso:{" "}
                <span className="text-white font-bold">{proximaTarea}</span>
              </p>
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <Box titulo="Objetivos activos">
                {objetivos.length === 0 ? (
                  <Empty texto="Hablá con EOS para crear tu primer objetivo." />
                ) : (
                  objetivos.map((obj) => (
                    <div key={obj.id} className="bg-slate-800/70 p-4 rounded-2xl">
                      <p className="font-bold">{obj.titulo || "Objetivo"}</p>
                      <p className="text-slate-400 text-sm">
                        {obj.descripcion || obj.estado || "Activo"}
                      </p>
                    </div>
                  ))
                )}
              </Box>

              <Box titulo="Tareas del proceso">
                {tareas.length === 0 ? (
                  <Empty texto="EOS todavía no generó tareas para este proceso." />
                ) : (
                  tareas.map((tarea) => (
                    <button
                      key={tarea.id}
                      onClick={() => completarTarea(tarea.id, tarea.completada)}
                      className="w-full text-left bg-slate-800/70 p-4 rounded-2xl hover:bg-slate-700/70"
                    >
                      <p className="font-bold">
                        {tarea.completada ? "✓ " : "□ "}
                        {tarea.titulo || tarea.descripcion || "Tarea"}
                      </p>
                      <p className="text-slate-400 text-sm">
                        Prioridad: {tarea.prioridad || "Media"}
                      </p>
                    </button>
                  ))
                )}
              </Box>
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <Box titulo="Últimos seguimientos">
                {seguimientos.length === 0 ? (
                  <Empty texto="Cuando EOS registre avances, aparecerán acá." />
                ) : (
                  seguimientos.map((s) => (
                    <div key={s.id} className="bg-slate-800/70 p-4 rounded-2xl">
                      <p>{s.mensaje || s.descripcion || "Seguimiento registrado"}</p>
                      <p className="text-cyan-400 text-sm mt-2">
                        Avance: {s.porcentaje || progreso}%
                      </p>
                    </div>
                  ))
                )}
              </Box>

              <Box titulo="Actividad reciente">
                {mensajes.length === 0 ? (
                  <Empty texto="Todavía no hay actividad reciente." />
                ) : (
                  mensajes.map((m) => (
                    <div key={m.id} className="bg-slate-800/70 p-4 rounded-2xl">
                      <p className="text-cyan-400 text-sm font-bold">
                        {m.remitente === "usuario" ? nombre : "EOS"}
                      </p>
                      <p className="text-slate-300 mt-1">{m.mensaje}</p>
                    </div>
                  ))
                )}
              </Box>
            </section>

            <section className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-8 text-center">
              <h2 className="text-3xl font-black mb-3">Recomendación de EOS</h2>
              <p className="text-slate-300 max-w-3xl mx-auto">
                Para avanzar más rápido, completá la próxima tarea pendiente y luego volvé al chat EOS
                para actualizar tu progreso. Así el sistema puede seguir acompañando tu proceso.
              </p>
              <a
                href="/eos"
                className="inline-block mt-6 bg-cyan-400 text-slate-950 px-8 py-4 rounded-2xl font-black"
              >
                Continuar con EOS
              </a>
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

function Box({ titulo, children }: { titulo: string; children: any }) {
  return (
    <div className="bg-[#091633] border border-white/10 rounded-3xl p-8 space-y-3">
      <h2 className="text-3xl font-black mb-5">{titulo}</h2>
      {children}
    </div>
  );
}

function Empty({ texto }: { texto: string }) {
  return <p className="text-slate-400">{texto}</p>;
}