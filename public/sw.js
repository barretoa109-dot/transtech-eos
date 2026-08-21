const CACHE_NAME = "transtech-eos-v1";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/transtech-logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }

        const responseClone = response.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });

        return response;
      });
    })
  );
});

/* =========================================================
   NOTIFICACIONES PUSH

   El navegador despierta al service worker para entregar el mensaje, así
   que estos manejadores tienen que ser autosuficientes: no hay página
   abierta ni estado en memoria del que depender.
========================================================= */

self.addEventListener("push", (event) => {
  // Si el payload viene roto, igual se muestra algo: una notificación vacía
  // es mala, pero una notificación que no aparece hace que el usuario deje
  // de confiar en el canal.
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = {};
  }

  const titulo = datos.titulo || "EOS";
  const opciones = {
    body: datos.cuerpo || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    lang: "es",
    // Sin vibración ni requireInteraction a propósito: la doctrina pide que
    // EOS baje la ansiedad, no que interrumpa. Una notificación diaria que
    // vibra y se queda fija en pantalla se desactiva en una semana.
    tag: datos.tag || "eos-briefing",
    renotify: false,
    data: { url: datos.url || "/eos/chat" },
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const destino = (event.notification.data && event.notification.data.url) || "/eos/chat";

  // Si EOS ya está abierto en alguna pestaña, se reutiliza en vez de abrir
  // otra: nadie quiere doce pestañas de la misma app.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientes) => {
      for (const cliente of clientes) {
        if (cliente.url.includes("/eos") && "focus" in cliente) {
          cliente.navigate(destino);
          return cliente.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
