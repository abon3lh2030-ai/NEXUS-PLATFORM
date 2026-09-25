# دليل إعداد متغيرات البيئة — منصة NEXUS

هذا الدليل يشرح كل متغير بيئة: ما هو، ومن أين تحصل عليه، وأين تضعه.

- **محليًا:** انسخ `.env.example` إلى `.env` في جذر المشروع واملأ القيم. ملف `.env` مستثنى من Git ولن يُرفع.
- **على Render:** ضع القيم في لوحة Render → الخدمة → **Environment**. ملف `render.yaml` يحدد المتغيرات، والسرّية منها معلّمة `sync: false` حتى لا تُكتب في المستودع.

> ⚠️ لا تضع أي مفتاح سري في كود الواجهة أو في متغيرات تبدأ بـ `VITE_`، فهذه تُضمَّن في المتصفح ويراها الجميع.

---

## 1) Supabase (قاعدة البيانات والمصادقة والتخزين والتحديث اللحظي)

| المتغير | الوصف | من أين؟ |
|---|---|---|
| `SUPABASE_URL` | رابط مشروع Supabase | Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | المفتاح العام (آمن للمتصفح لأن RLS يحمي البيانات) | Project Settings → API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | **مفتاح سري للخادم فقط**، يتجاوز RLS | Project Settings → API → `service_role` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | القيم نفسها للواجهة (العامة فقط) | كما سبق |

**خطوات الإعداد:**
1. أنشئ مشروعًا في [supabase.com](https://supabase.com) واختر أقرب منطقة للمملكة.
2. شغّل ملفات `supabase/migrations/*.sql` **بالترتيب** من SQL Editor، أو عبر `supabase db push` إذا ربطت Supabase CLI.
3. من **Authentication → URL Configuration**:
   - **Site URL:** رابط الواجهة (مثل `https://app.your-domain.sa`).
   - **Redirect URLs:** أضف `https://app.your-domain.sa/auth/callback`، وللتطوير المحلي `http://localhost:5173/auth/callback`.
4. فعّل **Email confirmations** من Authentication → Providers → Email.
5. تأكد أن الحاوية `company-files` **خاصة (Private)**. الـ migration يُنشئها خاصة تلقائيًا.
6. لمنح حساب المشرف العام: سجّل بالحساب أولًا، ثم نفّذ `scripts/grant-super-admin.sql` في SQL Editor.

---

## 2) الروابط

| المتغير | المثال (الإنتاج) |
|---|---|
| `PUBLIC_APP_URL` / `VITE_PUBLIC_APP_URL` | `https://app.your-domain.sa` |
| `API_BASE_URL` / `VITE_API_BASE_URL` | `https://api.your-domain.sa` |
| `CORS_ALLOWED_ORIGINS` | `https://app.your-domain.sa`. للنطاقات المتعددة افصل بينها بفاصلة. |
| `AUTH_REDIRECT_URL` | `https://app.your-domain.sa/auth/callback` |

في الإنتاج يجب أن تبدأ الروابط بـ `https://`، والخادم يرفض الإقلاع بغير ذلك.

---

## 3) الذكاء الاصطناعي (Anthropic Claude)

| المتغير | الوصف |
|---|---|
| `AI_PROVIDER` | القيمة `anthropic` في الإنتاج. القيمة `mock` للتطوير والاختبار فقط، وهي مرفوضة في الإنتاج، ومخرجاتها معلّمة `[MOCK]`. |
| `ANTHROPIC_API_KEY` | من [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `AI_DEFAULT_MODEL` | الافتراضي `claude-opus-5`. يمكن اختيار نموذج لكل موظف من الواجهة. |
| `AI_EFFORT` | مستوى الجهد: `low` أو `medium` أو `high`… الافتراضي `medium` لتوازن التكلفة والجودة. |
| `USD_TO_SAR_RATE` | سعر الصرف المستخدم لعرض التكلفة التقديرية بالريال. |

للمنصة سقف أمان للتكلفة والخطوات لكل جلسة عمل، ويُحسب الاستهلاك في لوحة التحليلات.

---

## 4) الأجهزة الافتراضية لموظفي الذكاء الاصطناعي

| المتغير | الوصف |
|---|---|
| `COMPUTER_PROVIDER` | القيمة `storage_workspace` (الافتراضية) تعطي مساحة عمل معزولة حقيقية للملفات والمستندات، **بدون متصفح أو طرفية**. القيمة `e2b` لبيئة معزولة خارجية بمتصفح وطرفية، وهي **غير مربوطة بعد**. |
| `E2B_API_KEY` | عند اعتماد E2B لاحقًا، من [e2b.dev](https://e2b.dev). |

الواجهة تعرض المتصفح والطرفية كـ"غير مربوط" إلى أن يُربط مزود حقيقي ويُختبر.

---

## 5) الدفع (ميسر — Apple Pay والبطاقات)

| المتغير | الوصف | من أين؟ |
|---|---|---|
| `MOYASAR_PUBLISHABLE_KEY` | المفتاح العام (`pk_test_…` أو `pk_live_…`) | لوحة ميسر → Settings → API Keys |
| `MOYASAR_SECRET_KEY` | **سري للخادم فقط** (`sk_…`)، يُستخدم للتحقق من الدفعات | كما سبق |
| `MOYASAR_WEBHOOK_SECRET` | سرّ الـ Webhook | لوحة ميسر → Webhooks، مع الرابط `https://api.your-domain.sa/webhooks/moyasar` والحدث `payment_paid` |
| `MOYASAR_APPLE_PAY_ENABLED` | `true` بعد إتمام تحقق دومين Apple Pay فقط | — |

**كيف يعمل الدفع:**
1. السعر يحدده الخادم من قاعدة البيانات.
2. يتم الدفع في نموذج ميسر، ولا تمر بيانات البطاقة على خوادم NEXUS.
3. يتحقق الخادم من الدفعة مباشرة مع ميسر: المبلغ، والعملة، ورقم العملية.
4. يُفعَّل الاشتراك فور التحقق.

**تحقق Apple Pay:** بعد ربط الدومين، اتبع توثيق ميسر الرسمي لتحقق الدومين (رفع ملف التحقق إلى المسار الذي يحدده ميسر ضمن `/.well-known/`). لا نفعّل Apple Pay قبل نجاح التحقق الفعلي.

---

## 6) إعداد البريد الإلكتروني

**المزود المستخدم: [Resend](https://resend.com).**
اخترناه لأنه:
- يدعم الإرسال بهويات متعددة على دومين موثّق، وهو ما تحتاجه عناوين موظفي الذكاء الاصطناعي.
- يدعم المرفقات.
- يقدّم API بسيطًا وموثوقًا.

| المتغير | الوصف |
|---|---|
| `EMAIL_PROVIDER` | القيمة `resend` في الإنتاج. القيمة `console` للتطوير فقط، **ولا ترسل شيئًا فعليًا**، وتُسجَّل الرسائل كـ"لم تُرسل". |
| `RESEND_API_KEY` | من Resend → API Keys |
| `EMAIL_FROM` | مرسل إشعارات المنصة، مثل `NEXUS <no-reply@your-domain.sa>` |
| `EMAIL_AGENT_DOMAIN` | دومين فرعي موثّق لعناوين الموظفين الأذكياء، مثل `agents.your-domain.sa` |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | سرّ (24 حرفًا على الأقل) يرسله مُمرِّر البريد الوارد في الترويسة `X-Nexus-Webhook-Secret` |

**متطلبات الدومين:**
- أضف سجلات DNS التي يطلبها Resend (SPF وDKIM، ويُنصح بـ DMARC) للدومين الرئيسي والدومين الفرعي للموظفين.

**البريد الوارد:**
- الـ endpoint هو `POST https://api.your-domain.sa/webhooks/email/inbound`.
- يستقبل الحقول `{to, from, subject, text, message_id}`.
- يُضبط من مزود البريد الوارد (أو خدمة تمرير) بعد ربط الدومين.

**السياسات** (من الإعدادات → التكاملات والسياسات):
- **مسودات فقط:** الموظف الذكي يكتب والإنسان يرسل.
- **بموافقة:** كل رسالة تحتاج موافقة المدير.
- **مستقل:** يرسل داخليًا ضمن السياسة.

بغض النظر عن السياسة، تحتاج موافقة بشرية دائمًا: الرسائل الخارجية (إلا لدومينات مسموح بها صراحة)، والمرفقات لجهات خارجية، وأي التزام بعقد أو سعر نهائي أو ضمان.

كل رسالة يرسلها موظف ذكي تُذيَّل تلقائيًا بتعريف أنه **موظف ذكاء اصطناعي**.

---

## 7) إعداد تقويم الموظفين

| المتغير | الوصف |
|---|---|
| `CALENDAR_PROVIDER` | القيمة `nexus` (الافتراضية) هي تقويم مدمج حقيقي: اجتماعات ومواعيد نهائية ومراحل، مع إيجاد الأوقات المتاحة بتوقيت الرياض وأيام الأحد إلى الخميس. |
| `GOOGLE_OAUTH_CLIENT_ID` / `…_SECRET` | لمزامنة Google Calendar لاحقًا، من Google Cloud Console → Credentials (OAuth client) |
| `MICROSOFT_OAUTH_CLIENT_ID` / `…_SECRET` | لمزامنة Microsoft 365 لاحقًا، من Azure Portal → App registrations |

المزامنة الخارجية **غير مربوطة بعد**. عند اعتمادها:
- نضيف رابط العودة (Redirect URL) الخاص بـ OAuth، مثل `https://api.your-domain.sa/oauth/google/callback`.
- ثم نختبرها قبل تفعيلها.

---

## 8) إعداد الاجتماعات

| المتغير | الوصف |
|---|---|
| `MEETING_PROVIDER` | القيمة `nexus` تشمل الجدولة وجدول الأعمال والمحضر والمعالجة الذكية بعد الاجتماع، **بدون دخول مباشر للاجتماع**. القيمة `recall` تستخدم Recall.ai. |
| `RECALL_API_KEY` | من [recall.ai](https://recall.ai) → API Keys |
| `RECALL_REGION` | منطقة الحساب، مثل `us-east-1` |
| `RECALL_WEBHOOK_SECRET` | لاستقبال أحداث البوت لاحقًا |

**لماذا Recall.ai؟** يوفر بوتات تنضم إلى Zoom وGoogle Meet وMicrosoft Teams من خلال API واحد. تستمع البوتات وتنتج المحضر النصي، ويمكنها إخراج صوت.

**الخصوصية والموافقة:**
- ضع علامة "موافقة المشاركين" على الاجتماع قبل حضور المساعد الذكي. هذا مطلوب افتراضيًا حسب السياسة.
- يظهر اسم البوت دائمًا مثل «أطلس (مساعد ذكاء اصطناعي)».
- سياسة التسجيل ومدة الاحتفاظ بالمحاضر قابلة للضبط، وتُحذف المحاضر تلقائيًا بعد انتهاء المدة.

> تكامل Recall.ai مكتوب لكنه **لم يُختبر بعد بمفتاح حقيقي**، ولن نعدّه يعمل قبل اختبار فعلي.

---

## 9) إعداد الصوت

| المتغير | الوصف |
|---|---|
| `VOICE_PROVIDER` | القيمة `none` (الافتراضية) أو `elevenlabs` |
| `ELEVENLABS_API_KEY` | من [elevenlabs.io](https://elevenlabs.io) → Profile → API Keys |
| `ELEVENLABS_DEFAULT_VOICE_ID` | معرّف صوت افتراضي، ويمكن تحديد صوت لكل موظف من الواجهة |

**لماذا ElevenLabs؟** جودة عالية في العربية والإنجليزية، ويوفر تحويل النص إلى صوت (TTS) وتحويل الصوت إلى نص (STT).

الموظف يعرّف نفسه صوتيًا كمساعد ذكاء اصطناعي، ولا ينتحل شخصية إنسان.

> تكامل ElevenLabs **لم يُختبر بعد بمفتاح حقيقي**.

---

## 10) إعداد العروض التقديمية

**لا تحتاج أي مزود خارجي.** تُولَّد ملفات PPTX حقيقية داخل الخادم بمكتبة `pptxgenjs`:
- نصوص قابلة للتعديل، ورسوم بيانية وجداول أصلية في PowerPoint.
- دعم العربية واتجاه RTL.
- شعار الشركة وألوانها (من إعدادات المنشأة).

تصدير PDF غير مفعّل حاليًا لأنه يحتاج محرك تحويل مثل LibreOffice. لن نفعّله قبل أن يكون موثوقًا.

---

## 11) إعدادات المنصة والعمال الخلفيين

| المتغير | الوصف |
|---|---|
| `PLATFORM_ADMIN_NOTIFICATION_EMAIL` | بريد استلام إشعارات طلبات التسجيل وطلبات المؤسسات والإغلاق: `abdullahfah2030@hotmail.com` |
| `PLATFORM_COMMERCIAL_REGISTRATION` | السجل التجاري للجهة المالكة: `7055047331` |
| `MALWARE_SCAN_PROVIDER` | القيمة `none`: لا يوجد فاحص فيروسات مربوط، والملفات تُعلَّم "لم تُفحص" بصراحة. |
| `AGENT_WORKER_ENABLED` / `AGENT_WORKER_CONCURRENCY` / `AGENT_POLL_INTERVAL_MS` | تشغيل منفّذ جلسات موظفي الذكاء الاصطناعي |
| `CRON_ENABLED` | المهام الدورية: انتهاء الاشتراكات، واستعادة الجلسات المتوقفة، وتنظيف المحاضر والرفوعات المهجورة |

---

## 12) التشغيل المحلي

```bash
npm install            # تثبيت الحزم
cp .env.example .env   # ثم املأ القيم
npm run dev            # الخادم على 8080 والواجهة على 5173
npm run typecheck && npm run lint && npm run test
npm run test:e2e       # اختبارات الواجهة (+ اختبارات الملفات عند توفر Supabase)
npm run build
```

لتشغيل اختبارات أمان الملفات الشاملة ضد بيئة حقيقية:
```bash
E2E_API_URL=https://api.your-domain.sa SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run test:e2e
```
