# Outil terrain HSSE — Version HTML/CSS/JS + Supabase

Frontend en HTML/CSS/JavaScript pur (sans framework), backend entièrement
géré par Supabase (base de données PostgreSQL, authentification, stockage).

## Mode hors-ligne (PWA)

L'application fonctionne désormais en mode offline-first, avec la même
logique que la version React Native — adaptée aux technologies web natives :

- **Service Worker** (`sw.js`) : met en cache l'app shell (HTML/CSS/JS) au
  premier chargement, pour que l'interface s'ouvre instantanément même sans
  réseau. Les appels à l'API Supabase ne sont jamais mis en cache — ils
  suivent toujours le réseau, avec échec propre géré par la file de
  synchronisation si hors-ligne.
- **IndexedDB** (`js/offlineDb.js`) : stockage local structuré, équivalent
  web de la base SQLite embarquée côté mobile — file d'actions en attente,
  copie locale des signalements/tâches, horodatage du dernier sync.
- **File de synchronisation** (`js/syncQueue.js`) : toute création de
  signalement ou validation passe par `queueAction()` plutôt qu'un appel
  Supabase direct — écriture locale immédiate, tentative réseau en
  arrière-plan, avec la même règle de conflit "première synchronisation
  gagne" que côté React Native (détectée ici en relisant le statut du
  signalement avant d'appliquer la mise à jour).
- **Photos hors-ligne** : `uploadPhotoFile()` (partagée entre `report.html`
  et `syncQueue.js`) tente l'upload immédiat si en ligne ; sinon le fichier
  lui-même est conservé (IndexedDB supporte le stockage de `Blob`/`File`
  nativement) et l'upload est retenté à la prochaine synchronisation.
- **Bandeau de fraîcheur** (`initOfflineSupport()` dans `js/security.js`) :
  avertit explicitement si les données affichées datent de plus de 24h ou
  si l'appareil est hors-ligne, plutôt que de présenter silencieusement des
  informations potentiellement périmées.
- **Manifeste PWA** (`manifest.webmanifest`) : rend l'application
  installable sur l'écran d'accueil (mobile ou desktop) via le bouton
  "Installer" natif du navigateur.

## Configuration

Le projet Supabase est déjà créé et configuré (ref `rqhcanhyrnhepzqmigvs`,
région eu-west-3). L'URL et la clé publique sont dans `js/supabaseClient.js`
— cette clé est conçue pour être publique, la sécurité réelle repose sur
les policies Row Level Security définies en base.

Pour lancer le site en local, servir le dossier avec n'importe quel serveur
statique (ex. `npx serve .` ou l'extension Live Server de VS Code) — un
simple `file://` ne fonctionnera pas à cause des règles CORS/CSP.

## Structure

```
login.html                    connexion (Supabase Auth)
dashboard.html                KPIs + signalements récents (tous rôles)
report.html                   formulaire de signalement + upload photo
report-followup.html          suivi/historique d'un signalement (fermeture de boucle)
team-lead-validation.html     validation par zone + gravité (chef d'équipe)
settings.html                 paramétrage des checklists (directeur)
css/main.css                  styles partagés
js/supabaseClient.js          configuration du client Supabase
js/security.js                fonctions transverses : escapeHtml, session, profil
```

## Sécurité — conformité OWASP Top 10

Ce projet applique les points OWASP pertinents pour une architecture
frontend pur + BaaS (Backend as a Service) :

### A01 — Broken Access Control
Toute la logique de permissions (zone + gravité, définie dans les
spécifications) est traduite en **policies Row Level Security** directement
en base (voir les migrations Supabase). Le frontend n'effectue **aucun
filtrage de sécurité** — il affiche ce que la base accepte de renvoyer.
Un appel direct à l'API Supabase depuis un client altéré ne peut pas
contourner ces règles, contrairement à une vérification faite uniquement
en JavaScript.

### A02 — Cryptographic Failures
Aucun secret sensible (clé `service_role`, mot de passe) n'apparaît dans
le code client. Seule la clé publique/anonyme est utilisée, conçue pour
être exposée.

### A03 — Injection (XSS)
`js/security.js` fournit `escapeHtml()`, systématiquement appliqué à
toute donnée utilisateur avant insertion via `innerHTML`. Sans framework
pour échapper automatiquement (contrairement à React), cette discipline
est appliquée manuellement à chaque écran — voir les commentaires dans
chaque fichier `.html` aux points d'insertion.

### A04/A08 — Insecure Design / Data Integrity
- **Upload de photos** : le bucket Supabase Storage `report-photos` impose
  une limite de taille (8 Mo) et une liste de types MIME autorisés
  directement au niveau du bucket — la validation côté client (`report.html`)
  n'est qu'un confort, pas la seule protection.
- **Historique d'audit** : `audit_logs` n'a **aucune policy d'écriture
  cliente**. Toute entrée est générée automatiquement par des **triggers
  PostgreSQL** (`trg_report_audit`, `trg_task_audit`) sur les tables
  `reports` et `tasks` — impossible pour un client de falsifier ou d'omettre
  une entrée d'historique, quel que soit le chemin technique emprunté.

### A05 — Security Misconfiguration
- **Content Security Policy** stricte sur chaque page (`<meta http-equiv=
  "Content-Security-Policy">`), limitant les origines de scripts/styles/
  connexions aux seules nécessaires (CDN Supabase + le projet lui-même).
- Les fonctions PostgreSQL internes (`current_role()`, `current_zone()`,
  fonctions de trigger) ont leur exécution **révoquée pour les rôles
  publics** — elles ne servent qu'en interne aux policies RLS et triggers,
  jamais appelables directement via `/rest/v1/rpc/...`.

### A07 — Identification and Authentication Failures
- Authentification déléguée à Supabase Auth (`persistSession`,
  `autoRefreshToken`) plutôt qu'une gestion de jeton manuelle.
- Message d'erreur de connexion volontairement générique ("Identifiants
  invalides"), sans préciser si c'est l'email ou le mot de passe qui est
  incorrect — évite l'énumération de comptes.

## Vérification continue

Après toute modification du schéma, exécuter l'analyseur de sécurité
Supabase (`get_advisors`, type `security`) pour détecter automatiquement
les policies manquantes, les fonctions mal exposées, ou les configurations
à risque. Ce projet ne présente actuellement aucune alerte de sécurité
(hors un faux positif documenté sur `add_report_comment`, appelable
intentionnellement par les utilisateurs authentifiés avec vérification de
droits interne).

## Limites connues de cette approche (PWA vs app native)

Malgré le mode offline désormais en place, certaines limites face à une
app React Native demeurent :
- Notifications push moins fiables sur iOS (non implémentées dans cette version)
- Accès caméra/GPS un peu moins robuste en conditions dégradées
- Le stockage IndexedDB reste soumis aux quotas et politiques d'éviction
  du navigateur (moins prévisible qu'un fichier SQLite dédié sur mobile)

## Assignation de tâches

`assign-task.html` complète le second sens de la boucle bidirectionnelle
(Directeur/Chef d'équipe → Agent), jusque-là non couvert par le frontend
bien que la table `tasks` et ses policies RLS existaient déjà. Réservé aux
chefs d'équipe (limités à leur propre zone) et aux directeurs (toutes
zones du site) — un chef d'équipe ne voit même pas les autres zones dans
le formulaire, bien que la policy `tasks_insert` les bloquerait de toute
façon côté base. L'assignation passe par `queueAction("CREATE_TASK", ...)`,
donc fonctionne aussi hors-ligne.

## Prochaines étapes suggérées

- Notifications (Web Push API, avec les limitations connues sur iOS)
- Remplacer les icônes PWA placeholder (`icons/`) par un vrai logo
- Écran de checklist dynamique côté agent, généré à partir de la structure
  JSON du modèle actif (actuellement seul le paramétrage directeur existe)
