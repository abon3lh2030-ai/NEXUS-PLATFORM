-- NEXUS Platform — 0023: founding data for the Founder Portal.
-- The Technology Independence Plan approved on 2026-11-15, the initial growth targets and the
-- simulator defaults. Everything here is ordinary editable data — nothing is hard-coded in the app.
-- Statuses describe the REAL state on 2026-11-16 (verified from the project): nothing is marked
-- done without evidence. Dates that depend on the actual launch date are left empty.

insert into public.founder_settings (key, value) values
  ('plan_approved_on', '"2026-11-15"'),
  ('launch_date', 'null'),
  ('opening_cash_balance', '0'),
  ('currency', '"SAR"'),
  ('usd_to_sar', '3.75'),
  ('reference_plan_price', '11999'),
  ('ai_cost_cap_per_company', '4200'),
  ('ai_cost_cap_pct', '35'),
  ('simulator_defaults', '{
    "companies": 25,
    "requests_per_company_month": 3000,
    "input_tokens_per_request": 6000,
    "output_tokens_per_request": 1000,
    "api_input_usd_per_mtok": 2,
    "api_output_usd_per_mtok": 10,
    "usd_to_sar": 3.75,
    "cloud_hosting_month": 1500,
    "mac_strong_count": 2, "mac_strong_price": 105000,
    "mac_medium_count": 8, "mac_medium_price": 51000,
    "mac_voice_count": 2, "mac_voice_price": 11999,
    "room_setup": 61000,
    "hardware_life_years": 4,
    "power_kwh_month": 1900, "power_sar_per_kwh": 0.3,
    "rent_year": 0,
    "internet_year": 4800,
    "maintenance_year": 35000,
    "salaries_year": 0,
    "training_year": 0,
    "other_opex_year": 1800,
    "years": 3
  }')
on conflict (key) do nothing;

/* ───────────── Phases ───────────── */

insert into public.founder_ti_phases (ord, code, name, goal, status, budget_total, annual_opex, notes, details) values
(1, 'y1_cloud', 'السنة الأولى — الإطلاق على الخدمات السحابية',
 'إطلاق المنصة وتشغيلها تجارياً على الخدمات السحابية دون شراء أجهزة مادية.',
 'current', null, null,
 'تبدأ بتاريخ الإطلاق الفعلي.',
 '{"architecture": [["قاعدة البيانات", "Supabase"], ["السيرفرات والموقع", "Render"], ["الذكاء الاصطناعي", "Anthropic Sonnet API"], ["الربط", "Cloudflare عند الحاجة"]],
   "assumptions": ["تكلفة Sonnet المستهدفة لا تتجاوز 4,200 ريال لكل شركة سنوياً.", "سقف التكلفة المستهدف 35% من سعر الباقة السنوية البالغ 11,999 ريال."]}'),
(2, 'y2_mac', 'السنة الثانية — Mac AI Infrastructure',
 'إيقاف الاعتماد على مزودي الذكاء الاصطناعي الخارجيين وتشغيل النماذج والصوت والاجتماعات والإيميلات محلياً داخل غرفة NEXUS.',
 'not_started', 752000, 48000,
 'تبدأ مع بداية السنة الثانية حسب تاريخ الإطلاق الفعلي.',
 '{"notes": ["استهلاك الطاقة المقدر 1,900 kWh شهرياً، ويجب إعادة حساب التعرفة الفعلية حسب موقع التشغيل والاستهلاك.",
             "Supabase وRender يستمران في العمل خلال هذه المرحلة.",
             "الربط مع غرفة الأجهزة عن طريق Cloudflare Tunnel أو بنية ربط آمنة مناسبة.",
             "لا يوجد احتياطي ذكاء اصطناعي خارجي بعد إيقافه.",
             "عند تعطل جهاز قوي ينتقل العمل إلى الجهاز الثاني، مع وجود حدود للقدرة الاستيعابية.",
             "عند تجاوز الضغط للقدرة المتاحة توضع الطلبات في Queue."],
   "sections": {"A": "أجهزة الذكاء الاصطناعي — 643,000 ريال تقريباً", "B": "تجهيز غرفة الأجهزة — 61,000 ريال تقريباً", "C": "التشغيل السنوي — 48,000 ريال تقريباً"}}'),
(3, 'y3_datacenter', 'السنة الثالثة — NEXUS Data Center',
 'نقل البنية التقنية إلى مركز بيانات مستأجر في الرياض، والاستغناء عن Supabase وRender ومزود البريد الخارجي، والبدء بتطوير وتدريب نموذج NEXUS الخاص.',
 'not_started', 990000, 505000, null,
 '{"sections": {"A": "البنية التحتية — 485,000 ريال تقريباً", "B": "التشغيل السنوي — 505,000 ريال تقريباً"},
   "training": {"goal": "إنشاء نموذج مخصص مستفيد من البيانات المصرح باستخدامها وتصحيحات المستخدمين ومدراء الشركات على مخرجات موظفي AI.",
                "cost_year": 50000,
                "example": "استئجار 8 GPU لمدة أسبوع قد يكلف قرابة 8,000 ريال وفق فرضية 6 ريالات للكرت بالساعة، ويجب التحقق من الأسعار والتوفر الفعليين.",
                "rules": ["لا تُستخدم مخرجات Claude لتدريب نموذج منافس، مع الالتزام بشروط Anthropic واتفاقيات جميع مزودي النماذج.",
                          "إخفاء الهوية وحده لا يكفي لجعل البيانات صالحة للتدريب."]}}'),
(4, 'y4_independent', 'ما بعد السنة الثالثة — الاستقلال التقني الكامل',
 'نماذج NEXUS الخاصة تعمل على أجهزة Mac، وقاعدة البيانات والسيرفرات والتخزين والبريد داخل السعودية، دون اعتماد تشغيلي على Supabase وRender أو مزودي AI الخارجيين.',
 'not_started', null, 505000,
 'التكلفة التشغيلية السنوية التقديرية 505,000–555,000 ريال.',
 '{"architecture": [["النماذج", "نماذج NEXUS الخاصة على أجهزة Mac"], ["قاعدة البيانات والسيرفرات", "داخل السعودية"], ["التخزين", "محلي"], ["البريد الإلكتروني", "محلي"]],
   "opex_range": [505000, 555000],
   "mac_renewal_reserve_year": 160000,
   "excluded": ["مهندس ذكاء اصطناعي", "مسؤول أمن سيبراني", "رسوم الدفع", "الدومينات", "أي توسع إضافي في الأجهزة"]}');

/* ───────────── Budget lines (planned vs actual comes from founder_transactions) ───────────── */

insert into public.founder_budgets (phase_id, group_label, name, category, planned_amount, recurring, notes)
select p.id, b.grp, b.name, b.cat, b.amount, b.rec, b.notes
from (values
  ('y2_mac', 'A. أجهزة الذكاء الاصطناعي', 'جهازان للنموذج القوي (Mac Studio M5 Ultra 512GB)', 'hardware', 210000, 'once', '105,000 ريال للجهاز'),
  ('y2_mac', 'A. أجهزة الذكاء الاصطناعي', 'ثمانية أجهزة للنموذج المتوسط (Mac Studio M5 Ultra 256GB)', 'hardware', 408000, 'once', '51,000 ريال للجهاز'),
  ('y2_mac', 'A. أجهزة الذكاء الاصطناعي', 'جهازان للصوت والاجتماعات والإيميلات (Mac Studio M5 Max)', 'hardware', 23998, 'once', '11,999 ريال للجهاز'),
  ('y2_mac', 'B. تجهيز غرفة الأجهزة', 'UPS Online 6kVA', 'facility', 15000, 'once', null),
  ('y2_mac', 'B. تجهيز غرفة الأجهزة', 'مكيفان سبليت 2 طن', 'facility', 16000, 'once', null),
  ('y2_mac', 'B. تجهيز غرفة الأجهزة', 'Switch 10GbE', 'facility', 12000, 'once', null),
  ('y2_mac', 'B. تجهيز غرفة الأجهزة', 'Firewall', 'facility', 12000, 'once', null),
  ('y2_mac', 'B. تجهيز غرفة الأجهزة', 'رفوف وكيابل وقفل وكاميرا وطفاية', 'facility', 6000, 'once', null),
  ('y2_mac', 'C. التشغيل السنوي', 'الكهرباء', 'operations', 7500, 'yearly', 'التقدير 5,000–7,500 ريال؛ تُعاد حسابه حسب التعرفة الفعلية'),
  ('y2_mac', 'C. التشغيل السنوي', 'إنترنت احتياطي 5G', 'operations', 4800, 'yearly', null),
  ('y2_mac', 'C. التشغيل السنوي', 'VPS لإرسال الإيميلات عبر Postal', 'servers', 1800, 'yearly', null),
  ('y2_mac', 'C. التشغيل السنوي', 'صيانة وقطع غيار', 'operations', 35000, 'yearly', 'تقريباً'),
  ('y3_datacenter', 'A. البنية التحتية', 'سيرفرات قاعدة البيانات (2 × 2U)', 'hardware', 150000, 'once', null),
  ('y3_datacenter', 'A. البنية التحتية', 'سيرفر التخزين (MinIO)', 'hardware', 60000, 'once', null),
  ('y3_datacenter', 'A. البنية التحتية', 'سيرفر النسخ الاحتياطي', 'hardware', 40000, 'once', null),
  ('y3_datacenter', 'A. البنية التحتية', 'سيرفرات التطبيقات (3 × 1U)', 'hardware', 105000, 'once', null),
  ('y3_datacenter', 'A. البنية التحتية', 'سيرفر المراقبة', 'hardware', 20000, 'once', null),
  ('y3_datacenter', 'A. البنية التحتية', 'الشبكة: سويتشان 25GbE وجداران للحماية', 'hardware', 110000, 'once', null),
  ('y3_datacenter', 'B. التشغيل السنوي', 'Rack في مركز بيانات الرياض', 'servers', 96000, 'yearly', null),
  ('y3_datacenter', 'B. التشغيل السنوي', 'ربع Rack للنسخ الاحتياطي', 'servers', 30000, 'yearly', null),
  ('y3_datacenter', 'B. التشغيل السنوي', 'إنترنت مخصص 1Gbps', 'operations', 36000, 'yearly', null),
  ('y3_datacenter', 'B. التشغيل السنوي', 'دعم ميداني', 'operations', 18000, 'yearly', null),
  ('y3_datacenter', 'B. التشغيل السنوي', 'مهندس DevOps', 'salaries', 216000, 'yearly', null),
  ('y3_datacenter', 'B. التشغيل السنوي', 'صيانة وقطع غيار', 'operations', 59000, 'yearly', null),
  ('y3_datacenter', 'B. التشغيل السنوي', 'تدريب النموذج', 'development', 50000, 'yearly', null),
  ('y4_independent', 'التشغيل السنوي', 'مراكز البيانات', 'servers', 144000, 'yearly', null),
  ('y4_independent', 'التشغيل السنوي', 'الإنترنت', 'operations', 36000, 'yearly', null),
  ('y4_independent', 'التشغيل السنوي', 'مهندس DevOps', 'salaries', 216000, 'yearly', null),
  ('y4_independent', 'التشغيل السنوي', 'الصيانة وقطع الغيار', 'operations', 59000, 'yearly', null),
  ('y4_independent', 'التشغيل السنوي', 'تدريب وتحسين النموذج', 'development', 50000, 'yearly', 'التقدير 50,000–100,000 ريال'),
  ('y4_independent', 'احتياطي', 'احتياطي تجديد أجهزة Mac', 'reserve', 160000, 'yearly', 'تقدير تخطيطي مستقل عن ميزانية التشغيل')
) as b(phase, grp, name, cat, amount, rec, notes)
join public.founder_ti_phases p on p.code = b.phase;

/* ───────────── Hardware ───────────── */

insert into public.founder_ti_assets (phase_id, budget_id, name, spec, purpose, models, quantity, unit_cost)
select p.id, (select id from public.founder_budgets where name = a.budget and phase_id = p.id), a.name, a.spec, a.purpose, a.models, a.qty, a.cost
from (values
  ('y2_mac', 'جهازان للنموذج القوي (Mac Studio M5 Ultra 512GB)', 'Mac Studio — النموذج القوي', 'M5 Ultra · 80-core GPU · 512GB RAM · 1TB', 'تنفيذ المهام المعقدة التي كانت تعتمد على Sonnet', 'Qwen3.5-397B-A17B أو أقوى نموذج مفتوح مناسب لذاكرة الجهاز', 2, 105000),
  ('y2_mac', 'ثمانية أجهزة للنموذج المتوسط (Mac Studio M5 Ultra 256GB)', 'Mac Studio — النموذج المتوسط', 'M5 Ultra · 80-core GPU · 256GB RAM · 1TB', 'المهام الثقيلة والسريعة', 'Tencent Hy3 للمهام الثقيلة · Gemma 4 26B A4B للمهام السريعة', 8, 51000),
  ('y2_mac', 'جهازان للصوت والاجتماعات والإيميلات (Mac Studio M5 Max)', 'Mac Studio — الصوت والاجتماعات والإيميلات', 'M5 Max · 36GB RAM · 512GB', 'تحويل الصوت لنص، توليد الصوت، البحث الدلالي', 'Whisper · NAMAA Saudi TTS · Embeddings', 2, 11999),
  ('y2_mac', 'UPS Online 6kVA', 'UPS Online 6kVA', null, 'حماية الطاقة', null, 1, 15000),
  ('y2_mac', 'مكيفان سبليت 2 طن', 'مكيف سبليت 2 طن', null, 'تبريد غرفة الأجهزة', null, 2, 8000),
  ('y2_mac', 'Switch 10GbE', 'Switch 10GbE', null, 'شبكة الغرفة', null, 1, 12000),
  ('y2_mac', 'Firewall', 'Firewall', null, 'حماية الشبكة', null, 1, 12000),
  ('y2_mac', 'رفوف وكيابل وقفل وكاميرا وطفاية', 'رفوف وكيابل وقفل وكاميرا وطفاية', null, 'تجهيز الغرفة', null, 1, 6000),
  ('y3_datacenter', 'سيرفرات قاعدة البيانات (2 × 2U)', 'سيرفر قاعدة البيانات 2U', 'معالجان 32-core · 512GB RAM · 6 × NVMe 3.84TB · RAID 10 (~11.5TB صافية)', 'واحد أساسي والثاني نسخة احتياطية متزامنة — Supabase ذاتي الاستضافة', null, 2, 75000),
  ('y3_datacenter', 'سيرفر التخزين (MinIO)', 'سيرفر التخزين', '12 × HDD 20TB · ~160TB صافية · MinIO', 'تخزين ملفات الشركات والصوت', null, 1, 60000),
  ('y3_datacenter', 'سيرفر النسخ الاحتياطي', 'سيرفر النسخ الاحتياطي', '8 × HDD 20TB', 'نسخ احتياطي في مركز بيانات منفصل', null, 1, 40000),
  ('y3_datacenter', 'سيرفرات التطبيقات (3 × 1U)', 'سيرفر التطبيقات 1U', 'معالجات 32-core · 256GB RAM', 'الموقع والـ API والوكلاء وModel Router وPostal', null, 3, 35000),
  ('y3_datacenter', 'سيرفر المراقبة', 'سيرفر المراقبة', null, 'مراقبة الأجهزة والخدمات والتنبيه عند الأعطال', null, 1, 20000),
  ('y3_datacenter', 'الشبكة: سويتشان 25GbE وجداران للحماية', 'Switch 25GbE', null, 'شبكة مركز البيانات', null, 2, null),
  ('y3_datacenter', 'الشبكة: سويتشان 25GbE وجداران للحماية', 'Firewall مركز البيانات', null, 'حماية الشبكة', null, 2, null)
) as a(phase, budget, name, spec, purpose, models, qty, cost)
join public.founder_ti_phases p on p.code = a.phase;

/* ───────────── Models ───────────── */

insert into public.founder_ti_models (phase_id, name, role, host, status, notes)
select p.id, m.name, m.role, m.host, 'planned', m.notes
from (values
  ('y1_cloud', 'Claude Sonnet (Anthropic API)', 'كل مهام الذكاء الاصطناعي', 'external_api', 'مفتاح Anthropic لم يُضف بعد؛ المنصة تعمل حالياً بمزوّد تجريبي (mock).'),
  ('y2_mac', 'Qwen3.5-397B-A17B', 'المهام المعقدة', 'mac', 'أو أقوى نموذج مفتوح مناسب لذاكرة الجهاز'),
  ('y2_mac', 'Tencent Hy3', 'المهام الثقيلة', 'mac', null),
  ('y2_mac', 'Gemma 4 26B A4B', 'المهام السريعة', 'mac', null),
  ('y2_mac', 'Whisper', 'تحويل الصوت إلى نص', 'mac', null),
  ('y2_mac', 'NAMAA Saudi TTS', 'توليد الصوت', 'mac', null),
  ('y2_mac', 'نموذج Embeddings', 'البحث الدلالي في مستندات الشركات', 'mac', 'لم يُحدد النموذج بعد'),
  ('y3_datacenter', 'نموذج NEXUS المخصص (LoRA على نموذج مفتوح مثل Gemma)', 'مهام NEXUS الفعلية', 'mac', 'لا تُستخدم مخرجات Claude في التدريب.')
) as m(phase, name, role, host, notes)
join public.founder_ti_phases p on p.code = m.phase;

/* ───────────── Capabilities: who provides each one (verified 2026-11-16) ───────────── */

insert into public.founder_ti_services (capability, provider, ownership, status, target_phase_id, weight, verified, evidence, notes)
select s.cap, s.provider, s.own, s.status, (select id from public.founder_ti_phases where code = s.target), s.weight, s.verified, s.evidence, s.notes
from (values
  ('قاعدة البيانات', 'Supabase Cloud (Frankfurt، خطة Free)', 'external', 'active', 'y3_datacenter', 3, true, 'مشروع Supabase قائم وكل الـ migrations مطبّقة عليه.', 'يجب الترقية لخطة Pro قبل الإطلاق.'),
  ('المصادقة وتسجيل الدخول', 'Supabase Auth', 'external', 'active', 'y3_datacenter', 1, true, 'تسجيل الدخول في الموقع وتطبيق iOS يعمل عبر Supabase Auth.', null),
  ('تخزين الملفات', 'Supabase Storage', 'external', 'active', 'y3_datacenter', 2, true, 'ملفات الشركات في bucket خاص على Supabase Storage.', null),
  ('النسخ الاحتياطي', 'Supabase (خطة Free)', 'external', 'active', 'y3_datacenter', 1, true, 'خطة Free الحالية لا تتضمن نسخاً احتياطية قابلة للاستعادة.', 'خطر قائم حتى الترقية.'),
  ('استضافة الموقع والـ API', 'Render', 'external', 'planned', 'y3_datacenter', 2, true, 'ملف render.yaml جاهز لكن النشر لم يتم بعد؛ المنصة تعمل محلياً فقط.', null),
  ('الذكاء الاصطناعي', 'Anthropic Sonnet API', 'external', 'planned', 'y2_mac', 4, true, 'AI_DEFAULT_MODEL مضبوط، لكن مفتاح Anthropic غير موجود؛ المزود الحالي تجريبي (mock).', null),
  ('البريد الإلكتروني', 'Resend', 'external', 'planned', 'y2_mac', 1, true, 'render.yaml يستخدم Resend، والمفتاح غير موجود بعد.', 'البديل المخطط: Postal على VPS ثم داخل مركز البيانات.'),
  ('تحويل الصوت إلى نص', 'غير مفعّل', 'external', 'planned', 'y2_mac', 1, true, 'لا يوجد مزود مفعّل؛ Recall/ElevenLabs اختيارية ولم تُختبر.', null),
  ('توليد الصوت', 'ElevenLabs (اختياري، لم يُختبر)', 'external', 'planned', 'y2_mac', 1, true, 'VOICE_PROVIDER=none حالياً.', null),
  ('البحث الدلالي (Embeddings)', 'غير مفعّل', 'external', 'planned', 'y2_mac', 1, false, null, 'يحتاج تحقق: الأعمدة موجودة في قاعدة البيانات لكن لا يوجد مزود Embeddings مفعّل.'),
  ('الربط الآمن', 'Cloudflare Tunnel (عند الحاجة)', 'external', 'planned', 'y2_mac', 1, true, 'غير مستخدم حالياً.', 'يربط غرفة الأجهزة بالمنصة في السنة الثانية.'),
  ('اجتماعات الفيديو', 'NEXUS (WebRTC مباشر بين المشاركين)', 'owned', 'active', null, 1, true, 'مبني داخل NEXUS دون طرف ثالث، ومختبر بين متصفحين.', 'حد أقصى 6 مشاركين.'),
  ('قاعدة البيانات', 'Supabase ذاتي الاستضافة في مركز بيانات الرياض', 'owned', 'planned', 'y3_datacenter', 3, false, null, null),
  ('المصادقة وتسجيل الدخول', 'Supabase Auth ذاتي الاستضافة', 'owned', 'planned', 'y3_datacenter', 1, false, null, null),
  ('تخزين الملفات', 'MinIO في مركز البيانات', 'owned', 'planned', 'y3_datacenter', 2, false, null, null),
  ('النسخ الاحتياطي', 'سيرفر نسخ احتياطي في مركز بيانات منفصل', 'owned', 'planned', 'y3_datacenter', 1, false, null, null),
  ('استضافة الموقع والـ API', 'سيرفرات التطبيقات في مركز البيانات', 'owned', 'planned', 'y3_datacenter', 2, false, null, null),
  ('الذكاء الاصطناعي', 'نماذج مفتوحة على أجهزة Mac', 'owned', 'planned', 'y2_mac', 4, false, null, null),
  ('البريد الإلكتروني', 'Postal', 'owned', 'planned', 'y2_mac', 1, false, null, null),
  ('تحويل الصوت إلى نص', 'Whisper على Mac', 'owned', 'planned', 'y2_mac', 1, false, null, null),
  ('توليد الصوت', 'NAMAA Saudi TTS على Mac', 'owned', 'planned', 'y2_mac', 1, false, null, null),
  ('البحث الدلالي (Embeddings)', 'Embeddings على Mac', 'owned', 'planned', 'y2_mac', 1, false, null, null)
) as s(cap, provider, own, status, target, weight, verified, evidence, notes);

/* ───────────── Tasks and transition conditions ───────────── */

insert into public.founder_ti_tasks (phase_id, kind, ord, title, status, progress, evidence, note, needs_decision)
select p.id, t.kind, t.ord, t.title, t.status, t.progress, t.evidence, t.note, t.decision
from (values
  ('y1_cloud', 'task', 1, 'إطلاق المنصة', 'in_progress', 0, 'المنصة مبنية وتعمل محلياً؛ النشر على Render والمفاتيح (Anthropic، Resend، Moyasar) لم تكتمل.', 'حدّد نسبة الإنجاز بنفسك.', false),
  ('y1_cloud', 'task', 2, 'اكتساب الشركات والعملاء', 'not_started', 0, null, null, false),
  ('y1_cloud', 'task', 3, 'مراقبة تكاليف الذكاء الاصطناعي لكل شركة', 'in_progress', 0, 'المنصة تسجّل تكلفة الذكاء الاصطناعي لكل شركة وتطبق سقوفاً أسبوعية وسنوية (migrations 0013 و0015 و0017). لم تُختبر بمفتاح حقيقي.', null, false),
  ('y1_cloud', 'task', 4, 'تحسين كفاءة استخدام التوكنز', 'not_started', 0, null, null, false),
  ('y1_cloud', 'task', 5, 'اختبار النماذج المفتوحة', 'not_started', 0, null, null, false),
  ('y1_cloud', 'task', 6, 'قياس جودة النماذج المحلية مقارنة بـ Sonnet', 'not_started', 0, null, null, false),
  ('y1_cloud', 'task', 7, 'تجهيز البنية التقنية للانتقال إلى السنة الثانية', 'not_started', 0, null, null, false),
  ('y1_cloud', 'task', 8, 'إضافة بند تعاقدي يسمح باستخدام البيانات بعد إخفاء الهوية لأغراض تطوير النماذج، بعد مراجعة قانونية وخصوصية وموافقات صحيحة', 'not_started', 0, null, 'يحتاج مراجعة قانونية قبل الاعتماد.', true),
  ('y1_cloud', 'task', 9, 'بناء مجموعة بيانات تدريبية مشروعة', 'not_started', 0, null, 'يعتمد على البند التعاقدي والموافقات.', false),
  ('y2_mac', 'exit_condition', 1, 'شراء وتركيب الأجهزة', 'not_started', 0, null, null, false),
  ('y2_mac', 'exit_condition', 2, 'تشغيل النماذج فعلياً', 'not_started', 0, null, null, false),
  ('y2_mac', 'exit_condition', 3, 'اختبار الجودة مقابل Sonnet', 'not_started', 0, null, null, false),
  ('y2_mac', 'exit_condition', 4, 'اختبار الضغط وعدد الطلبات المتزامنة', 'not_started', 0, null, null, false),
  ('y2_mac', 'exit_condition', 5, 'اختبار الأعطال والتعافي', 'not_started', 0, null, null, false),
  ('y2_mac', 'exit_condition', 6, 'اختبار الصوت والاجتماعات والإيميلات', 'not_started', 0, null, null, false),
  ('y2_mac', 'exit_condition', 7, 'التأكد من حماية بيانات الشركات', 'not_started', 0, null, null, false),
  ('y2_mac', 'exit_condition', 8, 'إثبات القدرة على تشغيل المهام دون اعتماد على APIs خارجية', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'task', 1, 'اختيار نموذج مفتوح مناسب مثل Gemma', 'not_started', 0, null, null, true),
  ('y3_datacenter', 'task', 2, 'استخدام LoRA Fine-tuning', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'task', 3, 'إنشاء Dataset منقحة ومصرح بها', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'task', 4, 'فصل بيانات كل شركة', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'task', 5, 'إزالة المعلومات الشخصية والتجارية الحساسة حسب متطلبات الموافقة والسياسات', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'task', 6, 'تقييم النموذج قبل وبعد التدريب', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'task', 7, 'اختبار الجودة والأمان', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'task', 8, 'اختبار أداء النموذج في مهام NEXUS الفعلية', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 1, 'تشغيل البنية التحتية في مركز البيانات', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 2, 'نقل قاعدة البيانات بنجاح', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 3, 'نقل ملفات الشركات', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 4, 'تشغيل نسخ احتياطية مستقلة', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 5, 'تشغيل السيرفرات والتطبيقات', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 6, 'استبدال خدمات Render', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 7, 'استضافة قاعدة البيانات ذاتياً بدلاً من Supabase Cloud', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 8, 'نقل البريد الإلكتروني', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 9, 'تشغيل Model Router', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 10, 'اختبار التعافي من الكوارث', 'not_started', 0, null, null, false),
  ('y3_datacenter', 'exit_condition', 11, 'إطلاق أول نسخة من نموذج NEXUS المخصص', 'not_started', 0, null, null, false)
) as t(phase, kind, ord, title, status, progress, evidence, note, decision)
join public.founder_ti_phases p on p.code = t.phase;

/* ───────────── Technology risks ───────────── */

insert into public.founder_risks (area, title, description, likelihood, impact, mitigation, phase_id)
select 'technology', r.title, r.descr, r.l, r.i, r.mit, (select id from public.founder_ti_phases where code = r.phase)
from (values
  ('مفتاح Anthropic غير مضاف', 'المنصة تعمل بمزود تجريبي، ولا يمكن الإطلاق التجاري بدون مفتاح حقيقي.', 5, 5, 'إضافة المفتاح وضبط حدود الإنفاق ثم اختبار حقيقي.', 'y1_cloud'),
  ('Supabase على خطة Free بدون نسخ احتياطية', 'أي خطأ أو حذف قد لا يمكن استرجاعه.', 3, 5, 'الترقية إلى Pro قبل الإطلاق.', 'y1_cloud'),
  ('تجاوز تكلفة Sonnet للسقف المستهدف', 'السقف 4,200 ريال لكل شركة سنوياً (35% من 11,999).', 3, 4, 'سقوف الاستخدام الأسبوعية والسنوية ومراقبة التكلفة لكل شركة.', 'y1_cloud'),
  ('لا يوجد احتياطي ذكاء اصطناعي خارجي بعد إيقافه', 'أي عطل في الأجهزة المحلية يؤثر مباشرة على الخدمة.', 3, 5, 'جهاز ثانٍ للنموذج القوي، وطابور (Queue) عند تجاوز القدرة.', 'y2_mac'),
  ('حدود القدرة الاستيعابية عند تعطل جهاز قوي', 'ينتقل العمل للجهاز الثاني بقدرة أقل.', 3, 4, 'اختبار الضغط والتعافي قبل الانتقال.', 'y2_mac'),
  ('جودة النماذج المفتوحة أقل من Sonnet', 'قد لا تحقق النماذج المحلية جودة المهام الحالية.', 3, 5, 'قياس الجودة مقابل Sonnet قبل إيقاف الـ API.', 'y2_mac'),
  ('تغيّر أسعار الأجهزة وتوفرها', 'الأسعار تقديرية وقد تختلف عند الشراء.', 3, 3, 'تحديث الأسعار قبل الشراء.', 'y2_mac'),
  ('تعرفة الكهرباء الفعلية', 'الاستهلاك المقدر 1,900 kWh شهرياً، والتعرفة تختلف حسب الموقع.', 2, 2, 'إعادة الحساب حسب موقع التشغيل.', 'y2_mac'),
  ('مشروعية بيانات التدريب', 'إخفاء الهوية وحده لا يكفي، ويجب الالتزام بشروط مزودي النماذج.', 3, 5, 'مراجعة قانونية، موافقات صريحة، عدم استخدام مخرجات Claude.', 'y3_datacenter'),
  ('نقل قاعدة البيانات والملفات', 'خطر فقدان بيانات أو توقف أثناء النقل من Supabase Cloud.', 2, 5, 'خطة نقل مع نسخ احتياطية واختبار تعافٍ.', 'y3_datacenter')
) as r(title, descr, l, i, mit, phase);

/* ───────────── Growth plan ───────────── */

with plan as (
  insert into public.founder_plans (name, kind, description, status)
  values ('خطة التوسع الأولية', 'growth', 'أهداف مبدئية قابلة للتعديل. التواريخ تُحدد حسب تاريخ الإطلاق الفعلي.', 'active')
  returning id
)
insert into public.founder_goals (plan_id, title, area, period, metric, target_value, unit, priority, status, notes)
select plan.id, g.title, 'companies', 'custom', 'won_companies', g.target, 'شركة', 'high', 'not_started', g.notes from plan,
(values
  ('25 شركة خلال أول 6 أشهر', 25, 'حدّد تاريخ البداية والنهاية عند الإطلاق.'),
  ('100 شركة خلال الستة أشهر التالية', 100, 'حدّد تاريخ البداية والنهاية عند الإطلاق.')
) as g(title, target, notes);
