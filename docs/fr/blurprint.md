<!-- ronin:version 1 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T16:58:21.320Z | ronin:subtask code-st-d23750 -->
# xcoder — Architecture

Comment xcoder fonctionne en interne : objectifs de conception, abstractions principales, moteurs, système de compétences, serveur API et interface, topologie de déploiement, référence des répertoires et points d'extension.

## Objectifs de conception

L'architecture s'organise autour de quatre objectifs :

1. **Le moteur d'orchestration est remplaçable.** La boucle ReAct (`ReActOrchestrator`) est une implémentation de l'interface `IReactEngine`, pas une dépendance codée en dur du CLI ou de l'API.
2. **La présentation n'est pas l'affaire du moteur.** Le moteur rapporte la progression et demande une approbation via une interface `AgentIO`; il n'a aucune idée de s'il parle à un terminal, à une requête HTTP ou à un banc de test.
3. **Le CLI et la base de données sont découplés.** Une exécution `xcoder --task "..."` n'ouvre jamais de connexion à la base de données. Seul le serveur API (qui alimente l'interface) persiste dans la base de données.
4. **Le comportement s'étend via des compétences, pas des forks.** L'expertise métier vit dans `agent/skills/*/SKILL.md` et est sélectionnée à l'exécution par routage de mots-clés, pas compilée dans la boucle centrale.

## Diagramme du système

```
                         ┌──────────────────────────┐
                         │        IReactEngine        │   src/core/engine/IReactEngine.ts
                         │   (contract: run, plan,     │
                         │  selectSkills, getStatus…) │
                         └────────────┬─────────────┘
                                      │ implemented by
                         ┌────────────▼─────────────┐
                         │      ReActOrchestrator      │   src/core/orchestrator.ts
                         │  (the reference ReAct loop) │
                         └───┬───────────────────┬────┘
               reports via   │                   │  selects
                    ┌────────▼──────┐    ┌───────▼────────┐
                    │    AgentIO      │    │  SkillRegistry   │
                    │ (report/confirm)│    │ (agent/skills/*) │
                    └───┬─────────┬──┘    └─────────────────┘
                        │         │
              ┌─────────▼─┐   ┌───▼──────────┐
              │   CliIO     │   │    AutoIO      │
              │ (terminal,  │   │ (headless-safe, │
              │  readline)  │   │  never touches   │
              │             │   │  stdin; console  │
              │             │   │  logging only)   │
              └─────┬──────┘   └───────┬────────┘
                    │                   │
        ┌───────────▼──────┐  ┌────────▼─────────────┐
        │   src/cli/index.ts │  │  src/api/routes.ts     │
        │  (uses CliIO,      │  │  (uses AutoIO default, │
        │   EngineRegistry)  │  │   sets persistToDb:true)│
        └───────────┬──────┘  └────────┬─────────────┘
                    │                   │
         .log/*.log, tasks/*.md   .log/*.log, tasks/*.md,
         (file-only, always)      + database (task history,
                                    phase reports, WBS)
                                            │
                                   ┌────────▼────────┐
                                   │   ui/ (React)     │
                                   │ reads via the API  │
                                   └───────────────────┘
```

## Abstractions principales

### `IReactEngine` (`src/core/engine/IReactEngine.ts`)

Le contrat minimal que tout moteur d'orchestration doit implémenter : `run()`, `generatePlan()`, `selectSkills()`, plus les accesseurs d'état (`getLastOutcome`, `getCumulativeUsage`, `getHealthScore`, `getPartialSuccess`, `getSubagentLimitContext`). Rien en dehors de `src/core/engine/` ne doit importer `ReActOrchestrator` directement — passez par le registre à la place.

### `EngineRegistry` (`src/core/engine/EngineRegistry.ts`)

Les moteurs sont enregistrés par nom via un modèle de fabrique :

```ts
registerEngine("react", (deps) => new ReActOrchestrator(deps.llm, deps.telemetry, { ...deps.options, io: deps.io }));
```

Sélectionner un moteur ne requiert que `registerEngine("your-name", factory)` — aucun changement CLI/API nécessaire.

### `AgentIO` (`src/core/io/AgentIO.ts`)

`AgentIO` se divise en `AgentReporter` (unidirectionnel : `log`, `thought`, `action`, `observation`, `usage`, `spinnerStart`/`spinnerStop`) et `AgentPrompter` (`confirm(message, opts)` — le seul appel bidirectionnel, utilisé pour l'approbation du plan et la poursuite après limite d'itérations).

Deux implémentations sont fournies :

- **`CliIO`** (`src/cli/CliIO.ts`) — rapports de terminal colorés ANSI, un spinner et de vrais invites `readline` sur stdin. C'est là que vit la "fonctionnalité CLI"; elle ne fait pas partie du moteur.
- **`AutoIO`** (`src/core/io/AutoIO.ts`) — l'implémentation par défaut. Journalise sur la console pour la visibilité mais **ne lit jamais stdin**; `confirm()` se résout immédiatement avec une valeur par défaut. C'est ce qui permet au moteur de s'exécuter en toute sécurité dans un gestionnaire de requêtes API — une exécution sans tête ne peut jamais rester bloquée en attendant une invite que personne ne répondra.

## Moteurs

Les quatre moteurs implémentent `IReactEngine` / l'interface du cycle de vie V2 (`cancel`, `onProgress`, `getState`, `getLastMessages`, `getWorkspacePath`, `getIterationCount`):

| Moteur | Nom d'enregistrement | Description |
|---|---|---|
| **ReActOrchestrator** | `react` (par défaut) | Moteur complet avec mode Plan, planification par phases, délégation aux sous-agents, validation des objectifs et auto-réparation |
| **LeanEngine** | `lean` | Boucle ReAct ciblée et autonome — la boucle centrale sans mode Plan ni sous-agents. Prend en charge le cycle de vie V2 |
| **LangGraphEngine** | `langgraph` | Boucle ReAct construite sur StateGraph de `@langchain/langgraph` avec une machine d'états explicite à deux nœuds (agent ↔ outils). Prend en charge le cycle de vie V2 |
| **SwarmEngine** | `swarm` | Orchestration d'essaim en parallèle avec décomposition WBS et envoi concurrent d'agents. Prend en charge le cycle de vie V2 |

Les moteurs peuvent aussi être créés par programmation :

```ts
const engine = createEngine("lean", { llm, telemetry, io, options });
console.log(listEngines()); // ["react", "lean", "langgraph", "swarm"]
```

## Système de compétences

`SkillRegistry` (`src/core/skillRegistry.ts`) charge chaque `agent/skills/<name>/SKILL.md` :

```yaml
---
name: kebab-case-id       # unique
role: short-noun-phrase
description: one sentence
triggers: ["phrase one", "phrase two"]   # lowercase substrings, matched against the lowercased task
version: "1.0.0"
requires_tools: [tool_name, ...]
composes_with: [other-skill-name, ...]
---
markdown body (Process / Instructions / Strategies / Experience)
```

`route(taskDescription)` met la tâche en minuscules et compte combien de déclencheurs sont des sous-chaînes littérales de celle-ci. **C'est une correspondance de sous-chaînes pure sans limites de mots** — un déclencheur comme `"ux"` correspond dans `"SELinux"`, `"pod"` correspond dans `"podcast"`, et `"git"` correspond dans `"digital"`. Les déclencheurs doivent donc être choisis défensivement (phrases plus longues, ou limites explicites d'espace de fin comme `"the pod "`).

Exécutez `xcoder --skills` pour la liste vivante des compétences avec rôles et déclencheurs.

## Serveur API et interface

- Serveur Express (`src/api/server.ts`) avec des routes montées sur `/api/v1` (`src/api/routes.ts`). Points de terminaison clés : `/chat` (exécuter une tâche), `/chat/plan` + `/chat/execute` (approbation de plan en deux phases pour l'interface), `/telemetry`, `/skills`, `/task-history`, `/phase-reports`, `/wbs`, `/settings/llm-key`, plus l'authentification (`/login`, `/logout`, `/register`, `/users`).
- Authentification facultative par jeton Bearer via `XCODER_API_KEY` — si non définie, l'API s'exécute sans authentification avec un avertissement au démarrage.
- Interface React (`ui/`) — les jetons de conception et les primitives partagées (`Card`, `Button`, `Badge`, `PageHeader`) vivent dans `ui/src/index.css` et `ui/src/components/ui/`. Les pages consomment l'API directement; il n'y a pas de couche de rendu côté serveur.

## Topologie de déploiement

`xcoder --deploy --docker [--remote <ip>] [--llm true|false]`: 

- **Sans `--remote`:** `docker compose up -d --build` en local — directement ou, avec `--llm true`, confié au moteur comme tâche devops afin qu'il puisse diagnostiquer et corriger une construction échouée.
- **Avec `--remote <ip>`:** se connecte en SSH à l'hôte distant (`REMOTE_SSH_USER`/`REMOTE_SSH_PASSWORD` depuis `.env`) et y déploie à la place; `--remote-path` a pour valeur par défaut `/opt/xcoder`.

## Référence des répertoires

```
src/
  core/          ReAct engine, engine/IO abstractions, scoring, skill registry, protocol/plan mode
  cli/           CLI entrypoint, CliIO (terminal presentation)
  api/           Express server, routes, DB-backed stores (task history / phase reports / WBS)
  db/            Database connection, migrations, init
  tools/         Tool schemas + dispatcher
  llm/           LLM client(s) — DeepSeek primary, Anthropic fallback
  telemetry/     FileTelemetry (always-on) + Postgres telemetry (API-only)
  config/        Env/config loading
  indexing/      Workspace indexing for .agent/index/
  remote/        Remote SSH deploy support
agent/
  skills/        SKILL.md files — see Skill System
  config/        LLM provider config (llm.yaml)
ui/
  src/           React app (pages, components/ui primitives, context, API client)
tasks/           Runtime output: todo.md, wbs.md, lessons.md, phase reports (git-ignored in practice)
.log/            Runtime output: FileTelemetry logs (git-ignored in practice)
```

## Points d'extension

- **Nouveau moteur** — implémentez `IReactEngine`, puis `registerEngine("name", factory)`; voir l'enregistrement de `"react"` par `EngineRegistry.ts` lui-même comme modèle.
- **Nouvelle compétence** — ajoutez `agent/skills/<name>/SKILL.md`; voir la compétence `skill-authoring` pour le schéma et les règles de sécurité des déclencheurs.
- **Nouvel outil** — ajoutez une entrée de schéma dans `toolSchemas.ts` et un cas dans `toolDispatcher.ts`.
- **Nouveau backend d'E/S** (par exemple une future TUI ou un mode API diffusé en WebSocket) — implémentez `AgentIO`.

## Étapes suivantes

- [readme.md](./readme.md) — présentation et démarrage rapide
- [setup.md](./setup.md) — installation et configuration de l'environnement
- [usage.md](./usage.md) — référence CLI, choix du moteur et tests
