# Qué puede EJECUTAR EOS, y qué solo puede conversar

Fecha: **8 de septiembre de 2026**. Hecha contra el repositorio, contra los dos
workflows de n8n exportados y contra la base de producción.

El encargo pide una auditoría sistemática de todos los verbos que una persona
razonablemente espera pedirle a EOS, y por cada uno la pregunta que importa:

> ¿EOS puede realmente ejecutarla, o solamente hablar de ella?

## El patrón que hay que buscar

Una acción no está terminada porque aparezca en el prompt. Tiene que existir en
**todos** los puntos del circuito:

| # | Dónde | Qué pasa si falta |
|---|---|---|
| 1 | El prompt (`lib/gateway/sistema.ts` + nodo `HTTP Request` de n8n) | El modelo no la pide nunca |
| 2 | La forma de sus datos, en el mismo prompt | La pide con las claves equivocadas y el ejecutor no encuentra ninguna |
| 3 | La lista blanca del nodo `05 GW Preparar Respuesta` | Se descarta en silencio |
| 4 | El mapa `paths` del nodo `06 GW Preparar Jobs Worker` | No se arma el job |
| 5 | El allowlist de `01 INT Preparar` del worker | "Acción Worker no permitida" |
| 6 | `SYSTEM_RISK` en `lib/worker-gate-handler.ts` | El gate la rechaza en la puerta |
| 7 | Los tres `check` de la base | La fila no entra |
| 8 | La rama del ejecutor | Se acepta y no hace nada |
| 9 | La traducción del error | La persona lee "no pude" y nunca por qué |

**El punto 2 es el que se olvida sin hacer ruido.** Una acción con nombre y sin
forma de datos no falla: entra, escribe una fila incompleta y nadie se entera.
Es lo que le pasó a `CREAR_OBJETIVO` durante meses.

Y hay una trampa peor, ya documentada: **`GUARDAR_MEMORIA` tapa el hueco**.
Cuando falta el verbo operativo, el modelo hace lo único que puede —guardar el
pedido como memoria— y contesta con naturalidad. La persona cree que quedó
registrado. Pasó el 7 de septiembre con una conversación entera de porcicultura.

---

## NEGOCIO

| Lo que la persona pide | Verbo | Estado |
|---|---|---|
| "vendí 2 a María" | `REGISTRAR_VENTA` | **Ejecuta** |
| "compré 5 bolsas a 68.000" | `REGISTRAR_COMPRA` | **Ejecuta** |
| "agregá estos productos" | `CREAR_PRODUCTO` | **Ejecuta** |
| "el azul me sale 122.414 de costo" | `ACTUALIZAR_PRODUCTO` | **Ejecuta** |
| "contá 40 del azul", "se rompieron 3" | `AJUSTAR_STOCK` | **Ejecuta** |
| "agendá a María, RUC 80012345" | `CREAR_CONTACTO` | **Ejecuta** |
| "el alquiler del local son 2 millones" | `REGISTRAR_GASTO_FIJO` (ámbito negocio) | **Ejecuta** |
| "recordame llamar al proveedor" | `CREAR_TAREA` | **Ejecuta** |
| "quiero facturar 300 millones este año" | `CREAR_OBJETIVO` | **Ejecuta desde hoy** — el verbo existía sin forma de datos |
| "pasame un cuadro de ventas" | campo `documento` | **Ejecuta** (Excel, PDF, Word) |
| **"María me pagó la factura"** | — | **NO EXISTE.** `eos_erp_cobrar_venta` está en la base y sin verbo |
| **"pagué la compra al proveedor"** | — | **NO EXISTE.** `eos_erp_pagar_compra` está en la base y sin verbo |
| **"anulá esa venta"** | — | **NO EXISTE.** `eos_erp_anular_venta` está en la base y sin verbo |
| **"corregí la venta de ayer: eran 3, no 30"** | — | **NO EXISTE.** `eos_erp_editar_venta` está en la base y sin verbo |
| **"anotá una oportunidad con Pedro por 5 millones"** | — | **NO EXISTE.** El CRM solo se carga por pantalla |
| **"tomé la decisión de subir el precio"** | — | **NO EXISTE.** `eos_decisions` se llena desde n8n |

## PERSONAL

| Lo que la persona pide | Verbo | Estado |
|---|---|---|
| "gasté 50 mil en nafta", "cobré el sueldo" | `REGISTRAR_MOVIMIENTO_PERSONAL` | **Ejecuta** |
| "me devolvieron 200 mil de la camisa" | mismo verbo, `tipo: devolucion` | **Ejecuta** |
| "pasé un millón de Ueno a Continental" | `REGISTRAR_TRANSFERENCIA` | **Ejecuta** |
| "el alquiler de casa son 2 millones" | `REGISTRAR_GASTO_FIJO` (ámbito personal) | **Ejecuta** |
| "debo 8 millones a Financiera Ueno" | `REGISTRAR_DEUDA` | **Ejecuta** |
| "pagué la cuota de Ueno" | `REGISTRAR_PAGO_DEUDA` | **Ejecuta** |
| "quiero juntar 30 millones para diciembre" | `CREAR_OBJETIVO` | **Ejecuta desde hoy** |
| **"tengo 3 millones en Ueno"** | — | **NO EXISTE.** Las cuentas solo se cargan por pantalla |
| **"mi tarjeta cierra el 20 y vence el 5"** | — | **NO EXISTE.** Nuevo desde la v146 |
| "ese gasto de nafta era 80 mil, no 800 mil" | `CORREGIR_MOVIMIENTO` | **Ejecuta desde hoy** (v148) |
| **"borrá ese movimiento"** | — | **NO EXISTE** |
| **"saqué 2 millones del negocio para mí"** | — | **NO EXISTE.** Es el movimiento de dos lados |

---

## El orden en que conviene cerrarlos

No por cuántos son, sino por qué pasa cuando faltan.

**1. ~~Corregir un movimiento personal~~ — HECHO (v148).** Era el único verbo
cuya ausencia hacía que los errores de EOS fueran permanentes.

Probado de punta a punta contra producción: "gasté 800 mil en nafta" se anota,
y "ese gasto de nafta era 80 mil" devuelve *"Corregí nafta del 2026-09-08: de
₲ 800.000 a ₲ 80.000"*, con el monto anterior guardado en `metadata` — la tabla
no tiene historial, y sin eso una corrección es indistinguible de un dato que
siempre fue así.

No borra, a propósito: borrar por chat es la única operación donde una
coincidencia equivocada destruye un dato sin dejar rastro.

**2. Declarar el saldo de una cuenta.** Es el dato del que dependen el
patrimonio, el disponible real y la cobertura. Pedirlo por pantalla contradice
la doctrina —"EOS trabaja, el usuario observa"— justo en el dato más frecuente.

**3. Cobrar una venta a crédito.** La cartera existe, el RPC existe, el panel
existe. Sin el verbo, quien vende a crédito por chat tiene que ir a marcar el
cobro a otro lado, y la cartera envejece sola.

**4. Cargar una tarjeta.** Vertical nueva; hoy solo se carga por pantalla.

**5. Oportunidades del CRM.** El embudo está construido y probado, y se llena
a mano.

**6. Anular y corregir en el negocio.** Los RPC existen y son transaccionales.
Es el grupo más delicado: un `anular` por chat sobre la venta equivocada es
caro, y merece confirmación explícita aunque el resto se auto-apruebe.

---

## Cómo se agrega uno, sin romper el chat

El 7 de septiembre un parche puso una comilla invertida en el prompt. El prompt
de n8n vive dentro de un literal de plantilla de JavaScript, así que el cuerpo
entero de la petición pasó a ser JavaScript inválido. n8n aceptó el PUT sin una
palabra y el chat se cayó para todos.

Desde entonces el camino es:

1. Un módulo `n8n/parches/cambios-<tema>.mjs` con los reemplazos exactos, que
   falla si un ancla aparece cero o dos veces.
2. El mismo módulo aplicado al prompt del repo y al de n8n, para que la prueba
   de paridad pueda comprobar que son el mismo texto.
3. `verificarFlujo()` compila cada nodo y cada expresión **antes** del PUT.
4. Una prueba que prohíbe comillas invertidas en el prompt.
5. `node n8n/exportar.mjs` para que el repo tenga lo que está corriendo.

---

## Las tres listas que estaban viejas

Agregar `CORREGIR_MOVIMIENTO` destapó algo que no se veía: el gateway en
TypeScript —la etapa 1, detrás de la bandera `EOS_GATEWAY_TS`— tenía sus
propias copias de las listas de n8n, y las tres se habían quedado atrás.

| Lista | Tenía | n8n tenía |
|---|---|---|
| `ACCIONES_PERMITIDAS` (espejo del nodo 05) | 11 | 20 |
| `ACCIONES_INTERNAS` (espejo del allowlist del worker) | 6 | 20 |
| `RUTAS` (espejo del `paths` del nodo 06) | 3 | 12 |

Como ese gateway todavía no atiende producción, la diferencia no se veía. El
día que se prendiera la bandera, ocho acciones se habrían descartado en
silencio y una venta habría salido sin ruta.

Y había **dos pruebas que las daban por buenas**, con la lista copiada a mano y
el título "exactamente la de n8n". Dos listas clavadas que se copian entre sí no
prueban nada: se quedan viejas juntas y siguen en verde.

Las reemplazó un guard que las DERIVA de la lista de acciones del prompt, y que
además exige que toda acción tenga fila en `SYSTEM_RISK`. Para poder probarlo,
la tabla de riesgo se mudó a `lib/autonomia/riesgo.ts`: vivía en un archivo que
importa `next/server`, así que ninguna prueba de `lib/` podía tocarla.
