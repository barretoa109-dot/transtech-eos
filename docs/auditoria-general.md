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
