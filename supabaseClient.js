// Configuration Supabase — la clé "publishable" ci-dessous est conçue pour
// être exposée côté client (contrairement à la clé "service_role", qui ne
// doit JAMAIS apparaître dans du code frontend). La sécurité réelle des
// données repose sur les policies Row Level Security définies en base,
// pas sur le secret de cette clé.
const SUPABASE_URL = "https://rqhcanhyrnhepzqmigvs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_-vVFMXe8WatZjTuW6CW9Jw_5h8aYmnw";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Stockage de session géré par la librairie Supabase elle-même
    // (persistSession) plutôt que manipulé à la main — évite les erreurs
    // classiques de gestion de jeton en JavaScript (OWASP A07 - Identification
    // and Authentication Failures).
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
