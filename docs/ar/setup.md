<!-- ronin:version 5 | ronin:task task-b5feec | ronin:updated 2026-08-13T08:18:40.042Z | ronin:subtask code-st-82c66c -->
# likha — التثبيت والإعداد

يوضّح هذا المستند كيفية تثبيت likha، وضبط متغيرات البيئة، وتهيئة قاعدة البيانات، وإعداد سير عمل التطوير.

## المتطلبات الأساسية

- **Node.js >= 18**
- **npm** (مطلوب لتبعيات الواجهة)
- **مفتاح DeepSeek API** — اضبط `DEEPSEEK_API_KEY` في بيئتك أو في ملف `.env`

## التثبيت

ثبّت التبعيات من جذر المشروع (يقوم هذا الأمر أيضًا بتثبيت تبعيات واجهة `ui/`):

```bash
npm run likha:install
```

ثم ابنِ مصادر TypeScript (يقوم نص `build` أيضًا بنسخ دليل الإعداد `agent/` إلى `dist/config/`):

```bash
npm run build
```

بعد البناء، يكون CLI متاحًا في `dist/cli/index.js` ويمكن تشغيله عبر `npm start -- --task "..."`.

## متغيرات البيئة والإعداد

أنشئ ملف `.env` في جذر المشروع. الحد الأدنى من الإعداد هو مفتاح DeepSeek API:

```env
DEEPSEEK_API_KEY=sk-your-key-here
```

متغيرات البيئة المدعومة:

| المتغير | الغرض |
|---|---|
| `DEEPSEEK_API_KEY` | مفتاح DeepSeek API (المزوّد الافتراضي — مطلوب للتشغيل الافتراضي) |
| `OPENAI_API_KEY` | مفتاح OpenAI API (انظر `provider: openai` أدناه) |
| `OPENROUTER_API_KEY` | مفتاح OpenRouter API (انظر `provider: openrouter` أدناه) |
| `GROQ_API_KEY` | مفتاح Groq API (انظر `provider: groq` أدناه) |
| `OLLAMA_API_KEY` | مفتاح Ollama API — اختياري للاستخدام المحلي |
| `ANTHROPIC_API_KEY` | مفتاح Anthropic API — احتياطي أو التبديل عبر `provider: anthropic` في `agent/config/llm.yaml` |
| `GITHUB_TOKEN` | رمز مصادقة HTTPS لـ `github_tool` (clone/fetch/pull/push)؛ يُمرَّر كترويسة مصادقة في الذاكرة فقط |
| `XCODER_API_KEY` | مصادقة Bearer Token لخادم API؛ إذا لم يُضبط، يعمل API دون مصادقة |
| `XCODER_API_PORT` | منفذ خادم API (الافتراضي: 3001) |
| `XCODER_API_HOST` | مضيف خادم API (الافتراضي: 0.0.0.0) |
| `MAX_ITERATIONS` | سقف تكرارات حلقة ReAct لكل جولة |
| `XCODER_RESTRICT_TO_WORKSPACE` | حاجز أمان: يرفض مسارات `read_tool`/`write_edit_tool` خارج دليل العمل |
| `DATABASE_TYPE` | نوع قاعدة البيانات: `sqlite` (الافتراضي) أو `postgres` |
| `DATABASE_SQLITE_PATH` | مسار ملف قاعدة بيانات SQLite (الافتراضي: `~/.likha/data/likha.db`) |
| `DATABASE_URL` | سلسلة اتصال PostgreSQL (تتجاوز المعاملات الفردية أدناه) |
| `DATABASE_HOST` | مضيف PostgreSQL |
| `DATABASE_PORT` | منفذ PostgreSQL |
| `DATABASE_NAME` | اسم قاعدة بيانات PostgreSQL |
| `DATABASE_USER` | مستخدم PostgreSQL |
| `DATABASE_PASSWORD` | كلمة مرور PostgreSQL |
| `DATABASE_SSL` | تفعيل SSL في PostgreSQL |
| `DATABASE_POOL_MAX` | الحد الأقصى لاتصالات تجمّع PostgreSQL |
| `DATABASE_POOL_IDLE` | مهلة خمول التجمّع (بالمللي ثانية) |
| `DATABASE_POOL_TIMEOUT` | مهلة انتظار التجمّع (بالمللي ثانية) |
| `REMOTE_SSH_USER` | مستخدم SSH للنشر عن بُعد |
| `REMOTE_SSH_PASSWORD` | كلمة مرور SSH للنشر عن بُعد |
| `XCODER_SSH_TARGETS` | أهداف SSH للمجموعة (`host1:22,host2:22`) |
| `XCODER_SSH_USER` | مستخدم SSH للمجموعة |
| `XCODER_SSH_PASSWORD` | كلمة مرور SSH للمجموعة |

قالب `.env` أكثر اكتمالاً:

```env
DEEPSEEK_API_KEY=sk-your-key-here
# OPENAI_API_KEY=sk-...
# OPENROUTER_API_KEY=sk-...
# GROQ_API_KEY=sk-...
# OLLAMA_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-your-key-here
# MAX_ITERATIONS=25
# XCODER_API_PORT=3001
# XCODER_API_HOST=0.0.0.0
# DATABASE_URL=postgresql://user:pass@localhost:5432/likha
# REMOTE_SSH_USER=deploy
# REMOTE_SSH_PASSWORD=your-password
# XCODER_SSH_TARGETS=host1:22,host2:22
# XCODER_SSH_USER=fleet-user
# XCODER_SSH_PASSWORD=fleet-password
```

ملاحظة: تعليق `.env.example` على `MAX_ITERATIONS` يشير إلى أن الافتراضي هو 10، بينما الافتراضي في الكود هو 20؛ يُقدَّم هذا المتغير هنا كخيار تجاوز دون تأكيد قيمة افتراضية محددة.

### مزوّدات LLM

يعمل خلفية likha للـ LLM بالإعداد من الملف: **DeepSeek هو المزوّد الافتراضي**، ويمكن اختيار أي مزوّد متوافق مع OpenAI (OpenAI أو OpenRouter أو Groq أو Ollama أو وكيل شركة …) أو Anthropic عبر تعديل `agent/config/llm.yaml` فقط — **دون تغيير أي كود**، ولا يوجد خيار CLI لتبديل المزوّد.

المفاتيح لا تُكتب أبدًا داخل ملف YAML؛ الحقل `api_key_env` يحدد اسم متغير البيئة الذي يحمل المفتاح. اضبط المتغير المذكور بالضبط في بيئتك أو في ملف `.env`، ثم أعد تشغيل أي عملية likha قيد التشغيل بعد التعديل.

**التبديل إلى مزوّد متوافق مع OpenAI (مثال OpenAI):**

```yaml
provider: openai
base_url: https://api.openai.com/v1
endpoint: /chat/completions
model: gpt-5
api_key_env: OPENAI_API_KEY
```

```env
OPENAI_API_KEY=sk-...
```

**التبديل إلى Anthropic (يتجاهل `base_url` و`endpoint`):**

```yaml
provider: anthropic
model: claude-sonnet-4-5
api_key_env: ANTHROPIC_API_KEY
```

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

قواعد التوجيه:

1. `base_url` الصريح يتفوق دائمًا على السجل المدمج.
2. عند حذف `base_url`، يُستخدم سجل العناوين المدمج للمزوّدين المعروفين (`deepseek`، `openai`، `openrouter`، `groq`، `ollama`).
3. `endpoint` الافتراضي هو `/chat/completions` عند حذفه.
4. `base_url` و`endpoint` يُتجاهلان مع `anthropic`.

> `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` متغيرات قديمة و**لا يقرؤها** likha.

## تهيئة قاعدة البيانات

SQLite هو الخيار الافتراضي بدون إعداد. لاستخدام مخازن قاعدة البيانات (سجلّ المهام، تقارير المراحل، WBS، القياس عن بُعد)، ثبّت مخطط الجداول:

```bash
npm run init-db
```

مع PostgreSQL، اضبط `DATABASE_TYPE=postgres` و`DATABASE_URL` (أو معاملات `DATABASE_*` الفردية) قبل تشغيل `npm run init-db`.

## إعداد التطوير

شغّل من المصدر دون خطوة بناء:

```bash
npm run dev -- --task "سرد جميع ملفات TypeScript داخل src/"
```

شغّل مجموعة الاختبارات:

```bash
npm test
```

وضع المراقبة للاختبارات:

```bash
npm run test:watch
```

تتوفر أيضًا مساعدات الإعداد التفاعلية:

```bash
npm run setup
npm run setup:non-interactive
```

## الخطوات التالية

- [readme.md](./readme.md) — نظرة عامة وبدء سريع
- [usage.md](./usage.md) — مرجع CLI، اختيار المحرّك، والاختبار
- [blurprint.md](./blurprint.md) — مخطط البنية
