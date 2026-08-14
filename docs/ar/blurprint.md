<!-- ronin:version 1 | ronin:task task-5e8fe0 | ronin:updated 2026-08-11T16:40:11.455Z | ronin:subtask code-st-be6a3a -->
# likha — مخطط البنية

يوضّح هذا المستند كيفية عمل likha داخليًا: أهداف التصميم، التجريدات الأساسية، المحركات، نظام المهارات، خادم API والواجهة، طوبولوجيا النشر، مرجع الدليل، نقاط التوسعة، والفجوات المعروفة.

## أهداف التصميم

تنظّم البنية حول أربعة أهداف:

1. **محرّك التنسيق قابل للاستبدال.** حلقة ReAct (`ReActOrchestrator`) هي أحد تطبيقات واجهة `IReactEngine`، وليست اعتمادًا مكتوبًا بشكل ثابت في CLI أو API.
2. **العرض ليس شأن المحرّك.** يبلّغ المحرّك عن التقدم ويطلب الموافقة عبر واجهة `AgentIO`؛ فهو لا يعرف ما إذا كان يتحدث مع طرفية، أو طلب HTTP، أو أداة اختبار.
3. **CLI وقاعدة البيانات مفصولان.** تشغيل `likha --task "..."` لا يفتح اتصال قاعدة بيانات أبدًا. فقط خادم API (الذي يدعم الواجهة) يكتب إلى قاعدة البيانات.
4. **السلوك يُوسَّع عبر المهارات، وليس عبر الفروع (forks).** تخزَن الخبرة المجالية في `agent/skills/*/SKILL.md` وتُختار وقت التشغيل عبر توجيه الكلمات المفتاحية، ولا تُدمج في الحلقة الأساسية.

## مخطط النظام

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

## التجريدات الأساسية

### `IReactEngine` (`src/core/engine/IReactEngine.ts`)

أصغر عقد يجب أن ينفذه أي محرّك تنسيق: `run()` و`generatePlan()` و`selectSkills()`، بالإضافة إلى دوال قراءة الحالة (`getLastOutcome` و`getCumulativeUsage` و`getHealthScore` و`getPartialSuccess` و`getSubagentLimitContext`). لا يجب لأي شيء خارج `src/core/engine/` استيراد `ReActOrchestrator` مباشرة — مرّ عبر السجل بدلاً من ذلك.

### `EngineRegistry` (`src/core/engine/EngineRegistry.ts`)

تُسجَّل المحركات بالاسم عبر نمط المصنع:

```ts
registerEngine("react", (deps) => new ReActOrchestrator(deps.llm, deps.telemetry, { ...deps.options, io: deps.io }));
```

### `AgentIO` (`src/core/io/AgentIO.ts`)

ينقسم إلى `AgentReporter` (أحاديّ الاتجاه: `log` و`thought` و`action` و`observation` و`usage` و`spinnerStart`/`spinnerStop` وغيرها) و`AgentPrompter` (`confirm(message, opts)` — الاستدعاء ثنائي الاتجاه الوحيد، ويُستخدم لموافقة الخطة ومواصلة ما بعد حدّ التكرار).

يأتي تطبيقان جاهزان:

- **`CliIO`** (`src/cli/CliIO.ts`) — تقارير طرفية ملونة بـ ANSI، ومؤشر spinner، ومطالبات `readline` حقيقية على stdin. هذا هو "وظيفة CLI" — يقع في `src/cli/`، وليس في المحرّك.
- **`AutoIO`** (`src/core/io/AutoIO.ts`) — الافتراضي. يسجّل إلى console للرؤية، لكنه **لا يقرأ stdin أبدًا**؛ `confirm()` تُحلّ فورًا بقيمة افتراضية. هذا ما يجعل من الآمن تشغيل المحرّك داخل معالج طلب API — لا يوجد مسار يمكن أن تعلق فيه عملية headless بانتظار مطالبة لن يجيب عليها أحد.

## حلقة ReAct ونموذج التسجيل

كل خطوة أداة مكتملة تُسجَّل من 0 إلى 100 بواسطة `scoreStep` (`src/core/stepScorer.ts`):

- الأساس **70**.
- لا خطأ: **+10**. خطأ: **−45**.
- إجراء مكرّر تمامًا (نفس الأداة + نفس الوسائط + نفس الملاحظة الناتجة كخطوة سابقة): **−35**. لا تُطبَّق هذه العقوبة على إعادة تشغيل مشروعة تغيّر فيها شيء بين الخطوتين.
- استدعاء ناجح لـ `write_edit_tool` أو `run_command_tool`: مكافأة **+10** (تقدّم ملموس للأمام مقابل التحقيق للقراءة فقط).

`rollingHealth()` يحسب متوسط آخر 5 خطوات مُسجَّلة. إذا انخفض المتوسط عن **40** (مع وجود درجتين على الأقل وفترة تبريد منذ آخر تحذير)، يحقن المنسّق رسالة فحص ذاتي تطلب منه إعادة قراءة الحالة والتحقق من افتراضه الأخير وتجربة نهج مختلف.

بالنسبة للمهام غير التافهة، يصيغ المحرّك خطة قبل التنفيذ (تُكتب إلى `tasks/todo.md`) وعندما تستحق المراحل، تحليلًا للمراحل (`tasks/wbs.md`) — كل مرحلة تعمل كـ `ReActOrchestrator` فرعي معزول مع تتبّع صحة وميزانية تكرار خاصين بها، حتى لا يلوّث الافتراض السيئ المبكر سياق مرحلة لاحقة. تمر موافقة الخطة وخطة المراحل عبر `AgentIO.confirm()`.

## قائمة المحركات

| المحرّك | اسم التسجيل | الوصف |
|---|---|---|
| **ReActOrchestrator** | `react` (الافتراضي) | محرّك كامل الميزات مع وضع الخطة وتخطيط المراحل وتفويض subagent والتحقق من الهدف والشفاء الذاتي |
| **LeanEngine** | `lean` | حلقة ReAct مركّزة ومكتفية بذاتها؛ تدعم دورة الحياة V2 |
| **LangGraphEngine** | `langgraph` | حلقة ReAct مبنية على StateGraph من `@langchain/langgraph` مع آلة حالة صريحة ثنائية العقدة (agent ↔ tools)؛ تدعم دورة الحياة V2 |
| **SwarmEngine** | `swarm` | تنسيق swarm موازٍ مع تحليل WBS وتوزيع وكلاء متزامنين؛ يدعم دورة الحياة V2 |
| **SimpleReactEngine** | `simple` | حلقة ReAct بسيطة بدون وضع Plan أو تخطيط المراحل أو إعادة محاولة التحقق من الأهداف |
| **AgenticEngine** | `agentic` | حلقة ReAct وكيلية حتمية مع ThinkFn قابل للحقن |
| **BrainEngine** | `brain` | يوجّه المهمة عبر ≥2 أدوار عبر MultiRoleRouter المشترك |
| **ProcedureEngine** | `procedure` | توليد إجراء من خطوتين مع تنفيذ محلي للخطوات |

يمكن أيضًا إنشاء المحركات برمجيًا:

```ts
const engine = createEngine("lean", { llm, telemetry, io, options });
console.log(listEngines()); // ["react", "lean", "simple", "swarm", "langgraph", "agentic", "brain", "procedure"]
```

## نظام المهارات

`SkillRegistry` (`src/core/skillRegistry.ts`) يحمّل كل `agent/skills/<name>/SKILL.md`:

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

`route(taskDescription)` يحوّل المهمة إلى أحرف صغيرة ويحسب عدد المشغلات التي تظهر نصيًا داخل المهمة لكل مهارة. **هذه مطابقة نصية (substring) صرفة بلا حدود كلمات** — مشغل مثل `"ux"` يطابق داخل `"SELinux"`، و`"pod"` يطابق داخل `"podcast"`، و`"git"` يطابق داخل `"digital"`. لذلك يجب اختيار المشغلات دفاعيًا (عبارات أطول، أو حدود مسافات لاحقة صريحة مثل `"the pod "`).

شغّل `likha --skills` للاطلاع على القائمة الحية للمهارات مع الأدوار والمشغلات.

## حدود التخزين

`OrchestratorOptions.persistToDb` (الافتراضي `false`) يتحكم في كل كتابة قاعدة بيانات داخل المحرّك (`TaskHistoryStore` و`PhaseReportStore` و`WbsStore` — جميعها في `src/api/*Store.ts`، وكل واحد مدعوم بـ SQLite أو Postgres حسب `DATABASE_TYPE`). التسجيل القائم على الملفات (`FileTelemetry` تحت `.log/`، بالإضافة إلى `tasks/*.md`) غير مشروط ويحدث دائمًا بغض النظر عن هذا الخيار.

- `src/cli/index.ts` لا يضبط `persistToDb` أبدًا → تشغيلات CLI تكتفي بالملفات.
- `src/api/routes.ts` يمرر دائمًا `persistToDb: true` عند إنشاء المحرّك → البيانات التي تقرأها الواجهة (سجلّ المهام، تقارير المراحل، WBS) تأتي فقط من التشغيلات عبر API.

المنسّقات الفرعية (المراحل، الوكلاء الفرعيون) ترث `persistToDb` لأن كل موقع توليد يوزّع `...this.opts` في خيارات الطفل.

## خادم API والواجهة

- خادم Express (`src/api/server.ts`) بمسارات مركّبة في `/api/v1` (`src/api/routes.ts`). المسارات الرئيسية: `/chat` (تشغيل مهمة)، و`/chat/plan` + `/chat/execute` (موافقة الخطة على مرحلتين للواجهة)، و`/telemetry`، و`/skills`، و`/task-history`، و`/phase-reports`، و`/wbs`، و`/settings/llm-key`، بالإضافة إلى المصادقة (`/login` و`/logout` و`/register` و`/users`).
- مصادقة Bearer Token اختيارية عبر `XCODER_API_KEY` — إذا لم تُضبط، يعمل API دون مصادقة مع تحذير عند بدء التشغيل.
- واجهة React (`ui/`) — رموز التصميم والبدائيات المشتركة (`Card` و`Button` و`Badge` و`PageHeader`) في `ui/src/index.css` و`ui/src/components/ui/`. تستهلك الصفحات API مباشرة؛ لا توجد طبقة تصيير من الخادم.

## طوبولوجيا النشر

`likha --deploy --docker [--remote <ip>] [--llm true|false]`:

- بدون `--remote`: `docker compose up -d --build` محليًا — مباشرة، أو (مع `--llm true`) تُسلَّم المهمة نفسها للمحرّك كمهمة devops لتشخيص إخفاق البناء وإصلاحه.
- مع `--remote <ip>`: يعمل SSH إلى المضيف البعيد (`REMOTE_SSH_USER`/`REMOTE_SSH_PASSWORD` من `.env`) وينشر هناك؛ و`--remote-path` الافتراضي هو `/opt/likha`.

## مرجع الدليل

```
src/
  core/          محرّك ReAct، تجريدات المحرّك/الإدخال والإخراج، التسجيل، سجل المهارات، البروتوكول/وضع الخطة
  cli/           نقطة دخول CLI، وCliIO (العرض الطرفي)
  api/           خادم Express، المسارات، المخازن المدعومة بقاعدة البيانات (سجلّ المهام / تقارير المراحل / WBS)
  db/            اتصال قاعدة البيانات، الترحيلات، التهيئة
  tools/         مخططات الأدوات + الموزّع
  llm/           عملاء LLM — DeepSeek رئيسي، وAnthropic احتياطي
  telemetry/     FileTelemetry (مفعّل دائمًا) + Postgres telemetry (API فقط)
  config/        تحميل البيئة/الإعدادات
  indexing/      فهرسة مساحة العمل لـ .agent/index/
  remote/        دعم نشر SSH عن بُعد
agent/
  skills/        ملفات SKILL.md — راجع قسم "نظام المهارات"
  config/        إعداد مزوّد LLM (llm.yaml)
ui/
  src/           تطبيق React (الصفحات، بدائيات components/ui، context، عميل API)
tasks/           المخرجات وقت التشغيل: todo.md، wbs.md، lessons.md، تقارير المراحل (مستثناة من git عمليًا)
.log/            مخرجات وقت التشغيل: سجلات FileTelemetry (مستثناة من git عمليًا)
```

## نقاط التوسعة

- **محرّك جديد** — نفّذ `IReactEngine`، ثم استدعِ `registerEngine("name", factory)`؛ راجع تسجيل `EngineRegistry.ts` نفسه لـ `"react"` كقالب.
- **مهارة جديدة** — أضف `agent/skills/<name>/SKILL.md`؛ راجع مهارة `skill-authoring` للمخطط وقواعد أمان المشغلات.
- **أداة جديدة** — أضف إدخال مخطط في `toolSchemas.ts` وحالة توزيع في `toolDispatcher.ts`.
- **خلفية إدخال/إخراج جديدة** (مثل TUI مستقبلية أو وضع API متدفق عبر WebSocket) — نفّذ `AgentIO`.

## الفجوات المعروفة

- `package.json` يشير إلى `scripts/*.sh` غير الموجودة في هذه النسخة؛ أوامر README اليدوية تعمل، لكن النصوص نفسها تحتاج إلى كتابة.
- لا تشحن المستودع `docker-compose.yml`/`Dockerfile` رغم وجود `--deploy --docker` و`docker_compose_deploy_tool`.
- تعليق `.env.example` على `MAX_ITERATIONS` يقول أن الافتراضي 10، بينما الافتراضي في الكود هو 20.

## الخطوات التالية

- [readme.md](./readme.md) — نظرة عامة وبدء سريع
- [setup.md](./setup.md) — التثبيت وإعداد البيئة
- [usage.md](./usage.md) — مرجع CLI، اختيار المحرّك، والاختبار
