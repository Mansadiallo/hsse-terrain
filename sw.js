// Service Worker — permet à l'application de se charger et de rester
// utilisable même sans connexion réseau, conformément au principe
// offline-first retenu dans les spécifications (usage terrain avec
// connectivité fluctuante).
const CACHE_NAME = "hsse-shell-v1";

// L'App Shell : le strict nécessaire pour que l'interface s'affiche hors-ligne.
// Les données elles-mêmes (signalements, tâches) transitent par IndexedDB,
// pas par ce cache — voir js/offlineDb.js et js/syncQueue.js.
const SHELL_FILES = [
  "/index.html",
  "/login.html",
  "/dashboard.html",
  "/report.html",
  "/report-followup.html",
  "/team-lead-validation.html",
  "/settings.html",
  "/assign-task.html",
  "/css/main.css",
  "/js/supabaseClient.js",
  "/js/security.js",
  "/js/offlineDb.js",
  "/js/syncQueue.js",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Supprime les caches d'une version précédente du Service Worker,
  // pour éviter de servir indéfiniment une ancienne version de l'app shell.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Ne jamais mettre en cache les appels à l'API Supabase — ils doivent
  // toujours tenter le réseau en premier, avec échec propre géré par la
  // logique applicative (syncQueue.js) si hors-ligne. Mettre ces requêtes
  // en cache produirait des données obsolètes présentées comme fraîches,
  // contraire au principe de fraîcheur retenu dans les spécifications.
  if (url.hostname.includes("supabase.co")) {
    return; // laisse la requête suivre son chemin réseau normal
  }

  // Pour l'app shell (fichiers statiques) : stratégie "cache d'abord,
  // réseau en repli" — l'app doit s'ouvrir instantanément même hors-ligne.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).catch(() => {
          // Repli ultime pour une navigation hors-ligne vers une page
          // non mise en cache : renvoie le dashboard plutôt qu'une erreur brute.
          if (event.request.mode === "navigate") {
            return caches.match("/dashboard.html");
          }
        })
      );
    })
  );
});

// Réception d'une notification push envoyée par l'Edge Function send-push.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json();

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload.data,
      icon: "/icons/icon-192.png",
    })
  );
});

// Ouvre directement l'écran concerné au clic — ferme la boucle de façon
// proactive plutôt que d'attendre une consultation manuelle.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let targetUrl = "/dashboard.html";
  if (data.type === "TASK_ASSIGNED") targetUrl = "/dashboard.html";
  if (data.type === "REPORT_UPDATED" && data.reportId) targetUrl = `/report-followup.html?id=${data.reportId}`;

  event.waitUntil(clients.openWindow(targetUrl));
});
