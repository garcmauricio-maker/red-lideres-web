// Permite abrir la app sin internet (guarda los archivos de la app en el celular).
// Cambia la versión cada vez que publiques cambios para que los celulares se actualicen.
const VERSION = "lideres-v2";
const ARCHIVOS = ["./", "index.html", "app.css", "app.js", "config.js", "manifest.webmanifest",
                  "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // las llamadas a la base de datos van directo
  // Red primero (para recibir actualizaciones); si no hay señal, usa la copia guardada
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
