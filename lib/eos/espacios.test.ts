import assert from "node:assert/strict";
import test from "node:test";

import { destinoDesdeUrl, espacioDe, menuNegocio } from "../../app/eos/components/espacios.ts";

test("los enlaces viejos de los correos siguen llevando al mismo lugar", () => {
  assert.equal(destinoDesdeUrl("briefing"), "briefing");
  assert.equal(destinoDesdeUrl("perfil"), "perfil");
  assert.equal(destinoDesdeUrl("calendario"), "calendario");
  assert.equal(destinoDesdeUrl("gastos"), "p-inicio");
  assert.equal(destinoDesdeUrl("negocio"), "n-resumen");
  assert.equal(destinoDesdeUrl("crm"), "n-clientes");
  assert.equal(destinoDesdeUrl("decisions"), "memoria");
  assert.equal(destinoDesdeUrl("n-fijos"), "n-fijos");
  assert.equal(destinoDesdeUrl("cualquiera"), null);
  assert.equal(destinoDesdeUrl(null), null);
});

test("cada destino sabe de qué espacio es", () => {
  assert.equal(espacioDe("p-fijos"), "personal");
  assert.equal(espacioDe("n-fijos"), "negocio");
  assert.equal(espacioDe("briefing"), "negocio");
  assert.equal(espacioDe("calendario"), null);
  assert.equal(espacioDe("chat"), null);
});

test("un negocio que apaga el catálogo no lo ve en el menú, y lo demás queda", () => {
  const sinCatalogo = menuNegocio(["catalogo"]).map((i) => i.destino);
  assert.equal(sinCatalogo.includes("n-catalogo"), false);
  assert.equal(sinCatalogo.includes("n-clientes"), true);
  assert.equal(sinCatalogo.includes("n-ventas"), true);
  assert.equal(menuNegocio([]).some((i) => i.destino === "n-catalogo"), true);
});
