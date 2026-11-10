/**
 * Conciliación de extracto: el diff línea por línea entre lo que dice el
 * banco y lo que el usuario ya anotó en EOS.
 *
 * No reemplaza a `conciliacion.ts` — ese módulo estima un ritmo de gasto
 * invisible agregado, sin ver ningún movimiento puntual. Este mira los
 * movimientos puntuales: los que salen de `extraerMovimientos` al leer un
 * extracto bancario adjuntado en el chat, contra los que ya existen en
 * `eos_movimientos_financieros` para el mismo período.
 *
 * A propósito no hay pantalla propia: el resultado se cuenta en el chat como
 * contexto del mensaje (igual que `contexto_negocio`), y se resuelve con los
 * verbos que ya existen (`REGISTRAR_MOVIMIENTO_PERSONAL` y afines). Agregar
 * un apartado nuevo sería repetir el patrón que la doctrina de EOS Finanzas
 * rechaza: que el usuario tenga que ir a revisar algo en vez de que EOS se lo
 * cuente.
 *
 * Puro, sin I/O, como el resto de `lib/finanzas`: acá se decide qué le falta
 * anotar al usuario, no se escribe nada todavía.
 */

export type MovimientoCandidato = {
  finding_id: string;
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number;
  moneda: "PYG" | "USD";
  descripcion: string;
  fecha: string | null;
};

export type MovimientoAnotado = {
  id: string;
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number;
  moneda: "PYG" | "USD";
  descripcion: string;
  fecha: string; // ISO YYYY-MM-DD
};

export type ItemFaltante = {
  categoria: "pagaste_y_no_anotaste";
  candidato: MovimientoCandidato;
};

export type ItemDuplicado = {
  categoria: "anotado_dos_veces";
  candidato: MovimientoCandidato;
  anotados: MovimientoAnotado[];
};

export type ItemMontoDistinto = {
  categoria: "monto_distinto";
  candidato: MovimientoCandidato;
  anotado: MovimientoAnotado;
};

export type ItemSinBanco = {
  categoria: "no_esta_en_el_banco";
  anotado: MovimientoAnotado;
};

export type ItemConciliacion = ItemFaltante | ItemDuplicado | ItemMontoDistinto | ItemSinBanco;

export type ResultadoConciliacionExtracto = {
  /** Lo que dice el banco menos lo que dice EOS, en valor absoluto por resolver. */
  diferencia_caja: number;
  moneda: "PYG" | "USD";
  items: ItemConciliacion[];
  /** Cuántos candidatos del extracto no tuvieron ninguna discrepancia. */
  coinciden: number;
};

const DIA_MS = 86_400_000;

/** Ventana de tolerancia: un pago con tarjeta puede acreditarse un día después. */
const TOLERANCIA_DIAS = 2;

function aFecha(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).getTime();
}

function diasEntre(a: string, b: string): number {
  return Math.abs(aFecha(a) - aFecha(b)) / DIA_MS;
}

function fechaCercana(a: string | null, b: string): boolean {
  if (!a) return true; // Sin fecha en el candidato, no se descarta por fecha.
  return diasEntre(a, b) <= TOLERANCIA_DIAS;
}

/**
 * ¿Este anotado puede ser el mismo movimiento que este candidato?
 *
 * Mismo tipo, misma moneda, mismo monto exacto (un extracto no redondea) y
 * fecha dentro de la tolerancia. No hace falta que coincida la descripción:
 * "Biggie Parana Country" en el banco y "supermercado" en lo anotado son el
 * mismo gasto, y exigir texto igual perdería ese caso, que es el más común.
 */
function mismoMovimiento(candidato: MovimientoCandidato, anotado: MovimientoAnotado): boolean {
  return (
    candidato.tipo === anotado.tipo &&
    candidato.moneda === anotado.moneda &&
    candidato.monto === anotado.monto &&
    fechaCercana(candidato.fecha, anotado.fecha)
  );
}

/**
 * Compara los movimientos de un extracto bancario contra lo ya anotado.
 *
 * `anotados` debe venir ya filtrado al período que cubre el extracto — este
 * módulo no sabe de fechas de corte, solo empareja lo que recibe.
 */
export function conciliarExtracto(
  candidatos: MovimientoCandidato[],
  anotados: MovimientoAnotado[],
): ResultadoConciliacionExtracto {
  const items: ItemConciliacion[] = [];
  const anotadosUsados = new Set<string>();
  let coinciden = 0;

  for (const candidato of candidatos) {
    // Un compromiso (vencimiento futuro) no es un movimiento ya ocurrido:
    // no tiene con qué conciliar todavía.
    if (candidato.tipo === "compromiso") continue;

    const posibles = anotados.filter(
      (a) => !anotadosUsados.has(a.id) && mismoMovimiento(candidato, a),
    );

    if (posibles.length === 0) {
      // Puede ser un monto distinto del mismo gasto (ej. propina redondeada),
      // no solo ausencia total. Se busca un anotado de la misma fecha con un
      // monto cercano antes de darlo por "no anotado" sin más.
      const parecido = anotados.find(
        (a) =>
          !anotadosUsados.has(a.id) &&
          a.tipo === candidato.tipo &&
          a.moneda === candidato.moneda &&
          fechaCercana(candidato.fecha, a.fecha) &&
          a.monto !== candidato.monto &&
          Math.abs(a.monto - candidato.monto) / Math.max(a.monto, candidato.monto) <= 0.2,
      );

      if (parecido) {
        anotadosUsados.add(parecido.id);
        items.push({ categoria: "monto_distinto", candidato, anotado: parecido });
      } else {
        items.push({ categoria: "pagaste_y_no_anotaste", candidato });
      }
      continue;
    }

    if (posibles.length === 1) {
      anotadosUsados.add(posibles[0].id);
      coinciden += 1;
      continue;
    }

    // Más de un anotado igual al mismo candidato: se anotó de más. El
    // primero se cuenta como el gasto real, el que sí pasó; el resto queda
    // como duplicado a resolver, y los dos se marcan usados para que no
    // vuelvan a aparecer como "no está en el banco" en la segunda pasada.
    for (const p of posibles) anotadosUsados.add(p.id);
    coinciden += 1;
    items.push({ categoria: "anotado_dos_veces", candidato, anotados: posibles.slice(1) });
  }

  for (const anotado of anotados) {
    if (anotadosUsados.has(anotado.id)) continue;
    items.push({ categoria: "no_esta_en_el_banco", anotado });
  }

  const moneda = candidatos[0]?.moneda ?? anotados[0]?.moneda ?? "PYG";

  const diferencia_caja = items.reduce((total, item) => {
    switch (item.categoria) {
      case "pagaste_y_no_anotaste":
        return total + item.candidato.monto;
      case "monto_distinto":
        return total + Math.abs(item.candidato.monto - item.anotado.monto);
      case "anotado_dos_veces":
        return total + item.anotados.reduce((s, a) => s + a.monto, 0);
      case "no_esta_en_el_banco":
        return total + item.anotado.monto;
      default:
        return total;
    }
  }, 0);

  return { diferencia_caja, moneda, items, coinciden };
}

/**
 * El mensaje que EOS manda por chat, en el mismo tono que el resto de
 * finanzas: cuenta el estado, no pide que el usuario abra nada.
 */
export function contarResultado(resultado: ResultadoConciliacionExtracto): string {
  if (resultado.items.length === 0) {
    return "Revisé el extracto: coincide todo con lo que ya tenías anotado.";
  }

  const simbolo = resultado.moneda === "USD" ? "US$" : "₲";
  const formato = (n: number) => new Intl.NumberFormat("es-PY").format(n);

  const faltantes = resultado.items.filter(
    (i): i is ItemFaltante => i.categoria === "pagaste_y_no_anotaste",
  );
  const duplicados = resultado.items.filter(
    (i): i is ItemDuplicado => i.categoria === "anotado_dos_veces",
  );
  const distintos = resultado.items.filter(
    (i): i is ItemMontoDistinto => i.categoria === "monto_distinto",
  );
  const sinBanco = resultado.items.filter(
    (i): i is ItemSinBanco => i.categoria === "no_esta_en_el_banco",
  );

  const partes: string[] = [];
  if (faltantes.length > 0) {
    partes.push(`${faltantes.length} que pagaste y no anotaste`);
  }
  if (duplicados.length > 0) {
    partes.push(`${duplicados.length} que anotaste de más`);
  }
  if (distintos.length > 0) {
    partes.push(`${distintos.length} con un monto distinto al del banco`);
  }
  if (sinBanco.length > 0) {
    partes.push(`${sinBanco.length} que anotaste y el banco no tiene`);
  }

  return (
    `Revisé el extracto: quedan ${simbolo} ${formato(resultado.diferencia_caja)} por resolver — ` +
    `${partes.join(", ")}. Decime cuáles anoto y los dejo al día.`
  );
}
