<!-- ronin:version 1 | ronin:task task-eedb5e | ronin:updated 2026-08-11T16:15:45.463Z | ronin:subtask code-st-7639c0 -->
# xcoder — Pangkalahatang-ideya

Ang **xcoder** ay isang ReAct CLI agent na nakasulat sa TypeScript para sa Node.js. Ginagamit nito ang ReAct (Reasoning + Acting) loop kasama ang mga hot-pluggable na role skills, at ang DeepSeek ay ang default na LLM provider nito. Ito ang entry point sa dokumentasyong Tagalog.

## Pangkalahatang-ideya

Ang xcoder ay isang CLI agent na sumusunod sa **ReAct** pattern: paulit-ulit itong nag-iisip tungkol sa isang task, tumatawag sa mga tool para kumuha ng impormasyon o gumawa ng mga pagbabago, inoobserbahan ang mga resulta, at inuulit ang proseso hanggang sa matapos ang task. Sinusuportahan nito ang maraming orchestration engines, hot-pluggable na skill directives, phase planning, isang HTTP API server, isang React UI, at isang built-in na self-healing mechanism na nakakakita kapag ang agent ay natigil.

Ang bersyon 0.2.0 ay may apat na interchangeable orchestration engines (`react` default, `lean`, `langgraph`, `swarm`) at higit sa 30 na specialized skills na nilo-load mula sa `agent/skills/`.

## Pangunahing mga Tampok

- **ReAct loop** na may Search → Action → Validation na mga phase
- **Maraming engine implementations** — standard ReAct, LeanEngine, LangGraph, at Swarm
- **Hot-pluggable skill system** — 30+ specialized skills (programmer, architect, devops, tester, at iba pa) na nilo-load mula sa `agent/skills/`
- **Plan Mode** — gumagawa ng task plan bago ang execution, na may approval ng user
- **Phase Planning** — hinahati ang mga complex task sa magkakasunod na phase na may isolated context
- **Self-healing health scoring** — nakakakita ng stalled progress at inaayos ang direksyon ng agent
- **HTTP API server** — Express-based REST API para sa remote task execution
- **React UI** — Vite + TypeScript frontend para sa pamamahala ng tasks, plans, at telemetry

## Pagsisimula

Siguraduhin na ang `DEEPSEEK_API_KEY` ay naka-set sa iyong environment o sa `.env` file, pagkatapos ay i-install at i-build:

```bash
npm run xcoder:install
npm run build
```

Patakbuhin ang iyong unang task:

```bash
npm start -- --task "List all TypeScript files in src/"
```

Kung ayaw mo ng build step, gamitin ang dev runner:

```bash
npm run dev -- --task "List all TypeScript files in src/"
```

## Mga Susunod na Hakbang

- [setup.md](./setup.md) — mga kinakailangan, pag-install, at configuration ng environment
- [usage.md](./usage.md) — CLI reference, pagpili ng engine, at pagte-test
- [blurprint.md](./blurprint.md) — architecture blueprint, mga pangunahing abstraksyon, at extension points
