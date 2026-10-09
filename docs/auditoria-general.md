# EOS, área por área, contra la realidad

Fecha: **10 de septiembre de 2026**. Todo lo de acá está medido contra la base
de producción con `npx tsx scripts/auditar-areas.mts`, que se puede volver a
correr. No hay una sola afirmación de este documento que no salga de ahí o de
una conversación real contra n8n.

El encargo pedía una auditoría general de todo EOS y prohibía explícitamente
confiar en documentos: *"No confíes en documentos diciendo que algo existe o
falta. Verifícalo contra código, base, producción y experiencia real."*

---

## Cómo se mide

Cuatro preguntas por área, todas comprobables:

| | |
|---|---|
| **¿Existe?** | hay tabla y tiene filas |
| **¿Se usa?** | tiene filas de usuarios REALES |
| **¿EOS escribe?** | hay un verbo del chat que la llena |
| **¿Hay pruebas?** | hay pruebas que cubren su lógica |

**Quién es un usuario real.** De 68 usuarios en la base, la mayoría los creó un
script de certificación (`prueba-*`, `cert-victima-*`, `qa-*`). Contar sus
filas como uso sería medirse a uno mismo. Real es quien tuvo una conversación
de verdad: diez mensajes o más. **Son seis.**

---

## El barrido

```
ÁREA                        FILAS  DE REALES  VERBO                         PRUEBAS
------------------------------------------------------------------------------------
Chat                         1188       1180  —                             11
Memoria                        25         24  GUARDAR_MEMORIA               1
Objetivos                      54         54  CREAR_OBJETIVO                1
Tareas                          7          4  CREAR_TAREA                   —
Briefing                      787        217  —                             1
Decisiones                     14         13  —                             —
Aprendizajes                  206        148  —                             —
Business Twin                   5          4  —                             —
Autonomía · reglas              2          2  —                             —
Autonomía · gate              159         86  —                             —
Órdenes del chat              104         40  —                             1
ERP · productos                20         17  CREAR_PRODUCTO                14
ERP · ventas                   28         16  REGISTRAR_VENTA               14
ERP · compras                  13          8  REGISTRAR_COMPRA              —
ERP · cuenta corriente          0          0  REGISTRAR_COBRO               —
CRM · contactos                 3          3  CREAR_CONTACTO                1
CRM · oportunidades             1          0  REGISTRAR_OPORTUNIDAD         1
Personal · movimientos         63         25  REGISTRAR_MOVIMIENTO_PERSONAL 1
Personal · cuentas              0          0  DECLARAR_SALDO                —
Personal · deudas               3          0  REGISTRAR_DEUDA               1
Personal · tarjetas             0          0  REGISTRAR_TARJETA             1
Personal · fijos                1          0  REGISTRAR_GASTO_FIJO          1
Personal · transferencias       1          0  REGISTRAR_TRANSFERENCIA       —
Personal · bienes               0          0  —                             1
Personal · política             2          2  —                             —
Onboarding                      2          0  —                             —
Indicadores · historia        544        426  —                             15
Documentos                      0          0  —                             2
Auditoría                     227        219  —                             —
Pagos                           0          0  —                             —
```

---

## 1. Lo que este cuadro dice y no se puede suavizar

### Personal está vacío

Seis usuarios reales. **Cero cuentas. Cero tarjetas. Cero bienes. Cero deudas.
Cero gastos fijos. Cero transferencias.** Lo único con datos reales es la lista
de movimientos, con 25.

O sea que el patrimonio, el disponible real, la cobertura del fondo de
emergencia, el plan de pago de deudas y el calendario de vencimientos —todo lo
que se construyó en P4 y P5— **no tiene un solo dato real detrás**. Están
probados contra datos que puse yo.

No es que la función esté rota: es que nadie la alimentó nunca. Y hasta
anteayer no había forma de alimentarla hablando, que es como esta gente usa el
producto. `DECLARAR_SALDO` y `REGISTRAR_TARJETA` existen desde el 9 y el 10 de
septiembre; el Centro de atención existe desde hoy y es lo que se lo va a
pedir.

### Nadie pasó por el onboarding

Solo dos filas en `eos_onboarding`, las dos de usuarios sintéticos, las dos
paradas en el primer paso. **Ninguno de los seis reales lo hizo.**

El mecanismo funciona: `handle_new_user()` deja la fila —verificado contra
producción— y `app/auth/callback` redirige. Y quien ya tiene cuenta puede
rehacerlo desde Perfil. El camino existe entero.

Lo que pasa es que los seis reales se registraron antes de que ese camino
existiera, y nunca volvieron a pasar por ahí. No es un bug: es una deuda de
adopción, y se paga con el Centro de atención o a mano.

### El motor de aprendizaje aprende de sí mismo

206 aprendizajes, 148 de usuarios reales. Se miraron **todos**, y ni uno solo
es sobre el negocio o la plata de una persona.

Los de mayor confianza, que son los que llegaban al modelo:

> *"En pruebas QA, validar explícitamente la referencia de conversación antes
> de intentar GUARDAR_MEMORIA."*
> *"Mantener CREAR_TAREA como ruta preferente para flujos similares en v66."*

El motor aprende de la bitácora de acciones, así que aprende del sistema. Y el
prompt se los mostraba bajo el rótulo **"lo que con esta persona funcionó
antes"**, gastando tres renglones de cada mensaje en explicarle al modelo cómo
correr pruebas de QA.

Hoy se agregó un filtro: un aprendizaje que nombra la máquina no llega. Lo que
sobrevive son consejos de estilo conversacional —"abrir con un saludo corto"—
que tampoco son sobre el negocio, pero no engañan.

**Lo de fondo sigue abierto**: el motor tiene que aprender de la plata, no de
la bitácora. Eso es el workflow `eos-aprendizaje-resultados-v7`.

### El Business Twin sigue sin leerse

5 filas, 4 de usuarios reales: **n8n lo está llenando**. Y `grep business_twin
app lib` sigue dando cero. Es lo mismo que decía el diagnóstico de hace
semanas, y sigue igual: la tabla más rica del proyecto, con `intelligence_score`,
`gaps`, `risks` y `opportunities`, y nada la lee.

### Catorce áreas sin una sola prueba de su lógica

Tareas, Decisiones, Aprendizajes, Business Twin, las dos de Autonomía, ERP ·
compras, la cuenta corriente, Personal · cuentas, transferencias y política,
Onboarding, Auditoría y Pagos.

Algunas se prueban de refilón desde otro módulo. Otras no se prueban de ninguna
manera: **la puerta de autonomía y la auditoría encadenada —las dos piezas de
seguridad del sistema— no tienen una sola prueba propia.**

### Dos áreas que existen y no son funciones

**Onboarding** y **Pagos** fallan las tres: sin datos reales, sin verbo, sin
pruebas. En Pagos es esperable —la certificación Bancard está hecha y todavía
no hay cobros—; en Onboarding es el hallazgo de arriba.

---

## 2. Lo que sí está sano

**El chat.** 1.188 mensajes, 1.180 de usuarios reales, once archivos de prueba
sobre el gateway. Es lo más usado y lo más probado, en ese orden.

**El ERP.** Productos y ventas con datos reales y catorce archivos de prueba.
Es la parte del producto que alguien usa de verdad todos los días.

**Los indicadores.** 544 fotos diarias, 426 de usuarios reales, quince archivos
de prueba. La captura del cron funciona sin que nadie la mire, que es
exactamente lo que se le pide.

**La auditoría encadenada.** 227 filas, 219 de reales. Escribe. No tiene
pruebas propias, y ahí está su riesgo.

---

## 3. Lo que cambió hoy en el camino de esta auditoría

- **El modelo ya ve la posición de la persona** —cuentas, tarjetas, deudas,
  objetivos— con la fecha de cada saldo. Antes escribía ese dato y al mensaje
  siguiente no lo sabía.
- **El briefing ya sabe de plata.** No sabía ni un guaraní.
- **Las deudas ya aparecen**: el filtro pedía un `estado` que no existe, así
  que descartaba todo, siempre, para todos.
- **Las preguntas del usuario ya no vuelven como hechos suyos.**
- **Los aprendizajes de plomería ya no ocupan el prompt.**
- **Las frases del worker tienen pruebas**, después de que "Cerró 1 facturas"
  llegara a producción.
- **La huella del Worker Gate tiene pruebas.** Es lo único que impide que una
  venta se cargue dos veces, y no tenía ninguna: vivía en un archivo que
  importa `next/server`, donde ninguna prueba de `lib/` puede entrar. Se mudó a
  `lib/autonomia/huella.ts` —mudó, no copió— y el handler la importa de ahí.

  Escribirla encontró que `estable` aplastaba una fecha a `{}`, así que dos
  fechas distintas daban la misma huella. Hoy no es alcanzable, pero era una
  bomba con la mecha puesta en una función exportada.

---

## 4. Lo que haría a continuación, en este orden

1. **Que la gente cargue su plata.** Es el cuello de botella de todo Personal.
   El Centro de atención y `DECLARAR_SALDO` están; falta que la pantalla los
   muestre y que alguien mire si funciona.
2. **Probar la auditoría encadenada.** Sigue sin una sola prueba propia. La
   puerta de autonomía ya tiene la suya donde más dolía —ver abajo—, pero la
   decisión de nivel y el presupuesto diario tampoco están probados.
3. **Leer el Business Twin.** Está lleno y nadie lo abre.
4. **Que el motor de aprendizaje aprenda de la plata**, no de la bitácora.
5. **P9**, el recorrido de punta a punta con cuentas de QA que hoy no existen.

---

## 5. GO / NO-GO

**Para el chat y el ERP: GO.** Se usan, se prueban, y lo que se les agregó esta
semana se verificó hablando contra producción.

**Para Personal: GO técnico, NO-GO de producto.** Todo funciona y nadie lo usa.
Declarar que Personal está listo cuando ningún usuario real cargó una sola
cuenta sería exactamente lo que el encargo prohíbe: dar por terminado lo que no
se vio funcionar con datos de alguien.

**Para el conjunto: NO-GO hasta P9.** No por lo que falta construir, sino por
lo que falta probar — y ahora se suman la puerta de autonomía y la auditoría,
que no tienen red.

---

## Actualización del 8 de octubre de 2026

Encargo recibido: "Prompt maestro para Claude durante la aprobación de las
tiendas" (30 días, P0→P2, diagnóstico primero). Antes de escribir nada nuevo,
se volvió a correr `npx tsx scripts/auditar-areas.mts` contra producción — no
se confió en este documento, que ya tenía casi un mes.

```
Usuarios reales (10+ mensajes): 5 de 8 que hablaron alguna vez

ÁREA                        FILAS  DE REALES  VERBO                         PRUEBAS
Chat                          694        684  —                             29 lib
Personal · movimientos        148         88  REGISTRAR_MOVIMIENTO_PERSONAL 1 lib
Personal · cuentas              6          4  DECLARAR_SALDO                2 lib
Personal · tarjetas             5          4  REGISTRAR_TARJETA             1 lib
Personal · fijos               13         11  REGISTRAR_GASTO_FIJO          1 lib
Personal · deudas               7          1  REGISTRAR_DEUDA               1 lib
ERP · ventas                   78         51  REGISTRAR_VENTA               23 lib + 2 cert
ERP · compras                  30         19  REGISTRAR_COMPRA              2 lib + 1 cert
Objetivos                       0          0  CREAR_OBJETIVO                1 lib
Personal · transferencias       1          0  REGISTRAR_TRANSFERENCIA       —
Personal · bienes               0          0  —                             1 lib
Documentos                      0          0  —                             5 lib
Pagos                           0          0  —                             3 lib + 3 cert
```

(Tabla completa en la salida del script; acá solo lo que cambió o importa.)

**Lo que mejoró desde el 10/09, con datos reales detrás:** Personal dejó de
estar vacío. 4 de 5 usuarios reales ya declararon una cuenta, una tarjeta o un
gasto fijo — el hallazgo de aquel día ("todo funciona y nadie lo usa") ya no
es cierto tal cual. `business_twin` también pasó de 0 a 2 referencias en
`app`/`lib`: alguien empezó a leerlo.

**Lo que parece una regresión y no lo es:** `eos_goals` pasó de 54 filas (todas
"reales" por el criterio de 10+ mensajes) a 0. Verificado contra el esquema:
`eos_goals.usuario_id` tiene `on delete cascade` hacia `usuarios(id)`
(migración `20260811002731`). La purga del 19/09 de cuentas huérfanas y de
prueba (ver `lista-maestra.md`, punto de esa fecha) se llevó esas filas con
ella — eran de cuentas de certificación que el criterio de "10+ mensajes" no
distinguía de cuentas reales, exactamente el riesgo que esa misma auditoría ya
advertía en su sección "Quién es un usuario real". No es pérdida de datos de
un usuario real; es que el dato nunca fue de un usuario real.

**Housekeeping de git, no de producto:** la rama de trabajo
`fix/guarda-parche-finanzas` estaba 19 commits detrás de `main` (el único
commit propio ya había entrado por el PR #242, mergeado el 06/10). Se
actualizó `main` local a `origin/main` (`5cc39cb6`) y se cambió a esa rama.
Nada que mergear, nada perdido.

**`npm run go`: 9/9 automático.** Producción corre `5cc39cb6` = `main`.
Aislamiento 24/24. `npm test`: **2738/2738 en verde** (antes de este encargo
corría con `node --test`, no con `vitest`; invocar `vitest` directo cuenta
también los archivos de un worktree viejo en `.claude/worktrees/` y da un
falso 347 en rojo — hay que usar el script del `package.json`).

### Los cinco P0 del encargo, verificados hoy (no contra este documento)

| P0 del encargo | Estado hoy | Evidencia |
|---|---|---|
| 01 Aislamiento y permisos | **cerrado** | `npm run go`: RLS en toda tabla de `public`, 24/24 cruces sin fuga |
| 02 Finanzas e idempotencia | **cerrado** | Huella del Worker Gate con prueba propia; invariantes de `DECLARAR_SALDO`, cobros parciales, tarjetas con pruebas de base dedicadas |
| 03 Estados de ejecución | **cerrado** | `lib/eos/errores-accion.ts` traduce todo `EOS_ACCION_*`; frases del worker con 17+ casos |
| 04 Personal y negocio | **cerrado** | `ambito` separa las dos plata desde v136, con trigger; verificado en el panel y en el contexto del chat |
| 05 Privacidad y revisión | **parcial** | `/terminos`, `/privacidad`, borrado de cuenta y de archivos existen y tienen prueba; revisión legal de un profesional sigue sin hacerse (externo, punto 9 de `lista-maestra.md`) |

**Conclusión: no hay un P0 nuevo que corregir en código.** Los cinco ya están
cerrados con evidencia de hoy, no de hace un mes. Se continúa con activación,
que es donde el encargo pide seguir cuando no hay P0.

### Lo que de verdad falta, y a quién le toca

- **Tiendas: todavía no sometidas**, al contrario de lo que asume el encargo
  ("mientras esperamos la aprobación"). `docs/app-nativa/tiendas.md` (editado
  por última vez ayer, 07/10) lista lo pendiente: App Group en Apple
  Developer, abrir el proyecto en Xcode una vez, clave APNs, probar en un
  iPhone real, cuentas de Play Console y Apple Developer, firma. Ninguno se
  puede hacer desde esta sesión.
- **Piloto formal: no existe todavía.** El encargo pide reclutar 10-15
  negocios y seguirlos con un protocolo (día 0, 3, 7, 14). Hoy hay 5 cuentas
  reales sin ese proceso.
- **Costo por cuenta: sigue siendo estimado**, no contra facturas reales del
  mes.
- **Documentos y Pagos siguen en cero** de uso real; Pagos es esperable
  (Bancard productivo no está habilitado, punto 6 de `lista-maestra.md`).

### Primer cambio propuesto (no es P0; es el primer P1 con mínimo completo)

No hay bug P0 que arreglar hoy. El cambio propuesto es instrumentar la
activación que ya mejoró, para no volver a medirla "a ojo": un evento mínimo
por área de Personal (cuenta, tarjeta, fijo, deuda) cuando la llena un usuario
real, reusando `eos_eventos` si ya existe o la tabla que ya registra
`activado_v1` (v173). **Prueba de aceptación:** correr
`auditar-areas.mts` antes y después de que una cuenta de prueba declare una
cuenta y una tarjeta, y ver el evento aparecer con el `usuario_id` y el tipo
correctos, sin tocar ninguna tabla financiera.

Decisiones que le tocan al dueño, no a esta sesión (el propio encargo las
separa de lo técnico): segmento final del piloto, precio, y cuándo autorizar
exposición de usuarios reales nuevos. Se sigue sin pedir eso para avanzar con
lo demás.

### Lo que se hizo con la activación (PR #250 y #251), y el siguiente punto, verificado y no construido

Las dos columnas de activación de Personal y el resumen del embudo salieron
hoy mismo (ver `lib/sql/activado-personal.test.ts` y
`lib/monitoreo/salud.ts`). Antes de elegir el siguiente punto del backlog se
revisaron cuatro pendientes de auditorías anteriores **contra el código de
hoy, no contra lo que decían los documentos**:

| Pendiente citado antes | Veredicto de hoy |
|---|---|
| "Leer el Business Twin: está lleno y nadie lo abre" (sección 4, 10/09) | **Ya no es cierto, y no hace falta construirlo.** `eos_business_twins_v14` se llena desde `lib/kpi/capturar.ts`. Sus `risks` salen del mismo `detectarAnomalias` (`lib/kpi/anomalias.ts`) que ya consumen `app/api/finanzas/pulso` y `app/api/kpi/hallazgos`, mostrados en `FinanzasPulso.tsx` y `Hallazgos.tsx`. Construir un lector del Twin sería un segundo camino para el mismo dato que el usuario ya ve. |
| "Oportunidad con próxima acción" (encargo, sección 9) | **Ya está.** `lib/crm/seguimientos.ts`, `Embudo.tsx`, `TarjetaOportunidad.tsx` y `FichaCliente.tsx` lo leen y lo escriben desde la v185 (19/09). |
| Alertas de riesgo sin canal por defecto (`lista-maestra.md`, punto 20, medido 20/09) | **Ya está, desde el 21/09 (v190), un día después de esa medición.** `eos_followup_preferences.avisos_riesgo_correo` nace en `true`; la fila de la lista maestra quedó un día atrás de su propio arreglo. |
| "El movimiento de dos lados no tiene motor" (`docs/informe-autonomia.md`, sección 4) | **Parcialmente falso: el motor SÍ existe.** Ver la corrección en ese mismo documento (actualización del 08/10): `REGISTRAR_TRANSFERENCIA` no filtra por `ambito`, así que ya puede mover plata de una cuenta de negocio a una personal sin duplicar ingresos. Lo que falta es que el PROMPT lo diga — es un cambio al texto que gobierna el modelo en producción, no una migración. |

**Por qué se registra esto en vez de solo corregir los documentos:** cuatro
pendientes de cuatro resultaron total o parcialmente cerrados sin que nadie
lo hubiera verificado desde que se escribieron. Es el mismo patrón que el
encargo pide vigilar — "una lista que dice abierto para algo terminado
retiene trabajo por algo que ya está hecho" — y hoy pasó con una cuarta parte
de una lista corta.

**El único pendiente real que queda de esas cuatro listas es `CREAR_DECISION`**
(`docs/informe-autonomia.md`, punto 2): ninguna acción del chat registra una
decisión explícita hoy; `eos_decisions` se llena solo por extracción pasiva
de n8n. No se construyó en esta sesión porque agregar un verbo nuevo toca el
prompt de producción en nueve lugares (`sistema.test.ts` los enumera) y, a
diferencia de los cambios de hoy, no se puede probar con SQL y TypeScript
solos: pide corpus de evals contra el modelo real y, para producción, un
patch de n8n corrido desde `main` después de mergear. Es el candidato más
claro para la siguiente sesión dedicada, no para el cierre de esta.

### Actualización del 09/10/2026 — `CREAR_DECISION` construido, y la prueba de confianza financiera

`CREAR_DECISION` ya no es un pendiente: PR #253 (verbo completo, nueve
lugares), #254 (la v235 chocaba con Postgres por el orden de columnas de la
vista — corregido antes de que llegara a aplicarse en ningún entorno real) y
#255 (el E2E chocaba con `handle_new_user()`). Las dos migraciones (v235 y
v236) están aplicadas en producción y el patch de n8n (gateway y worker) está
corrido y verificado byte a byte contra lo que dice `main`.

A pedido explícito ("el producto debe tener un 100% de confianza
financiera"), se agregó `supabase/pruebas/invariantes_financieras_e2e.sql`:
el conjunto de prueba de resultado conocido de la sección 7 del encargo,
adaptado a cómo este producto realmente guarda la plata (saldo declarado, no
calculado) en vez del escenario genérico que describe el encargo. **25
comprobaciones, 25 en verde, corridas contra producción real** en una
transacción revertida — no contra una base de prueba. Cubre: saldo inicial,
ingreso y egreso con su neto, reintento técnico sin duplicar, reenvío
accidental detectado por contenido sin inflar el neto (la protección de la
v226, el caso Green), repetición intencional (`"repetir": true`) sí se
cuenta, transferencia entre cuentas propias sin tocar ingresos ni gastos,
una cuenta USD que nunca se mezcla con la PYG, anular restaura el neto
exacto, montos inválidos rechazados sin escribir nada, sin autorización no
se escribe, y aislamiento total entre dos cuentas (ni con sesión propia).

Al escribirla se encontró, de paso, que el escenario del encargo ("repetir
lo mismo intencionalmente crea una segunda fila") no es cómo funciona este
producto: un movimiento personal con el mismo tipo, monto y fecha que uno ya
anotado se detecta como probable duplicado y NO se inserta —es más
protector que el escenario genérico, no menos—, y hay que decir
explícitamente `"repetir": true` para que cuente como una segunda vez de
verdad. Es una protección ya construida (v226, 30/09), no algo que esta
sesión tuvo que agregar.

### Actualización del 09/10/2026 (tarde) — sección 9 (Operaciones y CRM), verificada

Reorganización de Personal construida (4 PRs: sidebar #256, detalle
colapsable #258, progreso de 14 días #261, impacto del mes #263 — las dos
últimas verificadas contra la captura real de la maqueta, extraída de
`Main.pdf`). Después de eso, se revisó qué quedaba del backlog y se encontró
un hueco concreto: ningún archivo de `supabase/pruebas/` ejercitaba
`REGISTRAR_COBRO` a través del ejecutor real — exactamente "vincular cobro y
consultar pendientes" de la sección 9 del encargo.

`supabase/pruebas/cliente_venta_cobro_e2e.sql`, corrida contra producción en
una transacción revertida: **15/15**. Cliente agendado, venta a crédito,
cobro parcial que no cierra la venta y ya aparece como ingreso del negocio,
segundo cobro que cierra exacto, sin pendientes un tercer cobro falla,
cobrar de más falla, aislamiento total entre dos cuentas. De paso apareció
una protección que no estaba documentada: `EOS_ACCION_COBRO_EXCEDE` — nunca
se cobra más de lo que el cliente debe.

Con esto, la sección 9 del encargo (cliente → venta → cobro → pendientes)
queda verificada contra producción, no solo contra código leído.

Un caso más del mismo barrido: T02 de la matriz de la sección 20 ("Miembro
consulta finanzas personales del dueño") y el punto 8 del encargo ("Un
miembro de la empresa no obtiene acceso a finanzas personales del dueño por
compartir organización") son distintos de todo lo probado hoy hasta acá —
`invariantes_financieras_e2e.sql` y `cliente_venta_cobro_e2e.sql` aíslan dos
cuentas SIN relación. `supabase/pruebas/miembro_empresa_sin_plata_personal_e2e.sql`
invita de verdad a un empleado a la empresa del dueño (RLS en vivo, no
service_role): **9/9**. El empleado ve la venta y el cliente que comparten,
y no ve ni una fila de la plata personal del dueño, ni una suma que la
disfrace de 0. La decisión de diseño que lo sostiene ya estaba escrita en la
v119 (04/09): las tablas de plata personal se quedan a propósito fuera de la
frontera por empresa. Esta prueba la verifica contra la base real en vez de
contra el comentario que la explica.
