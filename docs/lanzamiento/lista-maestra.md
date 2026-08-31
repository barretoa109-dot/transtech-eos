# Lista maestra de lanzamiento — estado verificado

Fecha del relevamiento: **31 de agosto de 2026**. Rama: `agent/eos-lanzamiento-lista-maestra`.

Cada punto lleva el estado que la evidencia sostiene, no el que quisiéramos.

| | |
| --- | --- |
| **cerrado** | Cumple la definición de terminado del final de este documento. |
| **parcial** | Funciona una parte y está identificado qué falta. |
| **abierto** | No empezado, o empezado sin evidencia. |
| **externo** | Depende de un tercero (SET, Bancard, tiendas, abogado). |
| **bloqueado** | No se puede cerrar hasta resolver otra cosa. |

Medición de hoy, para no discutirla dos veces:

- `npm test` → **379/379 en verde**.
- `npm run build` → **en verde**.
- `npm run lint` → **42 errores, 39 avisos**. No bloquea el merge (`continue-on-error`).
- `supabase migration list --linked` → **161 migraciones, local y remoto coinciden en todas**.

---

## A. Bloqueantes críticos

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 1 | Congelar el alcance | **parcial** | Redactado en `docs/lanzamiento/alcance-congelado.md`. Falta la firma de producto, legal y técnica, y la decisión sobre rotular ERP y CRM como beta. |
| 2 | Cerrar los cambios pendientes | **cerrado** | Árbol limpio. Tres commits: invariantes de anulación, validación de entrada de productos, higiene del repo. Los 21 MB de video y presentación quedaron ignorados, no commiteados. |
| 3 | Sincronizar migraciones | **parcial** | Las 161 coinciden local y remoto, verificado hoy. **Pero hay un solo proyecto Supabase**: desarrollo, pruebas y producción son la misma base. No hay nada que sincronizar porque no hay contra qué. |
| 4 | Instalación desde cero | **bloqueado** | Imposible sin una segunda base. Ver la nota de infraestructura abajo. |
| 5 | Actualización realista | **bloqueado** | Idem. Hoy toda migración se estrena contra datos de usuarios reales. |
| 6 | Bancard productivo | **parcial** | Firmas, webhook, tokenización, 3DS, ocasional y recurrente andan en `staging` (`BANCARD_ENV`). Falta instalar credenciales productivas y repetir la verificación con `production`. |
| 7 | Compra real controlada | **parcial** | `npm run certificar` cubre pago, activación, renovación y vencimiento (casos 03 a 06). **No** cubre rechazado, cancelado, duplicado, abandonado, demorado ni reversado. |
| 8 | Requisitos de publicación | **externo** | D-U-N-S, cuentas de tienda, políticas y verificaciones sin empezar. El alcance congelado saca las apps del lanzamiento: se sale por web. |
| 9 | Revisión legal | **externo** | Existen `/terminos` y `/privacidad`. Ningún profesional los revisó. |
| 10 | Decisión formal de lanzamiento | **abierto** | La regla está escrita en el alcance congelado; falta el acta. |

### La nota de infraestructura que ordena A

**Hay un solo proyecto Supabase.** Eso convierte los puntos 4, 5 y 50 en
imposibles, no en pendientes: no se puede probar una instalación desde cero ni
una actualización realista contra la base donde viven los usuarios. Y la
definición de terminado exige "producción o un entorno idéntico".

Un segundo proyecto Supabase (`transtech-eos-staging`), con las mismas 161
migraciones aplicadas desde cero y datos sintéticos, destraba de una vez los
puntos 3, 4, 5, 7, 43 y 50. **Es la pieza de mayor rendimiento de toda la
lista** y no depende de nadie externo.

---

## B. Funciones esenciales

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 11 | Registro e inicio de sesión | **parcial** | Correo, Google y Apple, recuperación, cierre de sesión y verificación contra contraseñas filtradas (`lib/pwnedPassword.ts`). Falta el recorrido certificado de enlace vencido, sesión expirada y cuenta duplicada. |
| 12 | Onboarding conversacional | **parcial** | `/eos/onboarding` y `api/onboarding`, caso 07 de certificación. Falta verificar que cubra país, moneda, zona horaria y tipo de usuario sin formulario. |
| 13 | Corregir el onboarding | **abierto** | No hay camino para reiniciar la configuración ni para decir "esto ya no me representa". |
| 14 | Chat de punta a punta | **parcial** | Enviar, recibir y recuperar conversaciones andan. Falta certificar reintento, detención, adjuntos y reanudación tras desconexión. |
| 15 | No inventar respuestas | **parcial** | `npm run evals` con corpus y auditoría por mutación (`evals:mutacion`). Falta el caso explícito de "no afirmar una acción no confirmada". |
| 16 | Confirmar antes de lo sensible | **parcial** | El Worker Gate exige aprobación para las acciones ERP. Falta cubrir pagos, eliminaciones y documentos fiscales con el mismo criterio. |
| 17 | Memoria de EOS | **parcial** | `api/learnings` guarda aprendizajes. Falta que el usuario pueda ver, corregir, ignorar y borrar cada uno. |
| 18 | Decisiones y seguimiento | **parcial** | `api/decisions` y `api/decisions/[id]/results`. Falta certificar responsable, fecha y vínculo con la conversación de origen. |
| 19 | Briefing diario | **parcial** | `api/cron/briefing-diario` y preferencias. Falta certificar horario paraguayo, no-duplicado y el enlace correcto. |
| 20 | Alertas de riesgo | **parcial** | `api/finanzas/riesgo` cubre faltante y vencimientos. Falta inventario bajo, cobros pendientes y el control de alarmas repetidas. |

---

## C. Finanzas, panel y documentos

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 21 | Panel financiero completo | **parcial** | Saldo, ingresos, egresos, deudas, fijos y proyección. Falta patrimonio y evolución. |
| 22 | Multimoneda | **parcial** | `lib/finanzas/monedas`, separación por moneda y `moneda` en gastos fijos (v65). Falta mostrar tipo de cambio con origen y fecha. |
| 23 | Trazabilidad de cada número | **abierto** | No hay camino de un total a los movimientos que lo componen. |
| 24 | Conciliación e importación | **parcial** | `api/finanzas/conciliar` y `api/finanzas/buzon`. Falta cubrir transferencias propias y diferencias de saldo. |
| 25 | Conexiones automáticas | **abierto** | Solo lectura de correo. Ninguna integración bancaria. El alcance congelado lo saca del anuncio. |
| 26 | Fijos, deudas y vencimientos | **parcial** | `api/finanzas/fijos` y `api/finanzas/deudas`. Faltan cuotas, pagos parciales e intereses. |
| 27 | Cálculos de dinero | **parcial** | Cubierto por tests (`lib/finanzas`, `evals/casos/importes.ts`) y reforzado hoy: un precio inválido ya no se guarda como cero. Falta el caso de montos grandes y redondeo de PYG sin decimales. |
| 28 | Informes por período | **parcial** | `api/informes` y `api/finanzas/periodo`. Falta probar que dos corridas iguales den lo mismo. |
| 29 | Word, PDF y Excel | **parcial** | `docx`, `exceljs` y `pdfkit` integrados; `docs/documentos-a-pedido.md`. Falta cubrir todos los pedidos posibles. |
| 30 | Validar antes de entregar | **abierto** | No hay control que impida descargar un archivo vacío, cortado o con datos de otro. **Es un punto de queja directa y es barato de cerrar.** |

---

## D. ERP, CRM y gestión

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 31 | Invariantes del ERP | **cerrado** (con reserva) | Migración `20260829005319`, aplicada en producción y con test de invariantes. Una sola transacción, actor y motivo obligatorios, locks, auditoría única por documento, repetición idempotente. **Reserva:** falta el recorrido de una persona distinta contra la base. |
| 32 | Sin ejecuciones duplicadas | **parcial** | Cubierto en anulación (`ya_estaba`) y en el catastro Bancard (v77). Falta en importación, webhooks y comandos del chat. |
| 33 | Empresas, sucursales, roles | **abierto** | El tenant es `usuario_id`. Fuera del alcance de lanzamiento. |
| 34 | Catálogo profesional | **parcial** | Código, precio, costo, moneda, IVA, stock, mínimo e historial de costo (v80). Faltan categorías, marcas, variantes, unidades y listas de precios. |
| 35 | Inventario profesional | **abierto** | Un saldo por producto. Fuera del alcance. |
| 36 | Ciclo de compras | **parcial** | Compra, pago y anulación. Falta orden, aprobación, recepción parcial y devolución. |
| 37 | Ciclo de ventas | **parcial** | Venta, cobro y anulación. Falta cotización, pedido, entrega parcial y nota de crédito. |
| 38 | Caja y tesorería | **abierto** | Fuera del alcance. |
| 39 | CRM | **parcial** | Contactos, oportunidades y actividades. Falta embudo, conversión y razones de pérdida. |
| 40 | Reportes empresariales | **parcial** | `api/eos-kpis` y `api/eos-tendencias`. Faltan rotación, margen, cartera y desempeño. |
| 41 | Facturación electrónica | **cerrado en su rotulado** | La v87 renombró el módulo a "Comprobantes de venta (beta)" y el papel sale como borrador. SIFEN sigue **externo**. |
| 42 | Auditoría de cambios | **parcial** | `lib/auditoria` y la auditoría nueva de anulaciones. No todas las operaciones ERP escriben antes/después con autor y motivo. |

---

## E. Seguridad y resistencia

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 43 | Auditoría de acceso | **parcial** | RLS en todas las tablas, revocación de `anon` (v72), endurecimiento de relaciones por tenant (v76), triggers de contacto ajeno. Falta la prueba activa de que ningún usuario alcanza datos de otro. |
| 44 | Sin rutas de prueba | **cerrado** | Relevado hoy: no hay rutas de test, debug ni demo en `app/`. Las tres bajo `api/internal` están autorizadas por firma. |
| 45 | Interfaces externas | **parcial** | Firma de webhook Bancard, `worker-authorize`, `no-store` y `Vary: Cookie` en las APIs. Falta límite de solicitudes y prevención de repetición generalizados. |
| 46 | Secretos y datos sensibles | **parcial** | `lib/seguridad/cifrado.ts` con AES-GCM ligado a usuario y proveedor, rotación de clave y 14 tests. Falta la revisión de que ningún registro imprima datos privados. |
| 47 | Recuperación ante incidentes | **parcial** | `docs/rollback-runbook.md` cubre Vercel y Supabase, con el drift de migraciones ya resuelto y documentado. Falta restauración verificada y procedimiento para caída de n8n, correo e IA. |

---

## F. Experiencia y lanzamiento

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 48 | Experiencia y accesibilidad | **abierto** | Sin auditoría de teclado, contraste, lectores de pantalla, estados vacíos ni conexión lenta. |
| 49 | Puerta automática de calidad | **parcial** | `.github/workflows/evals.yml` corre `npm test`, `npm run evals` y `tsc --noEmit` bloqueando; `lint` informa pero **no bloquea** (42 errores de deuda vieja). No hay pruebas SQL, ni de seguridad, ni recorridos de navegador. |
| 50 | Piloto y simulacro | **bloqueado** | Depende del segundo proyecto Supabase. |

---

## Definición de terminado

Un punto se marca cerrado solo cuando:

1. funciona en producción o en un entorno idéntico;
2. tiene pruebas satisfactorias;
3. lo recorrió una persona distinta de quien lo implementó;
4. contempla errores, reintentos y conexiones cortadas;
5. respeta aislamiento, permisos y privacidad;
6. tiene monitoreo y procedimiento de recuperación;
7. deja evidencia verificable.

Pasar una prueba técnica no es estar listo para el mercado.

---

## Orden recomendado del trabajo

Por rendimiento, no por número de punto.

1. **Segundo proyecto Supabase.** Destraba 3, 4, 5, 7, 43 y 50. Nada más de esta
   lista rinde tanto.
2. **Punto 30 — validar el documento antes de entregarlo.** Barato, y evita la
   queja más visible que existe: un archivo roto o con datos de otro.
3. **Punto 49 — que el lint bloquee.** 42 errores; 36 son `any` en Bancard y el
   worker, 6 son `setState` dentro de efectos en React 19, que sí son reales.
4. **Punto 7 — los siete finales de pago.** Rechazado, cancelado, duplicado,
   abandonado, demorado y reversado, como casos de `npm run certificar`.
5. **Punto 23 — trazabilidad de cada número.** Es lo que separa un panel que se
   mira de uno en el que se confía.
6. **Puntos 13, 17 y 16.** El usuario tiene que poder corregir lo que EOS creyó
   entender, y saber qué va a pasar antes de que pase.
7. **Punto 48 — accesibilidad.** Antes del piloto, no después.
8. **Firmas: 1, 9 y 10.**
