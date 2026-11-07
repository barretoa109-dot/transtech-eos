# Pagos interoperables, Open Finance y Universal Commerce — qué decidir, con información real (07/11/2026)

Ítems 06, 07 y 09 del documento EOS 2030. A diferencia de multiagente,
Developer Platform y offline-first, estos tres no se resuelven con una
sesión de diseño técnico: dependen de qué existe hoy en Paraguay y de a
quién conoce el dueño. Esto es una investigación real (búsqueda web,
07/11/2026), no una propuesta de arquitectura — las fuentes van al pie de
cada sección.

## Ítem 07 — Pagos interoperables: MENOS bloqueado de lo que parecía

Lo que se pensaba: "hace falta negociar con un banco o una pasarela nueva".
Lo que la investigación encontró: **probablemente no haga falta un socio
nuevo — Bancard, con quien EOS ya tiene integración, ES la red
interoperable del país.**

- El Banco Central del Paraguay aprobó en 2025 el estándar **PY-QR**, y
  rebautizó su sistema de pagos SIPAP como **SIP** en abril de 2026, con un
  **QR Hub** para interoperabilidad de pagos por QR entre entidades.
- La red de QR de **Bancard ya conecta más de 75 apps locales** (bancos,
  financieras, cooperativas, billeteras) bajo ese mismo estándar PY-QR, con
  más de 181.000 comercios aceptándolo (subiendo de 120.000 el año
  anterior).
- Fuentes no coinciden en si el QR Hub del BCP ya está en plena producción
  o sigue en prueba (un artículo de agosto de 2026 dice que sigue en
  pruebas; otro, de la misma época, dice que ya hizo ~250.000 operaciones
  por US$ 4 millones en su primer mes). **No hay documentación pública de
  una API de Bancard o del BCP para que un sistema externo (como EOS)
  genere o reciba estos QR directamente** — eso no apareció en ninguna
  fuente pública.

**Lo que esto cambia:** el próximo paso no es "buscar un socio de pagos".
Es una conversación concreta con el contacto comercial que TransTech YA
tiene en Bancard, preguntando específicamente: ¿tiene Bancard una API de
comercio para generar o recibir cobros por el QR interoperable (PY-QR), más
allá de la app de cobro que ya tienen los comercios? Si la respuesta es sí,
este ítem se reduce a una integración con un socio EXISTENTE, no a abrir
una relación nueva.

**Fuentes:**
- [ABC Color — Paraguay, último en facturar, bueno en pagar con QR y ya prueba el QR Hub](https://www.abc.com.py/negocios/2026/08/06/paraguay-ultimo-en-facturar-bueno-en-pagar-con-qr-y-ya-prueba-el-qr-hub/)
- [Infonegocios — QR interoperable debuta con cerca de 250.000 operaciones y US$ 4 millones en su primer mes](https://infonegocios.com.py/amp/default/qr-interoperable-debuta-con-cerca-de-250-000-operaciones-y-us-4-millones-en-su-primer-mes)
- [La Nación — Nace "SIP": la evolución de pagos del Paraguay](https://www.lanacion.com.py/negocios/2026/04/27/nace-sip-la-evolucion-de-pagos-del-paraguay/)
- [ABC Color — BCP rebautiza SIPAP, que ahora se llama SIP](https://www.abc.com.py/negocios/2026/04/27/bcp-rebautiza-sipap-que-ahora-se-llama-sip-en-que-afecta-a-los-usuarios/)
- [BCP — Resolución GG N° 22-2026, Implementación del componente QR Hub del SPI](https://www.bcp.gov.py/documents/20117/1485220/Resoluci%C3%B3n+GG+N%C2%B0+22-2026+de+fecha+06-03-2026+-+IMPLEMENTACI%C3%93N+DEL+COMPONENTE+QR+HUB+DEL+SISTEMA+DE+PAGOS+INSTANT%C3%81NEOS+(SPI)+DEL+SISTEMA+DE+PAGOS+DEL+PARAGUAY.pdf/af5494e2-978f-b1bd-0339-76cc0ecc9540)

## Ítem 06 — Open Finance Connector: no es una decisión, es una ausencia de infraestructura

**Paraguay no tiene, hoy, un marco regulatorio formal de open banking/open
finance.** Ningún banco está obligado a exponer datos de sus clientes por
API a un tercero autorizado, y no hay un estándar común que varios bancos
sigan a la vez (a diferencia de Europa con PSD2/PSD3, o de Brasil con su
propio Open Finance). Los directorios que listan "bancos paraguayos con
API" son de marketing comercial, no evidencia de una regulación — cada
banco que expone algo lo hace a su manera, sin obligación ni estándar.

**Lo que esto significa:** este ítem no se destraba con una decisión de
negocio ni con una reunión. Se destraba cuando (si) el BCP o el gobierno
paraguayo defina un marco de open finance — igual que el ítem 26
(indicadores sectoriales) está bloqueado por falta de escala, este está
bloqueado por falta de una regulación que todavía no existe. Queda
archivado, no pendiente: no hay nada que TransTech pueda hacer hoy para
avanzarlo por su cuenta, más allá de pedir acceso bilateral a un banco
puntual (una negociación caso por caso, sin ningún estándar detrás, que se
rompería apenas se quisiera agregar un segundo banco).

**Fuentes:**
- [Open Banking Tracker — Open Banking in Paraguay](https://openbankingtracker.com/country/paraguay)
- [Fiskil — Open Banking by Country: Global Open Finance Tracker 2026](https://www.fiskil.com/open-finance-tracker)

## Ítem 09 — Universal Commerce Connector: no hay una plataforma obvia, y la respuesta la tiene el dueño, no una búsqueda

El comercio electrónico paraguayo mueve cerca de **USD 3.000 millones**
(4,8% del PIB) y crece ~23% anual, pero la investigación NO encontró una
plataforma dominante única que use la mayoría de las PyMEs paraguayas —a
diferencia de, por ejemplo, Shopify en EE.UU. o Mercado Libre en
Argentina/Brasil. Lo que sí apareció:

- Plataformas locales como **Fenicio eCommerce** (trabaja con Farmacenter,
  Sallustro, Bristol, entre otras) y el propio **Bancard** (premiado en la
  categoría "Plataformas, Logística y Soluciones" de los eCommerce Awards
  2026).
- Mercado Libre aparece mencionado solo en el contexto de acuerdos de
  exportación (Exporta Fácil/ALADI), no como la plataforma doméstica de
  venta.

**Lo que esto significa:** no hay una integración "obvia" que construir
especulando. La pregunta real para el dueño es: *de los clientes actuales
de EOS, ¿alguno vende en una plataforma de e-commerce puntual (su propia
tienda en Fenicio, un catálogo de WhatsApp Business, algo más) con la que
valga la pena integrar primero?* Sin esa respuesta, cualquier conector
sería una apuesta sin evidencia — exactamente lo que la regla de prioridad
del propio documento EOS 2030 pide evitar.

**Fuentes:**
- [Infonegocios — El e-commerce local se acerca a US$ 3.000 millones y al 5% del PIB](https://infonegocios.com.py/nota-principal/el-e-commerce-local-se-acerca-a-us-3-000-millones-y-al-5-del-pib-apunta-a-llevar-las-ventas-a-mercados-internacionales)
- [Ecosistema Startup — Paraguay: eCommerce Day 2026 llega a US$3.000M con IA](https://ecosistemastartup.com/paraguay-ecommerce-day-2026-llega-a-us3-000m-con-ia/)
- [Última Hora — Comercio electrónico paraguayo se acerca a US$ 3.000 millones](https://www.ultimahora.com/comercio-electronico-paraguayo-se-acerca-a-usd-3-000-millones)

## Resumen para decidir

| Ítem | Estado real | Qué hace falta |
|---|---|---|
| 07 — Pagos interoperables | Probablemente alcanzable vía Bancard, sin socio nuevo | Una pregunta concreta al contacto comercial de Bancard sobre API de cobro por QR interoperable |
| 06 — Open Finance | No existe el marco regulatorio en Paraguay | Nada que hacer hoy; archivar hasta que el país lo defina |
| 09 — Universal Commerce | Sin plataforma dominante identificada | Preguntarle a los clientes reales de EOS qué plataforma usan, si alguna |
