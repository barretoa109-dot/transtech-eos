/**
 * La cuenta a la que se transfiere para pagar EOS.
 *
 * Una sola definición para la pantalla de pago (que la muestra) y para el
 * agente que revisa comprobantes (que la compara contra lo que dice el
 * comprobante). Si estuvieran en dos lugares, el día que cambie la cuenta la
 * pantalla mandaría la plata a un lado y el agente aprobaría la otra.
 *
 * No es un secreto: es exactamente lo que se le muestra a quien va a pagar.
 */
export const CUENTA = {
  banco: "Banco Continental S.A.E.C.A.",
  titular: "TRANSTECH E.A.S.",
  numero: "060061320004",
  ruc: "80174259-5",
  moneda: "Guaraníes",
} as const;
