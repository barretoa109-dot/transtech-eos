'use client'

import { useEffect, useMemo, useState } from 'react'

type KPI = {
  id: string
  nombre: string
  valor_actual: number
  meta: number
  unidad: string
  created_at?: string
}

type Recomendacion = {
  id: string
  recomendacion?: string
  prioridad?: string
  score_actual?: number
  created_at?: string
}

type Tendencia = {
  id: string
  tendencia?: string
  score_actual?: number
  score_anterior?: number
  diferencia?: number
  created_at?: string
}

type Seguimiento = {
  id: string
  mensaje?: string
  estado?: string
  created_at?: string
}

export default function DashboardEOS() {
  const [kpis, setKpis] = useState<KPI[]>([])
  const [recomendaciones, setRecomendaciones] = useState<Recomendacion[]>([])
  const [tendencias, setTendencias] = useState<Tendencia[]>([])
  const [seguimientos, setSeguimientos] = useState<Seguimiento[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function cargarDatos() {
      try {
        const [kpisRes, recRes, tenRes, segRes] = await Promise.all([
          fetch('/api/eos-kpis', { cache: 'no-store' }),
          fetch('/api/eos-recomendaciones', { cache: 'no-store' }),
          fetch('/api/eos-tendencias', { cache: 'no-store' }),
          fetch('/api/eos-seguimientos', { cache: 'no-store' }),
        ])

        const kpisData = await kpisRes.json()
        const recData = await recRes.json()
        const tenData = await tenRes.json()
        const segData = await segRes.json()

        setKpis(kpisData.data || [])
        setRecomendaciones(recData.data || [])
        setTendencias(tenData.data || [])
        setSeguimientos(segData.data || [])
      } catch (error) {
        console.error('Error cargando dashboard EOS:', error)
      } finally {
        setLoading(false)
      }
    }

    cargarDatos()
  }, [])

  const score = Number(kpis[0]?.valor_actual || 0)

  const nivel = useMemo(() => {
    if (score >= 85) return 'Elite'
    if (score >= 65) return 'Avanzado'
    if (score >= 40) return 'Intermedio'
    return 'Inicial'
  }, [score])

  const ultimaRecomendacion = recomendaciones[0]
  const ultimaTendencia = tendencias[0]

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.loadingCard}>
          <div style={styles.pulse}></div>
          <h1>Cargando motor EOS...</h1>
          <p>Preparando métricas, recomendaciones y seguimiento inteligente.</p>
        </div>
      </main>
    )
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.brand}>TransTech EOS</p>
          <h1 style={styles.title}>Dashboard inteligente</h1>
          <p style={styles.subtitle}>
            Tu centro de control para medir avance, detectar riesgos y recibir acciones claras.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
  <a href="/dashboard" style={styles.backButton}>
    Dashboard Principal
  </a>

  <a href="/eos" style={styles.backButton}>
    Ir al chat EOS
  </a>

  <div style={styles.statusPill}>
    <span style={styles.statusDot}></span>
    EOS activo
  </div>
</div>

</section>

<section style={styles.mainGrid}>
        <div style={styles.scoreCard}>
          <div style={styles.cardTop}>
            <p style={styles.label}>EOS Score</p>
            <span style={styles.level}>{nivel}</span>
          </div>

          <h2 style={styles.score}>{score}<span>/100</span></h2>

          <div style={styles.progressOuter}>
            <div style={{ ...styles.progressInner, width: `${Math.min(score, 100)}%` }} />
          </div>

          <p style={styles.helper}>
            {score < 40
              ? 'EOS detecta una etapa inicial. Conviene ordenar tareas críticas.'
              : score < 70
              ? 'Vas avanzando. EOS recomienda mantener foco y reducir pendientes.'
              : 'Excelente avance. EOS puede ayudarte a escalar objetivos.'}
          </p>
        </div>

        <MetricCard title="KPIs" value={kpis.length} text="Métricas activas" />
        <MetricCard title="Recomendaciones" value={recomendaciones.length} text="Acciones sugeridas" />
        <MetricCard title="Seguimientos" value={seguimientos.length} text="Registros del motor" />
      </section>

      <section style={styles.twoColumns}>
        <div style={styles.panel}>
          <p style={styles.panelLabel}>Recomendación principal</p>
          <h3 style={styles.panelTitle}>
            {ultimaRecomendacion?.prioridad || 'Sin prioridad'}
          </h3>
          <p style={styles.panelText}>
            {ultimaRecomendacion?.recomendacion ||
              'Todavía no hay una recomendación activa. Ejecutá el motor EOS para generar una.'}
          </p>
        </div>

        <div style={styles.panel}>
          <p style={styles.panelLabel}>Tendencia actual</p>
          <h3 style={styles.panelTitle}>
            {ultimaTendencia?.tendencia || 'Sin tendencia'}
          </h3>
          <p style={styles.panelText}>
            Score actual {ultimaTendencia?.score_actual ?? score} / anterior{' '}
            {ultimaTendencia?.score_anterior ?? score}
          </p>
        </div>
      </section>

      <section style={styles.panel}>
        <div style={styles.sectionHeader}>
          <div>
            <p style={styles.panelLabel}>Últimas recomendaciones</p>
            <h3 style={styles.sectionTitle}>Acciones que EOS sugiere</h3>
          </div>
        </div>

        <div style={styles.list}>
          {recomendaciones.length === 0 ? (
            <p style={styles.empty}>Todavía no hay recomendaciones registradas.</p>
          ) : (
            recomendaciones.slice(0, 5).map((item) => (
              <div key={item.id} style={styles.listItem}>
                <span style={styles.priority}>{item.prioridad || 'media'}</span>
                <p>{item.recomendacion || 'Recomendación sin texto.'}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section style={styles.twoColumns}>
        <div style={styles.panel}>
          <p style={styles.panelLabel}>Historial de tendencia</p>
          <div style={styles.list}>
            {tendencias.length === 0 ? (
              <p style={styles.empty}>Todavía no hay tendencias registradas.</p>
            ) : (
              tendencias.slice(0, 4).map((item) => (
                <div key={item.id} style={styles.listItem}>
                  <strong>{item.tendencia || 'estable'}</strong>
                  <p>
                    Actual {item.score_actual ?? 0} / anterior {item.score_anterior ?? 0}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={styles.panel}>
          <p style={styles.panelLabel}>Últimos seguimientos</p>
          <section style={styles.panel}>
  <p style={styles.panelLabel}>
    Próximos lanzamientos EOS
  </p>

  <div style={styles.list}>
    <div style={styles.listItem}>
      Objetivos inteligentes
    </div>

    <div style={styles.listItem}>
      Seguimiento automático
    </div>

    <div style={styles.listItem}>
      Notificaciones WhatsApp
    </div>

    <div style={styles.listItem}>
      Predicción de crecimiento
    </div>
  </div>
</section>
          <div style={styles.list}>
            {seguimientos.length === 0 ? (
              <p style={styles.empty}>Todavía no hay seguimientos registrados.</p>
            ) : (
              seguimientos.slice(0, 4).map((item) => (
                <div key={item.id} style={styles.listItem}>
                  <strong>{item.estado || 'pendiente'}</strong>
                  <p>{item.mensaje || 'Seguimiento sin mensaje.'}</p>
                </div>
              ))
            )}
          </div>
        </div>
       </section>
    </main>
  );
}

function MetricCard({ title, value, text }: { title: string; value: number; text: string }) {
  return (
    <div style={styles.metricCard}>
      <p style={styles.label}>{title}</p>
      <h2 style={styles.metricValue}>{value}</h2>
      <p style={styles.helper}>{text}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    padding: '42px',
    background:
      'radial-gradient(circle at top left, rgba(34,211,238,.16), transparent 32%), #050816',
    color: '#ffffff',
    fontFamily: 'Inter, Arial, sans-serif',
  },
  hero: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 24,
    marginBottom: 32,
  },
  brand: {
    color: '#22d3ee',
    fontWeight: 800,
    margin: 0,
    marginBottom: 10,
  },
  title: {
    fontSize: 52,
    lineHeight: 1,
    margin: 0,
    letterSpacing: '-1.5px',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 17,
    maxWidth: 720,
    marginTop: 16,
  },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid rgba(34,211,238,.35)',
    background: 'rgba(8,47,73,.35)',
    padding: '12px 18px',
    borderRadius: 999,
    color: '#67e8f9',
    fontWeight: 700,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 99,
    background: '#22c55e',
    boxShadow: '0 0 18px #22c55e',
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1fr',
    gap: 18,
    marginBottom: 18,
  },
  scoreCard: {
    background: 'linear-gradient(145deg, rgba(15,23,42,.95), rgba(8,47,73,.55))',
    border: '1px solid rgba(34,211,238,.28)',
    borderRadius: 28,
    padding: 28,
    boxShadow: '0 25px 80px rgba(0,0,0,.35)',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: '#93c5fd',
    margin: 0,
    fontSize: 15,
  },
  level: {
    color: '#22d3ee',
    background: 'rgba(34,211,238,.1)',
    padding: '7px 12px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 800,
  },
  score: {
    fontSize: 72,
    margin: '18px 0',
    letterSpacing: '-2px',
  },
  progressOuter: {
    height: 12,
    background: '#1e293b',
    borderRadius: 99,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressInner: {
    height: '100%',
    background: 'linear-gradient(90deg, #22d3ee, #22c55e)',
    borderRadius: 99,
  },
  helper: {
    color: '#94a3b8',
    lineHeight: 1.5,
  },
  metricCard: {
    background: 'rgba(15,23,42,.88)',
    border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 26,
    padding: 24,
  },
  metricValue: {
    fontSize: 42,
    margin: '18px 0 8px',
  },
  twoColumns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 18,
    marginBottom: 18,
  },
  panel: {
    background: 'rgba(15,23,42,.88)',
    border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 26,
    padding: 26,
    marginBottom: 18,
  },
  panelLabel: {
    color: '#22d3ee',
    fontWeight: 800,
    margin: 0,
    marginBottom: 10,
  },
  panelTitle: {
    fontSize: 28,
    margin: 0,
    marginBottom: 12,
  },
  panelText: {
    color: '#cbd5e1',
    lineHeight: 1.6,
    fontSize: 16,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 26,
  },
  list: {
    display: 'grid',
    gap: 12,
  },
  listItem: {
    background: '#020617',
    border: '1px solid rgba(255,255,255,.07)',
    borderRadius: 18,
    padding: 18,
  },
  priority: {
    display: 'inline-block',
    color: '#22d3ee',
    fontWeight: 800,
    marginBottom: 8,
  },
  empty: {
    color: '#64748b',
  },
  loadingCard: {
    maxWidth: 520,
    margin: '20vh auto',
    textAlign: 'center',
    background: 'rgba(15,23,42,.85)',
    border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 28,
    padding: 40,
  },
 pulse: {
  width: 18,
  height: 18,
  borderRadius: 99,
  background: '#22d3ee',
  margin: '0 auto 18px',
  boxShadow: '0 0 30px #22d3ee',
},

backButton: {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '12px 18px',
  borderRadius: 999,
  background: 'rgba(34,211,238,.12)',
  border: '1px solid rgba(34,211,238,.35)',
  color: '#67e8f9',
  textDecoration: 'none',
  fontWeight: 800,
},

}