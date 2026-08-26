// Stockage local structuré — équivalent web de la base SQLite embarquée
// utilisée côté React Native. Même rôle : permettre à l'agent de continuer
// à travailler (créer un signalement, consulter ses tâches) sans réseau,
// avec synchronisation différée dès que la connexion revient.
const DB_NAME = "hsse_local";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // File des actions créées hors-ligne, en attente d'envoi au serveur —
      // équivalent de la table pending_actions côté mobile.
      if (!db.objectStoreNames.contains("pending_actions")) {
        const store = db.createObjectStore("pending_actions", { keyPath: "clientId" });
        store.createIndex("syncStatus", "syncStatus");
      }

      // Copie locale des signalements de l'utilisateur, pour un affichage
      // même hors-ligne (écran de suivi, dashboard partiel).
      if (!db.objectStoreNames.contains("local_reports")) {
        db.createObjectStore("local_reports", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("local_tasks")) {
        db.createObjectStore("local_tasks", { keyPath: "id" });
      }

      // Horodatage du dernier sync réussi, pour le bandeau de fraîcheur des données.
      if (!db.objectStoreNames.contains("sync_meta")) {
        db.createObjectStore("sync_meta", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  await promisifyRequest(tx.objectStore(storeName).put(value));
}

async function dbGetAll(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  return promisifyRequest(tx.objectStore(storeName).getAll());
}

async function dbDelete(storeName, key) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  await promisifyRequest(tx.objectStore(storeName).delete(key));
}

async function dbGet(storeName, key) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  return promisifyRequest(tx.objectStore(storeName).get(key));
}
