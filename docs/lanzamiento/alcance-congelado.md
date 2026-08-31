# Alcance congelado de lanzamiento

Estado: **borrador para firma**. Fecha: 31 de agosto de 2026.

Este documento define qué se anuncia, qué se anuncia como beta y qué no se
nombra todavía. Mientras no esté firmado, nada se publica.

La regla que ordena todo lo demás: **una función se anuncia cuando su recorrido
completo funciona, está autorizado, auditado y probado.** No cuando el código
existe. La diferencia entre las dos cosas es la fuente de casi toda queja
evitable.

---

## 1. Lo que se anuncia como disponible

Son los módulos públicos del catálogo (`eos_modulos.es_publico = true`) cuyo
recorrido está cerrado de punta a punta.

| Módulo | Precio mes | Qué se promete exactamente |
| --- | --- | --- |
| Conversaciones | Gs. 45.000 | Hablar con EOS, 300 mensajes por mes, con memoria y contexto. |
| Conversaciones sin freno | Gs. 90.000 | 1.000 mensajes por mes. |
| Conversaciones ilimitadas | Gs. 150.000 | Sin tope de mensajes. |
| Panel financiero | Gs. 20.000 | Disponible real, ingresos y egresos, en cada moneda que tengas. |
| Briefing diario | Gs. 25.000 | El resumen del día por correo, en horario de Paraguay. |
| Documentos a pedido | Gs. 25.000 | Balance, cuadro o informe en Excel, PDF o Word. |
| Decisiones y aprendizajes | Gs. 15.000 | Lo que decidiste, cómo salió, qué aprendió EOS. |

Tope del armado: **Gs. 500.000**, prendiendo todo. El catálogo está calibrado
para que la suma dé exactamente eso; agregar un módulo con precio obliga a
rebalancear (ver v73).

### Condición para que esta lista quede firme

Cada fila de arriba necesita, antes de la firma:

- un recorrido completo hecho por una persona distinta de quien lo implementó;
- comportamiento definido ante error, reintento y conexión cortada;
- evidencia guardada de la corrida.

Hasta que eso exista para un módulo, **ese módulo baja a la sección 2.**

---

## 2. Lo que se anuncia como beta

Beta significa: se puede contratar, funciona, y el usuario sabe de antemano qué
parte todavía no está. El nombre lo dice, no solo la descripción — en una lista
de doce módulos la gente lee nombres.

| Módulo | Qué falta, dicho en la pantalla |
| --- | --- |
| **Comprobantes de venta (beta)** — Gs. 0 | Hace numeración correlativa, CDC de 44 dígitos y comprobante imprimible. **No** firma ni envía a SIFEN. El papel sale rotulado como borrador. Ya resuelto en la v87. |
| **ERP (beta)** — Gs. 120.000 | Productos, ventas, compras, stock, anulación y ajustes: cerrado. **No** hay empresas con miembros y sucursales, ni depósitos, ni cuenta corriente con vencimientos y cuotas, ni kardex valorizado. Ver `docs/erp-profesional-arquitectura.md`. |
| **CRM (beta)** — Gs. 90.000 | Contactos, oportunidades y actividades: cerrado. Falta embudo, razones de pérdida y reportes de desempeño. |
| **Lectura automática** — Gs. 35.000 | Lee avisos bancarios por correo. **No** hay conexión directa con bancos, cooperativas ni billeteras: eso es importación, no integración, y así hay que decirlo. |
| **Avisos antes de que pase** — Gs. 20.000 | Avisa faltante de dinero y vencimientos. La cobertura de riesgos de inventario y cobranzas depende del ERP, que está en beta. |

### Decisión tomada el 2026-08-31

ERP y CRM eran públicos **sin** la marca de beta, y no son módulos baratos: el
ERP es el segundo más caro del catálogo. Se decidió rotularlos, igual que
comprobantes en la v87. La migración `20260831120000_..._v92.sql` renombra a
"ERP (beta)" y "CRM (beta)" y pone en la descripción qué no hay todavía.

Los precios no se tocan: el tope de Gs. 500.000 está calibrado con ellos
adentro (150.000 de conversaciones ilimitadas + 20.000 + 25.000 + 25.000 +
35.000 + 20.000 + 15.000 + 120.000 + 90.000 = 500.000 exacto).

---

## 3. Lo que NO se nombra todavía

No aparece en la vitrina, no está en el material comercial, no se menciona en
una demo, y EOS no lo ofrece en una conversación.

- **Factura electrónica aprobada por SIFEN.** Falta certificado, firma, envío,
  respuesta, rechazo, reintento, contingencia y eventos. Nada de eso depende
  solo de nosotros. Hasta entonces la palabra es "comprobante", nunca "factura".
- **Conexión automática con bancos, cooperativas, financieras y billeteras.**
  El campo `origen='integracion'` está reservado y no hay integración detrás.
- **Empresas, sucursales, miembros y roles.** El tenant hoy es `usuario_id`.
- **Depósitos, ubicaciones, transferencias, lotes, series, vencimientos, kardex.**
- **Ciclo documental de compras y ventas** (orden, cotización, pedido, recepción
  parcial, entrega parcial, nota de crédito).
- **Caja y tesorería** (turno, arqueo, cierre, diferencias).
- **Apps en Android y iOS.** El proyecto Capacitor existe; las tiendas exigen
  D-U-N-S, cuentas, políticas y verificaciones que todavía no están resueltas.
  Se lanza web primero.

---

## 4. Lo que el material comercial no puede decir

Frases prohibidas hasta que la sección 3 se mueva:

- "factura electrónica" / "facturá con EOS" — es un comprobante interno.
- "se conecta con tu banco" — es lectura de correo, y solo si el usuario la
  activa.
- "ERP completo" / "sistema de gestión completo" — falta lo de la sección 3.
- "multiempresa" / "para tu equipo" — el tenant es una persona, no una empresa.
- Cualquier cifra de ahorro, rendimiento o resultado que no salga de un dato
  medido y citable.

La página principal hoy dice "Gestión empresarial integrada para centralizar
ventas, compras, inventario, clientes y finanzas". Es defendible: EOS hace las
cinco cosas. Deja de serlo si al lado aparece la palabra "completo" o un
comparativo contra un ERP instalado.

---

## 5. Quién firma

| Rol | Qué firma |
| --- | --- |
| Producto | Las secciones 1, 2 y 3. |
| Legal | Términos, privacidad, consentimiento, eliminación de cuenta, tratamiento de datos financieros (punto 9). |
| Técnico | Que cada fila de la sección 1 cumple la definición de terminado. |

Sin las tres firmas no hay lanzamiento. Con un P0 abierto tampoco, aunque estén
las tres.
