<!-- ronin:version 1 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T16:57:42.303Z | ronin:subtask code-st-d23750 -->
# xcoder — Installation

Comment installer xcoder, configurer son environnement, initialiser la base de données et mettre en place un flux de travail de développement.

## Prérequis

- **Node.js >= 18**
- **npm** (requis pour les dépendances de l'interface)
- **Clé API DeepSeek** — définissez `DEEPSEEK_API_KEY` dans votre environnement ou dans un fichier `.env`

## Installation

Installez les dépendances depuis la racine du projet (cela installe aussi les dépendances du frontend `ui/`):

```bash
npm run xcoder:install
```

Ensuite, compilez les sources TypeScript (le script `build` copie également le répertoire de configuration `agent/` dans `dist/config/`):

```bash
npm run build
```

Après la compilation, le CLI est disponible dans `dist/cli/index.js` et peut être exécuté avec `npm start -- --task "..."`.

## Configuration de l'environnement

Créez un fichier `.env` à la racine du projet. La configuration minimale est la clé API DeepSeek:

```env
DEEPSEEK_API_KEY=sk-your-key-here
```

Les variables d'environnement suivantes sont prises en charge:

| Variable | Rôle |
|---|---|
| `DEEPSEEK_API_KEY` | Clé API DeepSeek (requise pour les exécutions LLM réelles) |
| `DEEPSEEK_BASE_URL` | URL de base de l'API DeepSeek |
| `DEEPSEEK_MODEL` | Nom du modèle (par défaut: `deepseek-chat`) |
| `ANTHROPIC_API_KEY` | Fournisseur de secours facultatif, utilisé si DeepSeek est inaccessible/non défini |
| `GITHUB_TOKEN` | Jeton pour l'authentification HTTPS de `github_tool` (clone/fetch/pull/push); transmis uniquement comme en-tête d'authentification en mémoire |
| `XCODER_API_KEY` | Authentification par jeton Bearer du serveur API; si non défini, l'API s'exécute sans authentification |
| `XCODER_API_PORT` | Port du serveur API (par défaut: 3001) |
| `XCODER_API_HOST` | Hôte du serveur API (par défaut: 0.0.0.0) |
| `MAX_ITERATIONS` | Plafond d'itérations de la boucle ReAct par tour |
| `XCODER_RESTRICT_TO_WORKSPACE` | Garde-fou: refuse les chemins `read_tool`/`write_edit_tool` en dehors du répertoire de travail |
| `DATABASE_TYPE` | Backend de base de données: `sqlite` (par défaut) ou `postgres` |
| `DATABASE_SQLITE_PATH` | Chemin du fichier de base de données SQLite (par défaut: `~/.xcoder/data/xcoder.db`) |
| `DATABASE_URL` | Chaîne de connexion PostgreSQL (remplace les paramètres individuels ci-dessous) |
| `DATABASE_HOST` | Hôte PostgreSQL |
| `DATABASE_PORT` | Port PostgreSQL |
| `DATABASE_NAME` | Nom de la base de données PostgreSQL |
| `DATABASE_USER` | Utilisateur PostgreSQL |
| `DATABASE_PASSWORD` | Mot de passe PostgreSQL |
| `DATABASE_SSL` | Activer SSL pour PostgreSQL |
| `DATABASE_POOL_MAX` | Nombre maximal de connexions du pool PostgreSQL |
| `DATABASE_POOL_IDLE` | Délai d'inactivité du pool PostgreSQL (ms) |
| `DATABASE_POOL_TIMEOUT` | Délai d'acquisition du pool PostgreSQL (ms) |
| `REMOTE_SSH_USER` | Utilisateur SSH pour le déploiement à distance |
| `REMOTE_SSH_PASSWORD` | Mot de passe SSH pour le déploiement à distance |
| `XCODER_SSH_TARGETS` | Cibles SSH de la flotte (`host1:22,host2:22`) |
| `XCODER_SSH_USER` | Utilisateur SSH de la flotte |
| `XCODER_SSH_PASSWORD` | Mot de passe SSH de la flotte |

Un modèle `.env` plus complet:

```env
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
# MAX_ITERATIONS=25
# XCODER_API_PORT=3001
# XCODER_API_HOST=0.0.0.0
# DATABASE_URL=postgresql://user:pass@localhost:5432/xcoder
# REMOTE_SSH_USER=deploy
# REMOTE_SSH_PASSWORD=your-password
# XCODER_SSH_TARGETS=host1:22,host2:22
# XCODER_SSH_USER=fleet-user
# XCODER_SSH_PASSWORD=fleet-password
```

## Initialisation de la base de données

SQLite est le choix par défaut sans configuration. Pour utiliser les magasins adossés à la base de données (historique des tâches, rapports de phase, WBS, télémétrie), initialisez le schéma:

```bash
npm run init-db
```

Pour PostgreSQL, définissez `DATABASE_TYPE=postgres` et une `DATABASE_URL` (ou les paramètres `DATABASE_*` individuels) avant d'exécuter `npm run init-db`.

## Configuration du développement

Exécutez depuis la source sans étape de compilation:

```bash
npm run dev -- --task "Lister tous les fichiers TypeScript dans src/"
```

Exécutez la suite de tests:

```bash
npm test
```

Mode surveillance pour les tests:

```bash
npm run test:watch
```

Des assistants de configuration interactifs sont également disponibles:

```bash
npm run setup
npm run setup:non-interactive
```

## Étapes suivantes

- [readme.md](./readme.md) — présentation et démarrage rapide
- [usage.md](./usage.md) — référence CLI, choix du moteur et tests
- [blurprint.md](./blurprint.md) — architecture
