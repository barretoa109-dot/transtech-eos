# EOS 4.0 — Fase 5: Contexto Maestro y Motor de Decisiones

## Objetivo

Convertir memoria, objetivos, seguimientos, acciones, decisiones y aprendizajes en una síntesis ejecutiva compacta, aislada por usuario y reutilizable por Chat, Briefing y futuras automatizaciones.

## Flujo implementado

1. La sesión autenticada solicita `POST /api/context/master`.
2. El servidor compone exclusivamente las fuentes canónicas del usuario autenticado.
3. La síntesis se versiona mediante un fingerprint estable y se guarda en `eos_master_contexts`.
4. Cada reconstrucción queda auditada en `eos_master_context_runs` con `request_id`, duración, origen y conteos.
5. El chat obtiene la vista `eos_master_context_v8` y transporta su resumen al gateway por el historial normalizado que el workflow estable ya conserva.
6. Briefing usa alertas, objetivos y próxima mejor acción como respaldo cuando todavía no existe un briefing diario completo.
7. Cambios en objetivos, decisiones, resultados, acciones, seguimientos o aprendizajes invalidan inmediatamente el contexto vigente.

## Contrato de Contexto Maestro

| Sección | Tipo | Propósito |
|---|---|---|
| `identidad` | objeto | Nombre, tipo, sector, etapa y plan |
| `estado_actual` | objeto | Resumen, prioridad y score |
| `objetivos` | lista | Objetivos activos o pausados y su progreso |
| `proyectos` | lista | Proyectos operativos recientes |
| `compromisos` | lista | Acciones en curso y próximos pasos |
| `alertas` | lista | Seguimientos que merecen atención |
| `decisiones_recientes` | lista | Decisiones, razones y resultados |
| `aprendizajes` | lista | Patrones respaldados por evidencia |
| `proxima_mejor_accion` | objeto | Acción prioritaria y razón |
| `resumen_compacto` | texto | Síntesis segura para prompts |

## Seguridad y confianza

- La identidad se obtiene con `auth.getUser()`; el backend no confía en `usuario_id` enviado por el navegador.
- RLS restringe lectura y escritura al propietario; `service_role` conserva acceso operativo.
- La vista pública de aplicación usa `security_invoker`.
- El contenido inyectado en prompts se etiqueta explícitamente como datos y no como instrucciones.
- El resumen tiene límite de longitud y las consultas tienen límites por sección.
- Producción no debe publicar el borrador de n8n hasta completar la prueba end-to-end con una sesión real.

## Motor de Decisiones

Al registrar un resultado, la decisión se clasifica automáticamente:

| Resultado | Estado | Confianza inicial |
|---|---|---:|
| Positivo | validado | 0.80 |
| Neutral | validado | 0.65 |
| Negativo | validado | 0.80 |
| Inconcluso | inconcluso | 0.45 |
| Observación | midiendo | 0.35 |

Esta evaluación es determinista y auditable. El aprendizaje longitudinal puede enriquecerla posteriormente con más evidencia.

## Checklist de publicación

- [x] Migración principal aplicada.
- [x] Invalidación automática aplicada.
- [x] TypeScript sin errores.
- [x] ESLint de archivos modificados sin errores.
- [x] Compilación Webpack completada hasta la fase que requiere secretos de entorno.
- [x] Verificar y corregir RLS de `eos_profiles` y `eos_projects` en el entorno conectado.
- [ ] Ejecutar prueba autenticada: reconstrucción → chat → decisión → resultado → invalidación → reconstrucción.
- [ ] Publicar el cambio de prompt de n8n solo después de esa prueba.
- [ ] Revisar el preview del PR en escritorio y móvil.

## Fuera de alcance

- WhatsApp e integraciones externas.
- Autonomía financiera.
- Fusión automática a `main` o despliegue directo a producción.
