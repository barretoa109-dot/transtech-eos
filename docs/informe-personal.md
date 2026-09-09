# Personal, de P0 a P8: qué estaba mal y qué quedó

Fecha: **8 de septiembre de 2026**. Escrito contra el repositorio, contra los
dos workflows de n8n y contra la base de producción — no contra documentos.

El encargo pedía convertir Personal en una vertical tan profunda como Negocio,
auditando antes de programar y sin duplicar lo que ya existía.

---

## El hallazgo que ordenó todo

**El motor ya estaba construido. Lo que faltaba casi nunca era el cálculo.**

Diecinueve módulos en `lib/finanzas/` resolvían, en producción, cosas que el
encargo pedía construir: proyección de caja día por día, detección de
recurrencia, plan de pago con su motivo, riesgo de quedarse corto antes de una
fecha, trazabilidad de cada cifra.

`/api/finanzas/plan` llevaba semanas calculando en qué orden pagar las deudas,
a quién negociarle y en cuántos meses se sale. **Ninguna pantalla lo mostraba.**

Por eso el trabajo no empezó por funciones nuevas.

---

## Lo que estaba mal, y se corrigió

Nueve defectos. Siete aparecieron **verificando contra datos reales**, no
leyendo código.

### 1. La plata del negocio caía en el panel personal

Los ₲ 2.638.000 de lechones, balanceado y combustible de un negocio de
porcicultura aterrizaron en el panel que contesta "¿estoy bien?" sobre las
finanzas de la persona.

**Causa:** una sola tabla para las dos cosas.
**Arreglo:** columna `ambito` con un trigger que fuerza `negocio` a todo lo que
viene del ERP (v136) — escrito en un lugar, válido para lo que se escriba
mañana. Y `npm run ambito`, un candado de CI que aísla cada consulta a las
tablas de plata y exige que declare cuál mira. Probado en rojo.

### 2. El préstamo del auto bajaba el capital de trabajo del negocio

La posición del NEGOCIO leía `eos_finanzas_deudas` sin filtro. Su propio
comentario decía que esas deudas "viven del lado personal", y las sumaba igual
al pasivo corriente de la empresa.

**Arreglo:** el ámbito llegó a cuentas y deudas (v143). El candado vigila ahora
seis tablas y 78 consultas, no dos y 29.

De paso: el PUT de cuentas borraba TODAS las del usuario antes de reinsertar.
Sin filtro de ámbito, guardar las cuentas de la persona habría borrado las del
negocio en silencio — el mismo error que ya se había cometido con los fijos.

### 3. Mover plata entre cuentas contaba como gasto Y como ingreso

Pasar un millón de un banco a otro inflaba las dos columnas.

**Arreglo:** tabla propia (v138), no un `tipo` nuevo. Veintitrés archivos leen
`tipo`, y uno que se olvidara habría contado mal en silencio.

### 4. Una devolución aparecía como ingreso nuevo

Le inflaba a la persona lo que cobró en el mes —y con eso su capacidad de
ahorro— y encima dejaba el gasto original entero en su categoría.

**Arreglo:** gasto de monto negativo (v141), para que reste solo en las
veintitrés consultas que suman gastos, sin tocar ninguna.

La prueba de esto encontró que `acumular` en `destinos.ts` descartaba todo
`monto <= 0` como importe roto.

### 5. Una cuota pagada se seguía proyectando como pendiente

Registrado "pagué la cuota de Ueno" el día 8, el calendario la mostraba
pendiente el 10. El presupuesto la contaba dos veces: como gasto consumido **y**
como obligación por venir.

**Causa:** el filtro de duplicados solo miraba compromisos con fecha futura.

### 6. El panel mostraba −49.500.000 sobre un saldo de 15.500.000

El más caro de todos, y apareció verificando el pulso contra una cuenta real.
Dos causas:

**La asimetría.** Un gasto con fecha futura entraba a la línea de tiempo y
descontaba; un ingreso con fecha futura no entraba en ningún lado. Esa cuenta
tenía, para el 20 de septiembre, un gasto de 65.000.000 y 130.000.000 de
ingresos. El panel restaba los 65 y no sumaba los 130.

**El corte inclusivo.** El disponible real contesta *cuánto puedo usar del tramo
que tengo que atravesar con lo que hay hoy*, y ese tramo termina cuando entra
plata. Con `<=`, un gasto del mismo día del cobro se restaba contra un saldo que
no lo incluía.

Y la regla estaba escrita a mano en **tres** lugares, así que corregir uno solo
habría hecho que el panel y la historia dejaran de coincidir. Ahora vive en
`tramoHastaElProximoIngreso`.

### 7. Un disponible negativo se reportaba como "bien"

El indicador no tenía ningún umbral, y la convención del motor es informar
"bien" cuando hay valor. Sobre un −49.500.000 eso es una mentira.

**Arreglo:** el único umbral que no depende de la persona, el cero.

### 8. "No fue posible ejecutar el efecto interno"

Una orden falló por una clave foránea y el chat dijo eso: sin código y sin
motivo, indistinguible de que el servidor se hubiera caído. Averiguarlo llevó
veinte minutos con acceso al log de n8n y a la base.

**Arreglo:** las clases 22, 23 y 42 de Postgres se traducen a la única
distinción que le sirve a la persona — *esto no es culpa de lo que escribiste*.
El detalle queda en el log: puede traer datos de otra fila y no le dice nada a
nadie. Las clases que sí pueden ser pasajeras quedan afuera, para que un
reintento que iba a funcionar no se lea como un fallo definitivo.

### 9. Tres listas del gateway en TypeScript se habían quedado atrás

| Lista | Tenía | n8n tenía |
|---|---|---|
| `ACCIONES_PERMITIDAS` | 11 | 20 |
| `ACCIONES_INTERNAS` | 6 | 20 |
| `RUTAS` | 3 | 12 |

Como ese gateway vive detrás de una bandera y no atiende producción, no se veía.
El día que se prendiera, ocho acciones se habrían descartado en silencio.

Peor: **dos pruebas las daban por buenas**, con la lista copiada a mano y el
título "exactamente la de n8n". Dos listas clavadas que se copian entre sí no
prueban nada.

**Arreglo:** un guard que las DERIVA de la lista del prompt, y que además exige
que toda acción tenga fila en `SYSTEM_RISK`.

---

## Lo que se conectó, sin construir nada

- **El plan de pago.** `/api/finanzas/plan` calculaba el orden con su motivo, a
  quién negociarle con el mensaje redactado, y en cuántos meses se sale.
  Faltaba la pantalla.
- **Los objetivos.** `eos_goals` guardaba `valor_objetivo` y `fecha_limite`
  desde hacía meses. Faltaba atarlos a la plata.
- **La historia diaria de indicadores.** `eos_kpi_historia_v105` la escribía el
  cron y no alimentaba ninguna vista personal.
- **El detector de anomalías y el score.** `lib/kpi/` los tenía, para el
  negocio. Personal aprendió a hablar ese idioma en vez de estrenar un segundo
  motor: dos formas de decidir "qué es grave" habrían divergido en un mes.

---

## Lo que se construyó

| | Módulo | Pruebas |
|---|---|---|
| Calendario financiero | `calendario.ts` | 5 |
| Presupuesto que arma EOS | `presupuesto.ts` | 11 |
| Objetivos atados a la plata | `objetivos.ts` | 15 |
| Fondo de emergencia | `fondoEmergencia.ts` | 9 |
| Patrimonio | `patrimonio.ts` | 9 |
| Tarjetas de crédito | `tarjetas.ts` | 18 |
| Pulso y salud explicable | `pulso.ts` | 14 |
| Escenarios | `escenarios.ts` | 12 |

Y ocho verbos de chat nuevos o completados: `CREAR_PRODUCTO`,
`ACTUALIZAR_PRODUCTO`, `REGISTRAR_COMPRA`, `REGISTRAR_GASTO_FIJO`,
`REGISTRAR_MOVIMIENTO_PERSONAL`, `REGISTRAR_TRANSFERENCIA`, `REGISTRAR_DEUDA`,
`REGISTRAR_PAGO_DEUDA`, `CORREGIR_MOVIMIENTO`, y la forma de datos de
`CREAR_OBJETIVO`.

### Las reglas que no se negociaron

- **Nada de "tres a seis meses" de fondo.** Es una recomendación de economías
  con seguro de desempleo. EOS calcula lo que cuesta cada opción con el gasto
  esencial de esa persona y la deja elegir.
- **El margen del presupuesto no se inventa.** Sale de la mediana de sus meses
  anteriores. Sin historial no hay margen, y se dice: alguien podría gastar
  hasta el límite creyendo que tiene un colchón que nadie calculó.
- **El patrimonio se niega a dar un neto** mientras falte una mitad. Verificado:
  con tres deudas y ninguna cuenta cargada devuelve `null`, no −10.800.000.
- **Ni tasas, ni intereses, ni cargos de tarjeta.** Y `cuota × cuotas` NO es lo
  que costó la compra si hubo financiación.
- **Cuatro de los ocho umbrales del pulso salen de la persona:** su porcentaje
  de ahorro, los meses de cobertura que eligió, su propia mediana de gasto.
- **Un escenario no escribe nada.** Preguntar "¿puedo comprar una notebook?" no
  puede dejar rastro de una notebook que nadie compró.

---

## Lo que se verificó contra producción

| Qué | Resultado |
|---|---|
| Presupuesto con datos reales | Encontró la cuota contada dos veces |
| Patrimonio sin cuentas cargadas | `neto: null` con el motivo, no −10.800.000 |
| Tarjeta con dos compras en cuotas | TRES vencimientos en 90 días, no seis |
| Efecto de la tarjeta en el panorama | La diferencia es exactamente sus obligaciones |
| Captura diaria del pulso | Ocho indicadores escritos, cero fallidos |
| El disponible de una cuenta real | De −49.500.000 a los 15.500.000 que tiene |
| `CREAR_OBJETIVO` por chat | "apartar ₲ 7.500.000 por mes durante cuatro meses" |
| `CORREGIR_MOVIMIENTO` por chat | "Corregí nafta del 2026-09-08: de ₲ 800.000 a ₲ 80.000" |

Todos los datos de prueba quedaron borrados.

---

## Lo que sigue incompleto

**Diez verbos de chat.** Están en `docs/autonomia/verbos.md` con el orden en que
conviene cerrarlos. Los tres primeros:

1. **Declarar el saldo de una cuenta.** Es el dato del que dependen el
   patrimonio, el disponible real y la cobertura, y hoy se pide por pantalla —
   lo contrario de la doctrina, justo en el dato más frecuente.
2. **Cobrar una venta a crédito.** La cartera, el RPC y el panel existen; sin el
   verbo, la cartera envejece sola.
3. **Cargar una tarjeta.** Vertical nueva, todavía solo por pantalla.

**El recorrido visual con sesión iniciada.** La pantalla exige login y no uso
credenciales. La reorganización de Personal en siete subáreas compila, construye
y pasa el candado del modo oscuro, pero **nadie la vio funcionando**. Es el
primer caso del recorrido de P9.

**El E2E maestro (P9).** Registro, confirmación, recuperación, dos usuarios
simultáneos, refresh durante la ejecución, doble clic. Necesita cuentas de QA
que hoy no existen.

---

## Qué riesgo queda

**Alto**

- **La pantalla reorganizada no se probó a ojo.** Compila y construye; eso no es
  lo mismo que verse bien.
- **`OPENAI_API_KEY` no está en Vercel.** El gateway en TypeScript —que quitaría
  unos nueve segundos de latencia— no puede prenderse. Y sus tres listas
  acababan de estar viejas: prenderlo sin el guard que se agregó hoy habría
  descartado ocho acciones en silencio.

**Medio**

- **Diez verbos faltan**, y `GUARDAR_MEMORIA` sigue pudiendo tapar el hueco:
  cuando falta el verbo operativo, el modelo guarda el pedido como memoria y
  contesta con naturalidad. La persona cree que quedó registrado.
- **El esquema no se puede reconstruir desde cero.** Unas cuarenta tablas
  —incluidas `usuarios` y `planes`— existen en producción y nunca fueron
  capturadas como DDL.
- **Un documento ingerido dos veces deja movimientos duplicados.** Se vio en una
  cuenta real: cuatro ingresos del 20 de septiembre, dos de ellos idénticos. No
  hay deduplicación en la ingesta.

**Bajo**

- `adminSinTipos()` salta RLS y el filtro que escribe cada ruta ES la seguridad.
  `npm run rutas` lo vigila.
- El redondeo de IVA pierde centavos en moneda extranjera.

---

## GO / NO-GO comercial

**Para Personal: GO condicionado.**

Lo que decide un cliente que paga —¿me ahorra trabajo?, ¿puedo confiar en el
número?, ¿sé de dónde salió?— está resuelto: cada cifra dice su procedencia, su
confianza y qué le falta, y el sistema prefiere callarse antes que inventar.

Las dos condiciones son las de arriba: **mirar la pantalla reorganizada** y
**cerrar los tres primeros verbos**, sobre todo el saldo de cuenta, porque sin
él el patrimonio y la cobertura dependen de un formulario.

**Para el conjunto: NO-GO hasta P9.** No por lo que falta construir, sino por lo
que falta *probar*: registro, recuperación de contraseña, dos usuarios
simultáneos y refresh durante una ejecución no se ejercitaron nunca de punta a
punta. Ninguno es difícil; ninguno está hecho.
