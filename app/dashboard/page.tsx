"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type AnyRow = Record<string, any>;

export default function DashboardPage() {
  const [usuarioId, setUsuarioId] = useState("");
  const [nombre, setNombre] = useState("Usuario");
  const [plan, setPlan] = useState("free");

  const [objetivos, setObjetivos] = useState<AnyRow[]>([]);
  const [tareas, setTareas] = useState<AnyRow[]>([]);
  const [seguimientos, setSeguimientos] = useState<AnyRow[]>([]);
  const [mensajes, setMensajes] = useState<AnyRow[]>([]);
  const [actividad, setActividad] = useState<AnyRow[]>([]);
  const [contexto, setContexto] = useState<AnyRow | null>(null);
  const [dashboardResumen, setDashboardResumen] = useState<AnyRow | null>(null);
  const [dashboardIA, setDashboardIA] = useState<AnyRow | null>(null);

  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);

  const [nuevoObjetivo, setNuevoObjetivo] = useState("");
  const [nuevaTarea, setNuevaTarea] = useState("");

  useEffect(() => {
    const id = localStorage.getItem("usuario_uuid");
    const usuarioNombre = localStorage.getItem("usuario_nombre") || "Usuario";
    const usuarioPlan = localStorage.getItem("usuario_plan") || "free";

    if (!id) {
      window.location.href = "/login";
      return;
    }

    setUsuarioId(id);
    setNombre(usuarioNombre);
    setPlan(usuarioPlan);
    cargarDatos(id);

    const canal = supabase
      .channel("dashboard-eos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "objetivos" }, () => cargarDatos(id))
      .on("postgres_changes", { event: "*", schema: "public", table: "tareas" }, () => cargarDatos(id))
      .on("postgres_changes", { event: "*", schema: "public", table: "seguimientos" }, () => cargarDatos(id))
      .on("postgres_changes", { event: "*", schema: "public", table: "dashboard_resumen" }, () => cargarDatos(id))
      .on("postgres_changes", { event: "*", schema: "public", table: "dashboard_ia" }, () => cargarDatos(id))
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, []);

  async function cargarDatos(id: string) {
    setCargando(true);

    const [
  objetivosRes,
  tareasRes,
  seguimientosRes,
  contextoRes,
  resumenRes,
  iaRes,
  conversacionesRes,
  actividadRes,
] = await Promise.all([
      supabase.from("objetivos").select("*").eq("usuario_id", id).order("created_at", { ascending: false }),
      supabase.from("tareas").select("*").eq("usuario_id", id).order("created_at", { ascending: false }),
      supabase.from("seguimientos").select("*").eq("usuario_id", id).order("created_at", { ascending: false }).limit(6),
      supabase.from("eos_contexto").select("*").eq("user_id", id).limit(1),
      supabase.from("dashboard_resumen").select("*").eq("usuario_id", id).order("updated_at", { ascending: false }).limit(1),
      supabase.from("dashboard_ia").select("*").eq("usuario_id", id).order("created_at", { ascending: false }).limit(1),
      supabase.from("conversaciones").select("id").eq("usuario_id", id).limit(1),
supabase
  .from("actividad_reciente")
  .select("*")
  .eq("usuario_id", id)
  .order("created_at", { ascending: false })
  .limit(10),
    ]);

    setObjetivos(objetivosRes.data || []);
    setTareas(tareasRes.data || []);
    setSeguimientos(seguimientosRes.data || []);
    setContexto(contextoRes.data?.[0] || null);
    setDashboardResumen(resumenRes.data?.[0] || null);
    setDashboardIA(iaRes.data?.[0] || null);
    setActividad(actividadRes.data || []);

    const conversacionId = conversacionesRes.data?.[0]?.id;

    if (conversacionId) {
      const { data } = await supabase
        .from("mensajes")
        .select("*")
        .eq("conversacion_id", conversacionId)
        .order("created_at", { ascending: false })
        .limit(6);

      setMensajes(data || []);
    }

    setCargando(false);
  }

  async function completarTarea(id: string, completada: boolean) {
  const tarea = tareas.find((t) => t.id === id);

  await supabase
    .from("tareas")
    .update({
      completada: !completada,
    })
    .eq("id", id);

  if (!completada && tarea) {
    await supabase.from("actividad_reciente").insert({
      usuario_id: usuarioId,
      titulo: "Tarea completada",
      descripcion: tarea.titulo,
    });
  }

  await cargarDatos(usuarioId);
}

 async function crearObjetivo() {
  if (!nuevoObjetivo.trim() || !usuarioId) return;

  setCreando(true);

  const objetivoExiste = objetivos.some(
    (o) => o.titulo?.trim().toLowerCase() === nuevoObjetivo.trim().toLowerCase()
  );

  if (objetivoExiste) {
    alert("Ese objetivo ya existe.");
    setCreando(false);
    return;
  }

  const { error } = await supabase.from("objetivos").insert({
    usuario_id: usuarioId,
    titulo: nuevoObjetivo.trim(),
    descripcion: nuevoObjetivo.trim(),
    progreso: 0,
    estado: "activo",
  });

  if (error) {
    alert(error.message);
    setCreando(false);
    return;
  }

  await supabase.from("actividad_reciente").insert({
    usuario_id: usuarioId,
    titulo: "Objetivo creado",
    descripcion: nuevoObjetivo.trim(),
  });

  setNuevoObjetivo("");
  await cargarDatos(usuarioId);
  setCreando(false);
}

  async function crearTarea() {
  if (!nuevaTarea.trim() || !usuarioId) return;

  setCreando(true);

  const objetivoActivo = objetivos.find((o) => o.estado !== "completado");

  const tareaExiste = tareas.some(
    (t) => t.titulo?.trim().toLowerCase() === nuevaTarea.trim().toLowerCase()
  );

  if (tareaExiste) {
    alert("Esa tarea ya existe.");
    setCreando(false);
    return;
  }

  const { error } = await supabase.from("tareas").insert({
    usuario_id: usuarioId,
    objetivo_id: objetivoActivo?.id || null,
    titulo: nuevaTarea.trim(),
    completada: false,
  });

  if (error) {
    alert(error.message);
    setCreando(false);
    return;
  }
await supabase.from("actividad_reciente").insert({
  usuario_id: usuarioId,
  titulo: "Tarea creada",
  descripcion: nuevaTarea.trim(),
});
  setNuevaTarea("");
  await cargarDatos(usuarioId);
  setCreando(false);
}

  const stats = useMemo(() => {
    const tareasCompletadas = tareas.filter((t) => t.completada === true).length;
    const tareasPendientesLocal = tareas.length - tareasCompletadas;
    const progresoLocal = tareas.length > 0 ? Math.round((tareasCompletadas / tareas.length) * 100) : 0;

    const objetivosActivos =
      dashboardResumen?.objetivos_activos ??
      objetivos.filter((o) => o.estado !== "completado").length;

    const tareasPendientes =
      dashboardResumen?.tareas_pendientes ?? tareasPendientesLocal;

    const progresoPromedio =
      dashboardResumen?.progreso_promedio ?? progresoLocal;

    const scoreBase =
      dashboardResumen?.puntuacion_eos ??
      dashboardIA?.puntuacion ??
      Math.min(100, Math.round(progresoPromedio * 0.7 + objetivosActivos * 10 + seguimientos.length * 5));

    const score = Number.isFinite(Number(scoreBase)) ? Number(scoreBase) : 0;

    const nivel =
      dashboardIA?.nivel ||
      (score >= 85 ? "Escalamiento" : score >= 65 ? "Optimización" : score >= 40 ? "Desarrollo" : "Inicial");

    const riesgo =
      dashboardIA?.riesgo ||
      (tareasPendientes > 10 ? "Alto" : tareasPendientes > 4 ? "Medio" : "Controlado");

    return {
      tareasCompletadas,
      tareasPendientes,
      progresoPromedio,
      objetivosActivos,
      score,
      nivel,
      riesgo,
    };
  }, [tareas, objetivos, dashboardResumen, dashboardIA, seguimientos]);

  const objetivoPrincipal = objetivos[0]?.titulo || "Todavía no hay objetivo principal definido";
  const proximaTarea = tareas.find((t) => !t.completada)?.titulo || "Hablá con EOS para definir el próximo paso.";
  const diagnosticoActual =
  contexto?.diagnostico_actual ||
  contexto?.ultimo_resumen ||
  (() => {
    if (stats.tareasPendientes > 20) {
      return `EOS detecta una carga alta de tareas pendientes. Hay ${stats.tareasPendientes} acciones abiertas, por eso conviene priorizar las tareas críticas antes de crear nuevas.`;
    }

    if (stats.objetivosActivos === 0) {
      return "Todavía no hay objetivos activos. El primer paso es definir una meta clara para que EOS pueda ordenar el proceso.";
    }

    if (stats.progresoPromedio >= 70) {
      return "El proceso muestra buen avance. Conviene sostener el ritmo, completar las tareas restantes y preparar el próximo objetivo estratégico.";
    }

    return "EOS detecta avance inicial. Conviene concentrarse en completar tareas pendientes y mantener un objetivo principal claro.";
  })();

const problemaPrincipal =
  contexto?.problema_principal ||
  (stats.tareasPendientes > 20
    ? "Exceso de tareas pendientes."
    : stats.objetivosActivos === 0
    ? "Falta definir un objetivo principal."
    : "No se detecta un problema crítico.");

const accionesRecomendadas =
  contexto?.acciones_recomendadas ||
  (stats.tareasPendientes > 20
    ? "Elegí 3 tareas importantes, completalas hoy y evitá crear nuevas tareas hasta bajar la carga."
    : "Completá la próxima tarea pendiente para seguir aumentando el progreso.");

const recomendacionIA =
  dashboardIA?.recomendacion ||
  (() => {
    if (stats.tareasPendientes > 20) {
      return "Prioridad recomendada: reducí tareas pendientes. EOS sugiere enfocarte en pocas acciones de alto impacto.";
    }

    if (stats.objetivosActivos === 0) {
      return "Creá un objetivo concreto, por ejemplo: aumentar ventas, reducir costos o mejorar la organización operativa.";
    }

    if (stats.progresoPromedio >= 70) {
      return "EOS recomienda preparar la siguiente etapa: revisar resultados, medir impacto y definir una nueva meta de crecimiento.";
    }

    return "EOS recomienda avanzar con una tarea simple pero importante para generar progreso visible.";
  })();
  return (
    <main className="min-h-screen bg-[#020617] text-white px-6 py-10">
      <section className="max-w-7xl mx-auto space-y-8">
        <header className="flex flex-wrap justify-between items-center gap-5">
          <div>
            <p className="text-cyan-400 font-black tracking-wide">TransTech EOS</p>
            <h1 className="text-5xl font-black mt-2">Panel de {nombre}</h1>
            <p className="text-slate-400 mt-3">
              Plan actual: <span className="text-white font-bold">{plan}</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <a href="/dashboard-eos" className="bg-cyan-400 text-slate-950 px-6 py-3 rounded-2xl font-black">
              Dashboard EOS
            </a>
            <a href="/eos" className="border border-cyan-400/30 px-6 py-3 rounded-2xl font-bold">
              Abrir EOS
            </a>
            <a href="/" className="border border-white/10 px-6 py-3 rounded-2xl">
              Inicio
            </a>
          </div>
        </header>

        {cargando ? (
          <div className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-8">
            <p className="text-slate-400">Cargando tu progreso...</p>
          </div>
        ) : (
          <>
            <section className="bg-[#071226] border border-cyan-400/20 rounded-[32px] p-8 shadow-2xl">
              <div className="flex flex-wrap justify-between gap-6 items-start">
                <div>
                  <p className="text-cyan-400 font-black">Motor EOS</p>
                  <h2 className="text-4xl font-black mt-2">Score Inteligente</h2>
                  <p className="text-slate-400 mt-3 max-w-2xl">
                    EOS mide avance, riesgo, objetivos, tareas y señales de actividad para ayudarte a avanzar con claridad.
                  </p>
                </div>

                <div className="bg-cyan-400/10 border border-cyan-400/30 rounded-2xl px-5 py-3 text-cyan-300 font-black">
                  EOS activo
                </div>
              </div>

              <div className="grid md:grid-cols-4 gap-4 mt-8">
                <Mini titulo="EOS Score" valor={`${stats.score}/100`} />
                <Mini titulo="Nivel" valor={stats.nivel} />
                <Mini titulo="Riesgo" valor={stats.riesgo} />
                <Mini titulo="Progreso" valor={`${stats.progresoPromedio}%`} />
              </div>
            </section>

            <section className="grid md:grid-cols-4 gap-5">
              <Card titulo="Puntuación EOS" valor={`${stats.score}/100`} texto="Rendimiento general." />
              <Card titulo="Objetivos activos" valor={stats.objetivosActivos} texto="Metas abiertas." />
              <Card titulo="Tareas pendientes" valor={stats.tareasPendientes} texto="Acciones por completar." />
              <Card titulo="Seguimientos" valor={seguimientos.length} texto="Registros del motor." />
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <Box titulo="Crear objetivo">
                <div className="flex gap-3">
                  <input
                    value={nuevoObjetivo}
                    onChange={(e) => setNuevoObjetivo(e.target.value)}
                    placeholder="Ej: Aumentar ventas este mes"
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl px-4 py-3 outline-none"
                  />
                  <button onClick={crearObjetivo} disabled={creando} className="bg-cyan-400 text-slate-950 px-5 py-3 rounded-2xl font-black">
                    Crear
                  </button>
                </div>
              </Box>

              <Box titulo="Crear tarea">
                <div className="flex gap-3">
                  <input
                    value={nuevaTarea}
                    onChange={(e) => setNuevaTarea(e.target.value)}
                    placeholder="Ej: Revisar costos de productos"
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl px-4 py-3 outline-none"
                  />
                  <button onClick={crearTarea} disabled={creando} className="bg-cyan-400 text-slate-950 px-5 py-3 rounded-2xl font-black">
                    Crear
                  </button>
                </div>
              </Box>
            </section>

            <section className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-8">
              <p className="text-cyan-400 font-black mb-2">Objetivo principal</p>
              <h2 className="text-3xl font-black mb-5">{objetivoPrincipal}</h2>

              <div className="w-full bg-slate-800 rounded-full h-5 overflow-hidden">
                <div className="bg-cyan-400 h-full transition-all" style={{ width: `${stats.progresoPromedio}%` }} />
              </div>

              <p className="text-slate-400 mt-4">
                Próximo paso: <span className="text-white font-bold">{proximaTarea}</span>
              </p>
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <Box titulo="Diagnóstico actual de EOS">
                <Text>{diagnosticoActual}</Text>
              </Box>

              <Box titulo="Recomendación IA">
                <Text>{recomendacionIA}</Text>
              </Box>
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <Box titulo="Problema principal">
                <Text>{problemaPrincipal}</Text>
              </Box>

              <Box titulo="Acciones recomendadas">
                <Text>{accionesRecomendadas}</Text>
              </Box>
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <Box titulo="Objetivos activos">
  {objetivos.length === 0 ? (
    <Empty texto="Hablá con EOS o creá tu primer objetivo desde este panel." />
  ) : (
    <div className="space-y-3">
      {objetivos.slice(0, 8).map((obj) => {
        const progresoObj = obj.progreso || stats.progresoPromedio || 0;

        return (
          <div
            key={obj.id}
            className="bg-slate-950/70 border border-white/10 p-5 rounded-2xl"
          >
            <div className="flex justify-between gap-4 items-start">
              <div>
                <p className="font-black text-lg">
                  {obj.titulo || "Objetivo"}
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  {obj.descripcion || obj.estado || "Activo"}
                </p>
              </div>

              <span className="text-cyan-300 font-black">
                {progresoObj}%
              </span>
            </div>

            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden mt-4">
              <div
                className="bg-cyan-400 h-full"
                style={{ width: `${progresoObj}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  )}
</Box>

              <Box titulo="Tareas del proceso">
  {tareas.length === 0 ? (
    <Empty texto="EOS todavía no generó tareas para este proceso." />
  ) : (
    <div className="space-y-3">
      {tareas.slice(0, 10).map((tarea) => (
        <button
          type="button"
          key={tarea.id}
          onClick={() => completarTarea(tarea.id, tarea.completada)}
          className={`w-full text-left border p-5 rounded-2xl transition ${
            tarea.completada
              ? "bg-cyan-400/10 border-cyan-400/30"
              : "bg-slate-950/70 border-white/10 hover:border-cyan-400/40"
          }`}
        >
          <div className="flex justify-between gap-4">
            <div>
              <p className="font-black">
                {tarea.completada ? "✓ " : "□ "}
                {tarea.titulo || tarea.descripcion || "Tarea"}
              </p>
              <p className="text-slate-400 text-sm mt-1">
                Estado: {tarea.completada ? "Completada" : "Pendiente"}
              </p>
            </div>

            <span
              className={`font-black ${
                tarea.completada ? "text-cyan-300" : "text-slate-500"
              }`}
            >
              {tarea.completada ? "Done" : "Pending"}
            </span>
          </div>
        </button>
      ))}
    </div>
  )}
</Box>
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <Box titulo="Últimos seguimientos">
                {seguimientos.length === 0 ? (
                  <Empty texto="Cuando EOS registre avances, aparecerán acá." />
                ) : (
                  <div className="space-y-3">
                    {seguimientos.map((s) => (
                      <Item
                        key={s.id}
                        titulo={s.estado || "Seguimiento"}
                        texto={s.mensaje || s.descripcion || "Seguimiento registrado"}
                      />
                    ))}
                  </div>
                )}
              </Box>

              <Box titulo="Actividad reciente">
                {mensajes.length === 0 ? (
                  <Empty texto="Todavía no hay actividad reciente." />
                ) : (
                  <div className="space-y-3">
                    {mensajes.map((m) => (
                      <Item
                        key={m.id}
                        titulo={m.remitente === "usuario" ? nombre : "EOS"}
                        texto={m.mensaje || "Mensaje registrado"}
                      />
                    ))}
                  </div>
                )}
              </Box>
            </section>

            <section className="bg-gradient-to-r from-cyan-400/15 to-blue-500/10 border border-cyan-400/20 rounded-3xl p-8 text-center">
              <h2 className="text-3xl font-black mb-3">Continuar con EOS</h2>
              <p className="text-slate-300 max-w-3xl mx-auto">
                Tu dashboard ya conecta objetivos, tareas, diagnósticos, seguimiento y actividad. Para mejorar el score, completá tareas y seguí conversando con EOS.
              </p>

              <a href="/eos" className="inline-block mt-6 bg-cyan-400 text-slate-950 px-8 py-4 rounded-2xl font-black">
                Volver al asesor EOS
              </a>
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function Card({ titulo, valor, texto }: { titulo: string; valor: any; texto: string }) {
  return (
    <div className="bg-[#091633] border border-cyan-400/20 rounded-3xl p-7 min-h-[180px]">
      <p className="text-slate-400">{titulo}</p>
      <h3 className="text-4xl font-black mt-4">{valor}</h3>
      <p className="text-slate-500 mt-4">{texto}</p>
    </div>
  );
}

function Mini({ titulo, valor }: { titulo: string; valor: any }) {
  return (
    <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-5">
      <p className="text-slate-400 text-sm">{titulo}</p>
      <h3 className="text-2xl font-black mt-2">{valor}</h3>
    </div>
  );
}

function Box({ titulo, children }: { titulo: string; children: any }) {
  return (
    <div className="bg-[#091633] border border-white/10 rounded-3xl p-7">
      <h2 className="text-2xl font-black mb-5">{titulo}</h2>
      {children}
    </div>
  );
}

function Item({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="bg-slate-950/70 border border-white/10 p-4 rounded-2xl">
      <p className="font-bold">{titulo}</p>
      <p className="text-slate-400 text-sm mt-1 whitespace-pre-line">{texto}</p>
    </div>
  );
}

function Text({ children }: { children: string }) {
  return <p className="text-slate-300 whitespace-pre-line leading-relaxed">{children}</p>;
}

function Empty({ texto }: { texto: string }) {
  return <p className="text-slate-400">{texto}</p>;
}
