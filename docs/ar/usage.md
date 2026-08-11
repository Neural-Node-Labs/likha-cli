<!-- ronin:version 1 | ronin:task task-5e8fe0 | ronin:updated 2026-08-11T16:39:42.971Z | ronin:subtask code-st-be6a3a -->
# xcoder — دليل الاستخدام

يوضّح هذا المستند كيفية استدعاء واجهة سطر الأوامر في xcoder، وتشغيل المهام، وقيادة خادم API والواجهة، واختيار محرّك التنسيق، وتشغيل الاختبارات والتشخيص.

## استخدام سطر الأوامر

```bash
xcoder [task] [options]
```

الوسيط الموضعي `[task]` يعادل `--task <description>`. بعد البناء، يكون CLI في `dist/cli/index.js`؛ وتشير نصوص npm والأمر العام `xcoder` إلى هذا المسار نفسه.

نقاط الدخول الشائعة:

```bash
# تشغيل مهمة عبر واجهة CLI المبنية
npm start -- --task "سرد جميع ملفات TypeScript داخل src/"

# التشغيل من المصدر (بدون حاجة لخطوة بناء)
npm run dev -- --task "سرد جميع ملفات TypeScript داخل src/"

# تشغيل نقطة الدخول المبنية مباشرة
node dist/cli/index.js
```

## الأوامر الأساسية

يعمل مشغّل المهام الرئيسي وأوامر العميل عبر الوسيط الموضعي للمهمة أو عبر `--task`:

```bash
# مهمة موضعية (تعادل --task)
xcoder "إعادة هيكلة وحدة المصادقة لاستخدام JWT tokens"

# خيار مهمة صريح مع محرّك lean
xcoder --engine lean --task "تحليل تغطية الاختبارات"

# وضع الدردشة التفاعلي (مساحة العمل = المجلد الحالي)
xcoder --chat

# سرد جميع المهارات المحمّلة مع كلماتها المفتاحية
xcoder --skills

# فهرسة مساحة العمل الحالية في .agent/index/
xcoder --index

# تسجيل درس في tasks/lessons.md
xcoder --lesson "تحقق دائمًا من مسارات الملفات قبل الكتابة"

# الوضع المستقل بالكامل — يجيب تلقائيًا على جميع المطالبات التفاعلية
xcoder --auto --task "إعداد خط أنابيب CI/CD"

# تشخيصات وقت التشغيل
xcoder --audit-react
xcoder --diagnose-live
```

يمكن التحكم في وضع الخطة بشكل صريح:

```bash
# فرض تشغيل وضع الخطة
xcoder --plan --task "مهمة معقدة"

# فرض إيقاف وضع الخطة
xcoder --no-plan --task "مهمة سريعة"

# التشغيل كحلقة ReAct واحدة (تعطيل تخطيط المراحل)
xcoder --single-phase --task "مهمة معقدة"
```

### الخيارات الشائعة

| الخيار | الوصف |
|---|---|
| `--task <description>` | تنفيذ مهمة واحدة، مع طلب توضيح عند الحاجة |
| `--chat` | الدخول إلى وضع الدردشة التفاعلي (مساحة العمل = المجلد الحالي) |
| `--index` | فهرسة مساحة العمل الحالية في `.agent/index/` |
| `--skills` | سرد جميع المهارات المحمّلة وكلماتها المفتاحية |
| `--lesson <text>` | تسجيل درس في `tasks/lessons.md` |
| `--plan` | فرض تفعيل وضع الخطة |
| `--no-plan` | فرض تعطيل وضع الخطة |
| `--full-context-token` | الاحتفاظ بجميع نسخ `read_tool` التاريخية للملفات دون ضغط السياقات القديمة؛ الإعداد الافتراضي: الضغط مفعّل |
| `--single-phase` | تعطيل تخطيط المراحل والتشغيل كحلقة ReAct واحدة؛ الافتراضي: تخطيط المراحل مفعّل |
| `--auto` | الوضع المستقل بالكامل — يجيب تلقائيًا بـ"نعم" على جميع المطالبات التفاعلية |
| `--isolated-workspace` | تشغيل عمليات الأدوات على نسخة معزولة `./workspace-agent` بدلاً من ملفات المشروع الحية؛ الافتراضي: إيقاف |
| `--engine <name>` | محرّك التنسيق (الافتراضي: `react`). المسجّلون: `react`، `lean`، `langgraph`، `swarm` |
| `--serve` | تشغيل خادم xcoder HTTP API |
| `--ui` | تشغيل خادم API والواجهة الأمامية معًا |
| `--port <number>` | منفذ خادم API (الافتراضي: 3001) |
| `--host <address>` | مضيف خادم API (الافتراضي: 0.0.0.0) |
| `--deploy` | تفعيل وضع النشر (Docker Compose) |
| `--docker` | استخدام Docker Compose للنشر |
| `--llm <boolean>` | إرسال مهمة النشر إلى LLM كمهمة devops |
| `--remote <ip>` | عنوان IP للمضيف البعيد للنشر |
| `--remote-path <path>` | مسار الدليل البعيد للنشر (الافتراضي: `/opt/xcoder`) |
| `--audit-react` | تشغيل مجموعة سيناريوهات إصلاح الأخطاء المدمجة |
| `--audit-out <path>` | مسار كتابة تقرير التدقيق بصيغة Markdown |
| `--diagnose-live` | تشغيل مجموعة تشخيص ReAct ذات نقاطها السبع ضد LLM الحقيقي المُضبط |
| `--diagnose-out <path>` | مسار كتابة تقرير التشخيص |

## خادم API والواجهة

### خادم API

يوفّر خادم API المبني على Express مسارات تحت `/api/v1` (تنفيذ المهام، الخطط، القياس عن بُعد، المهارات، سجلّ المهام، تقارير المراحل، WBS، وإدارة المستخدمين):

```bash
# تشغيل خادم API على المنفذ الافتراضي (3001)
xcoder --serve

# تشغيل خادم API على منفذ صريح
xcoder --serve --port 3001

# نص npm المكافئ للأمر نفسه
npm run xcoder:api
```

يمكن أيضًا ضبط المنفذ والمضيف من البيئة:

```env
XCODER_API_PORT=3001
XCODER_API_HOST=0.0.0.0
```

إذا ضُبطت `XCODER_API_KEY`، تتطلب جميع مسارات `/api/v1/*` (ما عدا health/login/register/user-count) `Authorization: Bearer <XCODER_API_KEY>`. إذا لم تُضبط، يعمل API دون مصادقة ويُسجّل تحذيرًا عند بدء التشغيل.

### الواجهة

تعمل واجهة React (Vite + TypeScript) إلى جانب خادم API:

```bash
# تشغيل كل من API والواجهة
xcoder --ui

# نص npm: API على 3001 + خادم تطوير الواجهة
npm run xcoder:ui
```

## اختيار المحرّك

يوفّر xcoder أربعة محركات تنسيق قابلة للتبديل، جميعها تنفّذ واجهتي `IReactEngine` / `IReactEngineV2`. اختر واحدًا عبر `--engine <name>`:

```bash
xcoder --engine <name> --task "سرد جميع ملفات TypeScript داخل src/"
```

| المحرّك | اسم التسجيل | الوصف |
|---|---|---|
| **ReActOrchestrator** | `react` (الافتراضي) | محرّك كامل الميزات مع وضع الخطة وتخطيط المراحل وتفويض subagent والتحقق من الهدف والشفاء الذاتي |
| **LeanEngine** | `lean` | حلقة ReAct مركّزة ومكتفية بذاتها؛ تدعم دورة الحياة V2 |
| **LangGraphEngine** | `langgraph` | حلقة ReAct مبنية على StateGraph من `@langchain/langgraph`؛ تدعم دورة الحياة V2 |
| **SwarmEngine** | `swarm` | تنسيق swarm موازٍ مع تحليل WBS وتوزيع وكلاء متزامنين |

تُسجَّل المحركات في `src/core/engine/EngineRegistry.ts` عبر نمط المصنع. يمكن إضافة تنفيذات جديدة عبر `registerEngine("name", factory)` دون تعديل CLI أو API.

## الاختبار والتشخيص

شغّل مجموعة الاختبارات الكاملة (Vitest):

```bash
npm test
```

أعد تشغيل الاختبارات في وضع المراقبة أثناء التطوير:

```bash
npm run test:watch
```

فحص الأنواع:

```bash
npm run typecheck
```

التدقيق المدمج (مجموعة سيناريوهات إصلاح الأخطاء) والتشخيص المباشر:

```bash
xcoder --audit-react
xcoder --audit-out reports/my-audit.md
xcoder --diagnose-live
xcoder --diagnose-out reports/my-diagnostics.md
```

## الخطوات التالية

- [readme.md](./readme.md) — نظرة عامة وبدء سريع
- [setup.md](./setup.md) — التثبيت وإعداد البيئة
- [blurprint.md](./blurprint.md) — مخطط البنية ونقاط التوسعة
