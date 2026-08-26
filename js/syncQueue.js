// Équivalent web de syncQueue.js côté React Native — même principe :
// toute action est d'abord écrite en local (écriture optimiste), puis
// synchronisée dès que le réseau le permet. L'utilisateur reçoit une
// confirmation immédiate, indépendamment de l'état de sa connexion.

function generateClientId() {
  return crypto.randomUUID();
}

// Upload générique d'un fichier photo vers le bucket privé Supabase
// Storage — utilisée à la fois par le formulaire (upload immédiat si en
// ligne) et par la file de synchronisation (upload différé si l'action a
// été créée hors-ligne). Centralisée ici pour éviter la duplication.
async function uploadPhotoFile(file) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const fileExt = file.name.split(".").pop();
  const filePath = `${profile.id}/${crypto.randomUUID()}.${fileExt}`;

  const { error } = await supabaseClient.storage
    .from("report-photos")
    .upload(filePath, file, { contentType: file.type });

  if (error) {
    console.error("Échec de l'upload de la photo :", error.message);
    return null;
  }

  // Le bucket est privé (public: false) — une URL signée est nécessaire,
  // valable un temps limité plutôt qu'une URL publique permanente.
  const { data: signedData, error: signedError } = await supabaseClient.storage
    .from("report-photos")
    .createSignedUrl(filePath, 60 * 60 * 24 * 365);

  if (signedError) {
    console.error("Impossible de générer l'URL de la photo :", signedError.message);
    return null;
  }

  return signedData.signedUrl;
}

// Ajoute une action à la file locale (ex. création d'un signalement).
// Retourne immédiatement — l'appelant n'attend pas la confirmation serveur.
async function queueAction(type, payload) {
  const clientId = generateClientId();
  await dbPut("pending_actions", {
    clientId,
    type,
    payload,
    createdAtClient: new Date().toISOString(),
    syncStatus: "pending",
  });

  trySync();
  return clientId;
}

let syncInProgress = false;

// Envoie les actions en attente une par une directement à Supabase — à la
// différence du backend Node.js (qui exposait un endpoint /sync/push
// dédié), ici chaque action est une opération Supabase normale, protégée
// par les mêmes policies RLS que le reste de l'application. La logique de
// conflit reste la même : si l'action échoue parce que la ligne a déjà été
// modifiée entre-temps, elle est marquée en conflit plutôt que réessayée
// indéfiniment ou écrasée silencieusement.
async function trySync() {
  if (syncInProgress) return;
  if (!navigator.onLine) return;

  syncInProgress = true;
  try {
    const pending = await dbGetAll("pending_actions");
    const toSync = pending.filter((a) => a.syncStatus === "pending");

    for (const action of toSync) {
      const result = await applyAction(action);
      if (result.status === "accepted") {
        await dbDelete("pending_actions", action.clientId);
      } else {
        await dbPut("pending_actions", { ...action, syncStatus: result.status });
      }
    }

    await pullChanges();
    await dbPut("sync_meta", { key: "last_sync", value: new Date().toISOString() });
  } catch (err) {
    console.warn("Échec de synchronisation, nouvelle tentative plus tard.", err);
  } finally {
    syncInProgress = false;
  }
}

async function applyAction(action) {
  try {
    if (action.type === "CREATE_REPORT") {
      const payload = { ...action.payload };

      // Si une photo était restée locale (upload initial impossible car
      // hors-ligne), on retente l'upload maintenant, avant l'insertion du
      // signalement — la photo doit atteindre Supabase Storage avant que
      // le signalement associé ne soit synchronisé.
      if (payload.localPhotoFile && !payload.photo_url) {
        const uploadedUrl = await uploadPhotoFile(payload.localPhotoFile);
        if (uploadedUrl) {
          payload.photo_url = uploadedUrl;
        }
        // Si l'upload échoue encore, le signalement part sans photo pour
        // l'instant — mieux vaut synchroniser le signalement lui-même que
        // de bloquer indéfiniment l'ensemble de la file sur ce point.
      }
      delete payload.localPhotoFile; // jamais envoyé tel quel à Supabase

      const { error } = await supabaseClient.from("reports").insert(payload);
      return error ? { status: "rejected" } : { status: "accepted" };
    }

    if (action.type === "VALIDATE_REPORT") {
      const { reportId, status, comment } = action.payload;

      const { data: current } = await supabaseClient
        .from("reports")
        .select("status")
        .eq("id", reportId)
        .single();

      if (current && current.status !== "SENT" && current.status !== "SEEN") {
        return { status: "conflict" };
      }

      const { error } = await supabaseClient.from("reports").update({ status }).eq("id", reportId);
      if (error) return { status: "rejected" };

      if (comment) {
        await supabaseClient.rpc("add_report_comment", { p_report_id: reportId, p_comment: comment });
      }
      return { status: "accepted" };
    }

    if (action.type === "UPDATE_TASK_STATUS") {
      const { taskId, status } = action.payload;
      const { error } = await supabaseClient.from("tasks").update({ status }).eq("id", taskId);
      return error ? { status: "rejected" } : { status: "accepted" };
    }

    if (action.type === "CREATE_TASK") {
      // Protégé par la policy "tasks_insert" : un chef d'équipe ne peut
      // réussir cet insert que si zone_id correspond à sa propre zone —
      // vérifié côté base, indépendamment de ce que proposait le formulaire.
      const { error } = await supabaseClient.from("tasks").insert(action.payload);
      return error ? { status: "rejected" } : { status: "accepted" };
    }

    return { status: "rejected" };
  } catch {
    return { status: "rejected" };
  }
}

// Récupère les changements serveur pour peupler le cache local — permet
// à l'écran de suivi ou au dashboard de rester consultables hors-ligne.
async function pullChanges() {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const { data: reports } = await supabaseClient
    .from("reports")
    .select("id, category, description, status, perceived_severity, created_at, updated_at")
    .eq("author_id", profile.id);

  if (reports) {
    for (const report of reports) {
      await dbPut("local_reports", report);
    }
  }

  const { data: tasks } = await supabaseClient
    .from("tasks")
    .select("id, type, zone_id, due_date, status, updated_at")
    .eq("assignee_id", profile.id);

  if (tasks) {
    for (const task of tasks) {
      await dbPut("local_tasks", task);
    }
  }
}

async function getLastSyncTimestamp() {
  const entry = await dbGet("sync_meta", "last_sync");
  return entry ? entry.value : null;
}

// Retente une synchronisation dès que le navigateur détecte un retour
// de connexion — équivalent de l'écoute NetInfo côté React Native.
window.addEventListener("online", trySync);
