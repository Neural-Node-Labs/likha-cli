<!-- ronin:version 1 | ronin:task task-ae5e2e | ronin:updated 2026-08-11T16:57:28.377Z | ronin:subtask code-st-d23750 -->
# xcoder — Présentation

**xcoder** est un agent CLI ReAct écrit en TypeScript pour Node.js. Il associe la boucle ReAct (raisonnement + action) à des compétences de rôle enfichables à chaud et utilise DeepSeek comme fournisseur LLM par défaut. Ce document est le point d'entrée de l'ensemble de la documentation anglaise.

## Présentation

xcoder est un agent CLI qui suit le modèle **ReAct** : il réfléchit de manière itérative à la tâche, appelle des outils pour recueillir des informations ou effectuer des modifications, observe les résultats et répète jusqu'à ce que la tâche soit terminée. Il prend en charge plusieurs moteurs d'orchestration, des directives de compétences enfichables à chaud, la planification par phases, un serveur HTTP API, une interface React et un mécanisme d'auto-réparation intégré qui détecte quand l'agent est bloqué.

La version 0.2.0 est livrée avec quatre moteurs d'orchestration interchangeables (`react` par défaut, `lean`, `langgraph`, `swarm`) et plus de 30 compétences spécialisées chargées depuis `agent/skills/`.

## Principales fonctionnalités

- **Boucle ReAct** — phases Recherche → Action → Validation
- **Implémentations de moteurs multiples** — ReAct standard, LeanEngine, LangGraph et Swarm
- **Système de compétences enfichable à chaud** — plus de 30 compétences spécialisées (programmeur, architecte, devops, testeur, etc.) chargées depuis `agent/skills/`
- **Mode Plan** — génère un plan de tâche avant l'exécution, avec approbation de l'utilisateur
- **Planification par phases** — divise les tâches complexes en phases séquentielles avec contexte isolé
- **Score de santé auto-réparateur** — détecte un progrès bloqué et ramène l'agent sur la bonne voie
- **Serveur HTTP API** — API REST basée sur Express pour l'exécution distante de tâches
- **Interface React** — frontend Vite + TypeScript pour gérer les tâches, les plans et la télémétrie

## Pour commencer

Assurez-vous que `DEEPSEEK_API_KEY` est définie dans votre environnement ou dans un fichier `.env`, puis installez et compilez :

```bash
npm run xcoder:install
npm run build
```

Exécutez votre première tâche :

```bash
npm start -- --task "Lister tous les fichiers TypeScript dans src/"
```

Pas besoin d'étape de compilation ? Utilisez plutôt le runner de développement :

```bash
npm run dev -- --task "Lister tous les fichiers TypeScript dans src/"
```

## Étapes suivantes

- [setup.md](./setup.md) — prérequis, installation et configuration de l'environnement
- [usage.md](./usage.md) — référence CLI, choix du moteur et tests
- [blurprint.md](./blurprint.md) — architecture, abstractions principales et points d'extension
