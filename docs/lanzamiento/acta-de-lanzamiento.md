# Acta de lanzamiento — borrador para firmar

Punto 10 de la lista maestra. Una hoja que deja escrito qué se lanza, cuándo,
qué riesgos se aceptan a sabiendas y qué haría frenar. La firma el dueño; los
espacios en blanco los completa él.

**Fecha de lanzamiento:** ____________

**Modalidad** (tachar la que no va): piloto controlado con 3 a 5 clientes
conocidos · venta abierta.

## Qué se lanza

- **Alcance:** `docs/lanzamiento/alcance-congelado.md`, versión del
  26/09/2026. La sección 1 se ofrece como disponible, la 2 como beta, y la 3
  no se nombra.
- **Canales:** la web (`www.transtech.com.py`) y WhatsApp.
- **Cobro:** transferencia bancaria, conciliada a mano (`/api/admin/pagos`).
  La tarjeta se habilita en octubre, con Bancard en producción.

## Evidencia técnica al día de la firma

| Qué | Resultado |
|---|---|
| `npm run go` contra producción | ____________ (el 24/09 dio GO, 9/9) |
| CI de `main` | ____________ |
| iPhone con Safari y Android con Chrome: registro, chat, micrófono, app instalada | ____________ |
| Dos cuentas de prueba: A registra una venta, B no la ve, A la ve en Negocios | ____________ |

## Riesgos que se aceptan a sabiendas

| Riesgo | Hasta cuándo |
|---|---|
| Supabase en plan gratuito: sin copias automáticas ni vuelta atrás al minuto. La copia diaria en la PC del dueño no incluye las cuentas de acceso y su restauración nunca se ensayó | Primer cliente pago |
| Vercel en plan Hobby: los crons corren una vez por día, así que un pago puede tardar hasta 24 h en conciliarse | Primer cliente pago |
| Cobro con tarjeta apagado | Octubre, con Bancard en producción |
| El WhatsApp de empresa recibe pero no envía | Cuando Meta habilite el envío |
| Términos y privacidad sin revisión de un abogado | ____________ |
| Los mensajes con foto, el briefing diario y el registro de decisiones siguen pasando por n8n (Railway); el resto del chat ya corre en Vercel (etapa 3) | Cuando las fotos pasen al gateway en TypeScript |

## Qué frena el lanzamiento

- Una falla grave abierta: datos de una cuenta visibles desde otra, un plan
  pago activado sin pagar, o datos perdidos.
- `npm run go` en FALLA sin causa conocida.
- Un cobro con resultado desconocido sin resolver.

## Firma

Producto y técnico — Augusto: ____________ Fecha: ________

Legal — cuando el abogado revise: ____________ Fecha: ________
