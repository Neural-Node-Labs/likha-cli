<!-- ronin:version 6 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T17:04:11.022Z | ronin:subtask code-st-d23750 -->
# xcoder â€” Utilisation

Comment invoquer le CLI xcoder, exÃ©cuter des tÃ¢ches, piloter le serveur API et l'interface, choisir un moteur d'orchestration et exÃ©cuter des tests.

## Syntaxe CLI

```bash
xcoder [task] [options]
```

L'argument positionnel `[task]` Ã©quivaut Ã  `--task <description>`. AprÃ¨s une compilation, le CLI se trouve dans `dist/cli/index.js`; les scripts npm et le binaire global `xcoder` y pointent tous deux.

Points d'entrÃ©e courants:

```bash
# Run a task through the built CLI
npm start -- --task "Lister tous les fichiers TypeScript dans src/"

# Run from source (no build step needed)
npm run dev -- --task "Lister tous les fichiers TypeScript dans src/"

# Run the built entry point directly
node dist/cli/index.js
```

## Commandes principales

Le principal exÃ©cuteur de tÃ¢ches et les commandes de l'agent fonctionnent via l'argument positionnel de tÃ¢che ou `--task`:

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
xcoder --lesson "Toujours valider les chemins de fichiers avant d'Ã©crire"

# Fully autonomous mode â€” auto-answers ALL interactive prompts
xcoder --auto --task "Configurer un pipeline CI/CD"

# Runtime diagnostics
xcoder --audit-react
xcoder --diagnose-live
```

Le mode Plan est contrÃ´lÃ© explicitement:

```bash
# Force Plan Mode on
xcoder --plan --task "TÃ¢che complexe"

# Force Plan Mode off
xcoder --no-plan --task "TÃ¢che rapide"

# Run as a single ReAct loop (disable phase planning)
xcoder --single-phase --task "TÃ¢che complexe"
```

## Serveur API et interface

### Serveur API

Le serveur API basÃ© sur Express expose des routes sous `/api/v1` (exÃ©cution de tÃ¢ches, plans, tÃ©lÃ©mÃ©trie, compÃ©tences, historique des tÃ¢ches, rapports de phase, WBS et gestion des utilisateurs):

```bash
# Start the API server on the default port (3001)
xcoder --serve

# Start the API server on an explicit port
xcoder --serve --port 3001

# npm script wrapper for the same command
npm run xcoder:api
```

Le port et l'hÃ´te peuvent aussi provenir de l'environnement:

```env
XCODER_API_PORT=3001
XCODER_API_HOST=0.0.0.0
```

Si `XCODER_API_KEY` est dÃ©finie, tous les points de terminaison `/api/v1/*` (sauf health/login/register/user-count) exigent `Authorization: Bearer <XCODER_API_KEY>`. Si elle n'est pas dÃ©finie, l'API s'exÃ©cute sans authentification et enregistre un avertissement au dÃ©marrage.

### Interface

L'interface React (Vite + TypeScript) s'exÃ©cute aux cÃ´tÃ©s du serveur API:

```bash
# Start both API and UI
xcoder --ui

# npm script wrapper: API on 3001 + UI dev server
npm run xcoder:ui
```

## Choix du moteur

xcoder est livrÃ© avec huit moteurs d'orchestration interchangeables, tous implÃ©mentant les interfaces `IReactEngine` / `IReactEngineV2`. SÃ©lectionnez-en un avec `--engine <name>`:

```bash
xcoder --engine <name> --task "Lister tous les fichiers TypeScript dans src/"
```

| Moteur | Nom d'enregistrement | Description |
|---|---|---|
| **ReActOrchestrator** | `react` (par dÃ©faut) | Moteur complet avec mode Plan, planification par phases, dÃ©lÃ©gation aux sous-agents, validation des objectifs et auto-rÃ©paration |
| **LeanEngine** | `lean` | Boucle ReAct ciblÃ©e et autonome; prend en charge le cycle de vie V2 |
| **LangGraphEngine** | `langgraph` | Boucle ReAct construite sur StateGraph de `@langchain/langgraph`; prend en charge le cycle de vie V2 |
| **SwarmEngine** | `swarm` | Orchestration d'essaim en parallÃ¨le avec dÃ©composition WBS et envoi concurrent d'agents |
| **SimpleReactEngine** | `simple` | Boucle ReAct minimale sans mode Plan, planification par phases ni nouvelle tentative de validation des objectifs |
| **AgenticEngine** | `agentic` | Boucle ReAct agentique dÃ©terministe avec un ThinkFn injectable |
| **BrainEngine** | `brain` | Achemine une tÃ¢che Ã  travers â‰¥2 rÃ´les via le MultiRoleRouter partagÃ© |
| **ProcedureEngine** | `procedure` | GÃ©nÃ©ration de procÃ©dure en deux Ã©tapes plus exÃ©cution locale des Ã©tapes |

Les moteurs sont enregistrÃ©s dans `src/core/engine/EngineRegistry.ts` via un modÃ¨le de fabrique. De nouvelles implÃ©mentations peuvent Ãªtre ajoutÃ©es avec `registerEngine("name", factory)` â€” aucune modification CLI ou API requise.

## Tests

ExÃ©cutez la suite de tests complÃ¨te (Vitest):

```bash
npm test
```

RÃ©-exÃ©cutez les tests en mode surveillance pendant le dÃ©veloppement:

```bash
npm run test:watch
```

## Ã‰tapes suivantes

- [readme.md](./readme.md) â€” prÃ©sentation et dÃ©marrage rapide
- [setup.md](./setup.md) â€” installation et configuration de l'environnement
- [blurprint.md](./blurprint.md) â€” architecture et points d'extension
