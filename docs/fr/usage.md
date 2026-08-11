<!-- ronin:version 6 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T17:04:11.022Z | ronin:subtask code-st-d23750 -->
# xcoder — Utilisation

Comment invoquer le CLI xcoder, exécuter des tâches, piloter le serveur API et l'interface, choisir un moteur d'orchestration et exécuter des tests.

## Syntaxe CLI

```bash
xcoder [task] [options]
```

L'argument positionnel `[task]` équivaut à `--task <description>`. Après une compilation, le CLI se trouve dans `dist/cli/index.js`; les scripts npm et le binaire global `xcoder` y pointent tous deux.

Points d'entrée courants:

```bash
# Run a task through the built CLI
npm start -- --task "Lister tous les fichiers TypeScript dans src/"

# Run from source (no build step needed)
npm run dev -- --task "Lister tous les fichiers TypeScript dans src/"

# Run the built entry point directly
node dist/cli/index.js
```

## Commandes principales

Le principal exécuteur de tâches et les commandes de l'agent fonctionnent via l'argument positionnel de tâche ou `--task`:

```bash
# Positional task (equivalent to --task)
xcoder "Refactoriser le module d'authentification pour utiliser des jetons JWT"

# Explicit task option with the lean engine
xcoder --engine lean --task "Analyser la couverture des tests"

# Interactive chat mode (workspace = current folder)
xcoder --chat

# List all loaded skills and their trigger keywords
xcoder --skills

# Index the current workspace into .agent/index/
xcoder --index

# Record a lesson to tasks/lessons.md
xcoder --lesson "Toujours valider les chemins de fichiers avant d'écrire"

# Fully autonomous mode — auto-answers ALL interactive prompts
xcoder --auto --task "Configurer un pipeline CI/CD"

# Runtime diagnostics
excoder --audit-react
xcoder --diagnose-live
```

Le mode Plan est contrôlé explicitement:

```bash
# Force Plan Mode on
xcoder --plan --task "Tâche complexe"

# Force Plan Mode off
xcoder --no-plan --task "Tâche rapide"

# Run as a single ReAct loop (disable phase planning)
xcoder --single-phase --task "Tâche complexe"
```

## Serveur API et interface

### Serveur API

Le serveur API basé sur Express expose des routes sous `/api/v1` (exécution de tâches, plans, télémétrie, compétences, historique des tâches, rapports de phase, WBS et gestion des utilisateurs):

```bash
# Start the API server on the default port (3001)
xcoder --serve

# Start the API server on an explicit port
xcoder --serve --port 3001

# npm script wrapper for the same command
npm run xcoder:api
```

Le port et l'hôte peuvent aussi provenir de l'environnement:

```env
XCODER_API_PORT=3001
XCODER_API_HOST=0.0.0.0
```

Si `XCODER_API_KEY` est définie, tous les points de terminaison `/api/v1/*` (sauf health/login/register/user-count) exigent `Authorization: Bearer <XCODER_API_KEY>`. Si elle n'est pas définie, l'API s'exécute sans authentification et enregistre un avertissement au démarrage.

### Interface

L'interface React (Vite + TypeScript) s'exécute aux côtés du serveur API:

```bash
# Start both API and UI
xcoder --ui

# npm script wrapper: API on 3001 + UI dev server
npm run xcoder:ui
```

## Choix du moteur

xcoder est livré avec quatre moteurs d'orchestration interchangeables, tous implémentant les interfaces `IReactEngine` / `IReactEngineV2`. Sélectionnez-en un avec `--engine <name>`:

```bash
xcoder --engine <name> --task "Lister tous les fichiers TypeScript dans src/"
```

| Moteur | Nom d'enregistrement | Description |
|---|---|---|
| **ReActOrchestrator** | `react` (par défaut) | Moteur complet avec mode Plan, planification par phases, délégation aux sous-agents, validation des objectifs et auto-réparation |
| **LeanEngine** | `lean` | Boucle ReAct ciblée et autonome; prend en charge le cycle de vie V2 |
| **LangGraphEngine** | `langgraph` | Boucle ReAct construite sur StateGraph de `@langchain/langgraph`; prend en charge le cycle de vie V2 |
| **SwarmEngine** | `swarm` | Orchestration d'essaim en parallèle avec décomposition WBS et envoi concurrent d'agents |

Les moteurs sont enregistrés dans `src/core/engine/EngineRegistry.ts` via un modèle de fabrique. De nouvelles implémentations peuvent être ajoutées avec `registerEngine("name", factory)` — aucune modification CLI ou API requise.

## Tests

Exécutez la suite de tests complète (Vitest):

```bash
npm test
```

Ré-exécutez les tests en mode surveillance pendant le développement:

```bash
npm run test:watch
```

## Étapes suivantes

- [readme.md](./readme.md) — présentation et démarrage rapide
- [setup.md](./setup.md) — installation et configuration de l'environnement
- [blurprint.md](./blurprint.md) — architecture et points d'extension
