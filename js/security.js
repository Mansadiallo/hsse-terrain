// OWASP A03 (Injection) — Cross-Site Scripting :
// Sans framework qui échappe automatiquement (React, Vue...), toute donnée
// utilisateur insérée dans le DOM DOIT passer par escapeHtml() avant d'être
// utilisée dans un template littéral assigné à innerHTML. Ne jamais insérer
// une variable brute (ex. description d'un signalement) directement.
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

// Redirige vers la page de connexion si aucune session valide n'existe.
// Appelé en tête de chaque page protégée (dashboard, signalement, etc.).
// OWASP A01 (Broken Access Control) côté UI — le vrai contrôle reste RLS,
// mais ceci évite d'afficher une interface vide/cassée à un utilisateur non connecté.
async function requireSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    window.location.href = "/login.html";
    return null;
  }
  return data.session;
}

// Récupère le profil (rôle, zone, site) de l'utilisateur connecté.
// Le profil lui-même est protégé par RLS (profiles_select_own) : un
// utilisateur ne peut lire que son propre profil, sauf s'il est directeur.
async function getCurrentProfile() {
  const { data: authData } = await supabaseClient.auth.getUser();
  if (!authData.user) return null;

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("id, name, role, site_id, zone_id")
    .eq("id", authData.user.id)
    .single();

  if (error) {
    console.error("Impossible de charger le profil :", error.message);
    return null;
  }
  return profile;
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "/login.html";
}

// Enregistre le Service Worker — active le mode offline-first pour toute
// l'application. Appelé une fois par page via initOfflineSupport().
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.warn("Échec de l'enregistrement du Service Worker :", err);
  }
}

// Bandeau persistant reprenant la même décision que côté React Native :
// en cas de données obsolètes (hors-ligne prolongé), afficher un
// avertissement explicite avec horodatage plutôt que présenter
// silencieusement des données potentiellement périmées.
const STALE_THRESHOLD_HOURS = 24;

async function renderSyncBanner() {
  const existing = document.getElementById("sync-banner");
  if (existing) existing.remove();

  const lastSync = await getLastSyncTimestamp();
  const isOnline = navigator.onLine;
  const isStale = !lastSync || (Date.now() - new Date(lastSync).getTime()) / 36e5 > STALE_THRESHOLD_HOURS;

  if (isOnline && !isStale) return; // rien à signaler

  const banner = document.createElement("div");
  banner.id = "sync-banner";
  banner.style.cssText =
    "background:var(--warning-bg);color:var(--warning-text);padding:10px;text-align:center;font-size:13px;font-weight:500;";
  banner.textContent = isOnline
    ? `Dernière mise à jour il y a plus de ${STALE_THRESHOLD_HOURS}h`
    : "Hors ligne — en attente de reconnexion";

  document.body.prepend(banner);
}

// Point d'entrée unique appelé en tête de chaque page protégée : enregistre
// le Service Worker, tente une synchronisation, affiche le bandeau de statut,
// et se met à jour automatiquement au moindre changement de connectivité.
async function initOfflineSupport() {
  await registerServiceWorker();
  trySync();
  await renderSyncBanner();
  registerForPushNotifications();

  window.addEventListener("online", renderSyncBanner);
  window.addEventListener("offline", renderSyncBanner);
}
