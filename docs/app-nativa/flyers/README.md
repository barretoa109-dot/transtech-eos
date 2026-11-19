# Flyers para la ficha de App Store

Seis piezas de 1290 × 2796 px (iPhone 6,9"), listas para subir en `png/`.

| # | Etiqueta | Título | Pantalla que muestra |
|---|---|---|---|
| 1 | Conversá con EOS | Anotá tu negocio hablando | Chat: registrar una venta con una frase y preguntar cómo viene el mes |
| 2 | Negocio | Tu negocio, más organizado | Negocio: Vender / Comprar / Catálogo / Números, resumen y "EOS te avisa" |
| 3 | Ventas y cobros | Sabé qué vendiste y qué te deben | Negocio → Vender → Por cobrar |
| 4 | Finanzas personales | Entendé cómo viene tu mes | Personal → Mi mes → Cuánto me queda / En qué se fue |
| 5 | Objetivos | Avanzá con un plan | Personal → Mis metas → Objetivos |
| 6 | Documentos | Tus documentos, desde el chat | Chat: subir un comprobante y bajar el balance en Excel, PDF o Word |

**Son maquetas ilustrativas, no capturas.** Usan los colores, la tipografía
(Inter) y los nombres de pestañas reales de la app (`app/eos-design/tokens.css`,
`NegocioView.tsx`, `GastosView.tsx`, `FinanzasObjetivos.tsx`, `MessageBubble.tsx`),
pero la disposición en el teléfono es una aproximación. Todos los datos son
ficticios ("Comercio Demo", "Cliente Demo", "Movimiento de prueba") y cada
pantalla lleva "Vista de demostración · datos ficticios". Reemplazar por
capturas verificadas cuando haya un teléfono o simulador con la cuenta de prueba.

Cada función mostrada está en la descripción de `ficha-app-store.md`. No se
muestran conexión con bancos, pagos, precios ni planes.

Para regenerar: `NODE_PATH=$(npm root -g) node docs/app-nativa/flyers/render.mjs`
(o sin `NODE_PATH` si `playwright` está instalado en el proyecto).
