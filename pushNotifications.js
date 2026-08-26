// Clé publique VAPID — sans risque à exposer côté client, comme toute clé
// publique de signature (seule la clé privée, gardée côté Edge Function,
// permet réellement d'envoyer des notifications).
const VAPID_PUBLIC_KEY = "BP18jWoZV5CreuxLSTAa5O0KZ3nG1QRDW1Pfc9HlO8P4X7TdEmyR4-DH78__zP5-LuUSJPPs3yTEw26LEuccEKo";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

// Demande la permission et enregistre l'abonnement auprès de Supabase.
// Un échec de permission n'empêche jamais l'usage du reste de l'application —
// la notification est un confort, pas un prérequis fonctionnel.
async function registerForPushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const registration = await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const profile = await getCurrentProfile();
  if (!profile) return;

  const subJson = subscription.toJSON();

  // Protégé par la policy "push_subscriptions_insert_own" : un utilisateur
  // ne peut enregistrer un abonnement qu'à son propre nom.
  await supabaseClient.from("push_subscriptions").upsert(
    {
      user_id: profile.id,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth_key: subJson.keys.auth,
    },
    { onConflict: "endpoint" }
  );
}
