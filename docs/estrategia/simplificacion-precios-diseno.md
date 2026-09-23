# Simplificar la vitrina de precios sin tocar el motor (punto 9 del plan de fortalecimiento)

**Aclaración importante antes de proponer nada:** el modelo de "armá tu EOS"
(`app/planes/page.tsx`, `lib/modulos/armado.ts`) fue una decisión explícita del
usuario, con una razón de negocio sólida y ya documentada en el propio código:
los cinco planes anteriores obligaban a quien solo quería conversar a pagar
un panel que no usaba, y viceversa. **Esta propuesta no busca deshacer esa
decisión.** Busca resolver un problema distinto y compatible: la primera
pantalla le pide a alguien que todavía no conoce el producto que arme su
propio combo antes de entender qué está comprando — carga cognitiva que
compite con la promesa central de EOS ("no tenés que ocuparte").

## La propuesta: presets, no planes nuevos

Agregar, **arriba** del armador actual (que se mantiene intacto, tal cual
está), una sección de 2-3 combinaciones ya armadas, calculadas con el mismo
`calcularArmado()` que ya existe — no son planes nuevos ni precios nuevos, son
tres selecciones de módulos ya elegidas de antemano:

| Preset sugerido | Módulos que prende | A quién le habla |
|---|---|---|
| **Empezar** | Solo el tramo de conversaciones (EOS Conversacional) | Alguien que quiere probar hablándole a EOS antes de comprometerse con nada más — el panel financiero personal ya es gratis para todos, así que ni siquiera hace falta prenderlo acá |
| **Negocio** | Conversaciones + Dashboard + ERP | El ICP validado por la evidencia real: dueño de pyme que carga ventas/compras/stock por chat |
| **Negocio completo** | Todo lo de "Negocio" + CRM + Briefing + Facturación | Quien ya sabe que quiere el paquete entero |

Cada preset es un botón que **pre-llena la selección del armador existente**
(el mismo estado de React que ya maneja `elegidasDeLaUrl` / el picker de
módulos) y deja al usuario en la misma pantalla de siempre, con todo
editable. No es una pantalla nueva ni un flujo paralelo — es un atajo hacia
el flujo que ya existe.

## Por qué así y no reemplazando el armador

- **Cero riesgo para el motor de precios.** El servidor sigue recalculando
  todo desde `eos_modulos` / `eos_precio_armado`, exactamente como ya
  documenta el propio archivo ("el servidor ignora cualquier total que le
  mande el navegador") — los presets nunca tocan esa garantía porque no son
  más que una preselección del mismo estado.
- **No hay que mantener un catálogo separado de "planes"** que se desincronice
  de los módulos reales — los presets son, literalmente, una lista de códigos
  de módulo, recalculada en vivo.
- **Reversible en un commit:** si los presets no ayudan a la conversión, se
  saca esa sección y el armador sigue exactamente como estaba.

## Qué falta para implementarlo

1. Definir la lista exacta de códigos de módulo por preset (los tres de
   arriba son una propuesta, no una decisión — confirmar contra el catálogo
   vigente en `eos_modulos`, que puede haber cambiado desde que se escribió
   este documento).
2. Un componente chico arriba del armador actual, con los tres presets como
   tarjetas, cada una mostrando su precio total (mismo cálculo que ya usa la
   página) y un botón "Elegir este" que llama a la misma función que ya
   actualiza `elegidasDeLaUrl` / el estado de módulos seleccionados.
3. Registrar qué preset eligió cada cuenta (o si armó el suyo desde cero) en
   `solicitudes_pago.metadata` — ya existe `armado_id`, agregar
   `preset_origen` ahí es aditivo, no rompe nada del cobro existente.

## Advertencia sobre el estado del código

**No leí `app/planes/page.tsx` completo para este documento** — solo lo
suficiente para confirmar la arquitectura y la razón de negocio. Cualquier
sesión que implemente esto debe releer el archivo entero primero, en
particular la advertencia ya escrita ahí sobre styled-jsx (no estila
componentes custom como `<Link>`, rompe solo en producción) y sobre no usar
`useSearchParams` (rompe el prerenderizado del servidor).
