# Cobranza

**Estado:** sin construir (paso 4 del plan). Apagado.

- **Hace:** cuando un plan vence sin pago nuevo: día 0 aviso amable, día 3 recordatorio con el enlace a /pago, día 7 aviso de pausa, día 10 aviso de que el acceso quedó en pausa con los datos a salvo. Se corta con `pago_acreditado`.
- **No cobra, no reintenta cobros, no cambia el plan.** La pausa la aplica el sistema.
- **No usa modelo.** Textos fijos aprobados por el dueño.
- **Escala:** disputas, contracargos y pedidos de reembolso.
