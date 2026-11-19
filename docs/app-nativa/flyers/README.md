# Flyers para la ficha de App Store

Siete piezas de 1290 × 2796 px (iPhone 6,9"), listas para subir en `png/`
(App Store acepta hasta 10). Cuentan una sola idea: **EOS ayuda a crecer
financieramente desde cualquier situación**, con mejor administración,
organización y uso de los recursos. Se dice como ayuda, nunca como resultado
garantizado.

| # | Etiqueta | Título | Pantalla que muestra |
|---|---|---|---|
| 1 | TransTech EOS | Crecé con tu plata, desde donde estés | Personal → Informes → Tu progreso (patrimonio neto, resultado mes a mes) |
| 2 | Organización | Ordená tu plata hablando | Chat: registrar una venta con una frase y preguntar cómo viene el mes |
| 3 | Administración | Sabé cuánto te queda de verdad | Personal → Mi mes → Cuánto me queda / En qué se fue |
| 4 | Deudas | Ordená tus deudas con un plan | Personal → Tengo y debo → Deudas: orden de pago con motivo y borradores para negociar |
| 5 | Ahorro y metas | Avanzá con un plan | Personal → Mis metas → Objetivos |
| 6 | Tu negocio | Que tu negocio también crezca | Negocio: Vender / Comprar / Catálogo / Números y "EOS te avisa" |
| 7 | Documentos | Tus documentos, desde el chat | Chat: subir un comprobante y bajar el balance en Excel, PDF o Word |

**Son maquetas ilustrativas, no capturas.** Usan los colores, la tipografía
(Inter) y los nombres de pestañas reales de la app (`app/eos-design/tokens.css`,
`NegocioView.tsx`, `GastosView.tsx`, `FinanzasProgreso.tsx`,
`FinanzasPlanDeudas.tsx`, `FinanzasObjetivos.tsx`, `MessageBubble.tsx`),
pero la disposición en el teléfono es una aproximación. Todos los datos son
ficticios ("Comercio Demo", "Cliente Demo", "Movimiento de prueba") y cada
pantalla lleva "Vista de demostración · datos ficticios". Reemplazar por
capturas verificadas cuando haya un teléfono o simulador con la cuenta de prueba.

Cada función mostrada existe en la app (componentes citados arriba). No se
muestran conexión con bancos, pagos, precios ni planes. El flyer de deudas
aclara en pantalla que el plan es una propuesta y que EOS no paga por la persona.

Para regenerar: `NODE_PATH=$(npm root -g) node docs/app-nativa/flyers/render.mjs`
(o sin `NODE_PATH` si `playwright` está instalado en el proyecto).
