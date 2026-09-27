/**
 * LOCAL DEMO MODE ONLY — sample company used to explore the UI without a backend.
 * Never imported in production builds (see main.tsx). Data lives in memory and resets on reload.
 */
import { DEFAULT_ROLE_PERMISSIONS, type DeckSpec, type PublicPlan } from '@nexus/shared';
import { DEMO_TEMPLATES } from './templates';

export type Row = { id: string } & Record<string, unknown>;

export const DEMO_CREDENTIALS = { email: 'demo@example.com', password: 'Nexus@2026' };
export const DEMO_USER_ID = 'd0000000-0000-4000-8000-000000000001';
export const DEMO_ORG_ID = 'd0000000-0000-4000-8000-0000000000a1';

const now = Date.now();
const minutes = (n: number) => new Date(now + n * 60_000).toISOString();
const days = (n: number) => new Date(now + n * 86_400_000).toISOString();
const date = (n: number) => days(n).slice(0, 10);
let seq = 1000;
export const newId = () => `d${(++seq).toString(16).padStart(7, '0')}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;

export const PLANS: PublicPlan[] = [
  {
    code: 'starter', name_ar: 'المبتدئة', name_en: 'Starter', price_halalas: 99900, currency: 'SAR', billing_interval: 'yearly', is_popular: false, is_custom: false, sort_order: 1,
    ai_models: ['claude-sonnet-5', 'claude-haiku-4-5'],
    entitlements: { human_members: 3, ai_employees: 5, ai_executions_per_year: 600, active_projects: 10, storage_bytes: 53687091200, max_file_size_bytes: 262144000, concurrent_ai_sessions: 3, computer_minutes_per_year: 6000, ai_budget_halalas_per_year: 35000, features: ['basic_memory', 'basic_analytics'] },
  },
  {
    code: 'pro', name_ar: 'الاحترافية', name_en: 'Pro', price_halalas: 199900, currency: 'SAR', billing_interval: 'yearly', is_popular: true, is_custom: false, sort_order: 2,
    ai_models: ['claude-sonnet-5', 'claude-haiku-4-5'],
    entitlements: { human_members: 10, ai_employees: 15, ai_executions_per_year: 2500, active_projects: null, storage_bytes: 214748364800, max_file_size_bytes: 524288000, concurrent_ai_sessions: 8, computer_minutes_per_year: 24000, ai_budget_halalas_per_year: 75000, features: ['basic_memory', 'full_memory', 'knowledge', 'decisions', 'meetings', 'approvals', 'agent_orchestration', 'basic_analytics', 'advanced_analytics'] },
  },
  {
    code: 'business', name_ar: 'الأعمال', name_en: 'Business', price_halalas: 299900, currency: 'SAR', billing_interval: 'yearly', is_popular: false, is_custom: false, sort_order: 3,
    ai_models: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5'],
    entitlements: { human_members: 30, ai_employees: 40, ai_executions_per_year: 8000, active_projects: null, storage_bytes: 1099511627776, max_file_size_bytes: 1073741824, concurrent_ai_sessions: 20, computer_minutes_per_year: 100000, ai_budget_halalas_per_year: 115000, features: ['basic_memory', 'full_memory', 'knowledge', 'decisions', 'meetings', 'approvals', 'advanced_approvals', 'agent_orchestration', 'advanced_orchestration', 'basic_analytics', 'advanced_analytics', 'advanced_permissions', 'audit_logs', 'priority_support', 'archive_uploads'] },
  },
  {
    code: 'enterprise', name_ar: 'المؤسسات', name_en: 'Enterprise', price_halalas: null, currency: 'SAR', billing_interval: 'yearly', is_popular: false, is_custom: true, sort_order: 4,
    ai_models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-5-5', 'claude-fable-5-1'],
    entitlements: { human_members: null, ai_employees: null, ai_executions_per_year: null, active_projects: null, storage_bytes: null, max_file_size_bytes: 2147483648, concurrent_ai_sessions: 50, computer_minutes_per_year: null, ai_budget_halalas_per_year: null, features: ['basic_memory', 'full_memory', 'knowledge', 'decisions', 'meetings', 'approvals', 'advanced_approvals', 'agent_orchestration', 'advanced_orchestration', 'basic_analytics', 'advanced_analytics', 'advanced_permissions', 'audit_logs', 'priority_support', 'archive_uploads'] },
  },
];
export const DEMO_PLAN = PLANS[2]!; // Business — shows every feature

export const OWNER_PERMISSIONS = [...DEFAULT_ROLE_PERMISSIONS.owner];

function seed() {
  const dept = (id: string, name: string, objective: string, lead_ai: string | null): Row => ({ id, organization_id: DEMO_ORG_ID, name, description: '', objective, lead_member_id: null, lead_ai_employee_id: lead_ai, parent_id: null, kpis: [], created_at: days(-60) });
  const departments = [
    dept('dep-exec', 'الإدارة التنفيذية', 'قيادة النمو وتحقيق أهداف 2026', 'ai-atlas'),
    dept('dep-mkt', 'التسويق', 'رفع الوعي بالعلامة وزيادة العملاء المحتملين 40%', 'ai-layan'),
    dept('dep-fin', 'المالية', 'ضبط التكاليف ورفع هامش الربح', 'ai-waleed'),
    dept('dep-sales', 'المبيعات', 'إغلاق 25 عميلًا جديدًا هذا الربع', null),
  ];
  const members: Row[] = [
    { id: 'mem-owner', user_id: DEMO_USER_ID, full_name: 'عبدالله', role: 'owner', job_title: 'المدير التنفيذي', department_id: 'dep-exec', email: DEMO_CREDENTIALS.email, status: 'active' },
    { id: 'mem-sara', user_id: 'u-sara', full_name: 'سارة القحطاني', role: 'admin', job_title: 'مديرة العمليات', department_id: 'dep-exec', email: 'sara@example.com', status: 'active' },
    { id: 'mem-fahad', user_id: 'u-fahad', full_name: 'فهد العتيبي', role: 'member', job_title: 'مدير المبيعات', department_id: 'dep-sales', email: 'fahad@example.com', status: 'active' },
  ];
  const ai = (id: string, name: string, job_title: string, department_id: string, status: string, autonomy: string, responsibilities: string[], skills: string[]): Row => ({
    id, organization_id: DEMO_ORG_ID, name, avatar_seed: name, job_title, department_id, manager_member_id: 'mem-owner', role_description: '', responsibilities, skills, goals: [], instructions: '', status, autonomy, provider: 'anthropic', model: 'claude-sonnet-5', is_active: true, created_at: days(-45), deleted_at: null,
  });
  const ai_employees = [
    ai('ai-atlas', 'أطلس', 'وكيل الرئيس التنفيذي', 'dep-exec', 'writing', 'draft', ['الملخصات التنفيذية', 'مذكرات القرار', 'مواءمة الأولويات'], ['استراتيجية', 'قيادة', 'تحليل']),
    ai('ai-layan', 'ليان', 'مديرة التسويق', 'dep-mkt', 'idle', 'draft', ['خطط الحملات', 'تقويم المحتوى', 'تقارير الأداء'], ['تسويق رقمي', 'محتوى', 'تحليلات']),
    ai('ai-waleed', 'وليد', 'المحلل المالي', 'dep-fin', 'waiting_approval', 'suggest', ['التقارير المالية', 'تحليل التكاليف', 'التوقعات'], ['مالية', 'Excel', 'نمذجة']),
    ai('ai-noor', 'نور', 'مديرة المنتج', 'dep-exec', 'idle', 'draft', ['كتابة المتطلبات', 'خارطة الطريق'], ['منتج', 'متطلبات']),
  ];
  const goals: Row[] = [
    { id: 'goal-1', title: 'الوصول إلى 100 عميل مشترك', description: '', metric: 'عدد العملاء', current_value: 62, target_value: 100, deadline: date(90), status: 'on_track', owner_member_id: 'mem-owner' },
    { id: 'goal-2', title: 'خفض تكلفة الاستحواذ 20%', description: '', metric: 'ر.س لكل عميل', current_value: 12, target_value: 20, deadline: date(120), status: 'at_risk', owner_member_id: 'mem-sara' },
  ];
  const missions: Row[] = [
    { id: 'mis-1', title: 'إطلاق الحملة التسويقية للربع الرابع', description: 'حملة متكاملة لزيادة العملاء المحتملين قبل نهاية العام.', objective: 'زيادة العملاء المحتملين 40%', status: 'active', priority: 'high', progress: 45, start_date: date(-20), due_date: date(40), mission_id: null, department_id: 'dep-mkt', owner_member_id: 'mem-owner', created_by: DEMO_USER_ID, goal_id: 'goal-1', ai_summary: null, ai_summary_at: null, milestones: [{ title: 'اعتماد الرسائل الرئيسية', done: true }, { title: 'إطلاق الإعلانات', done: false }], risks: [{ title: 'تأخر اعتماد الميزانية', severity: 'medium' }], department_ids: ['dep-mkt', 'dep-sales'], employees: [{ member_id: null, ai_employee_id: 'ai-layan' }] },
  ];
  const project = (id: string, title: string, status: string, progress: number, department_id: string, due: number): Row => ({ id, title, description: '', status, priority: 'medium', progress, start_date: date(-30), due_date: date(due), mission_id: 'mis-1', department_id, owner_member_id: 'mem-owner', created_by: DEMO_USER_ID, deleted_at: null, team: [{ member_id: 'mem-owner', ai_employee_id: null }, { member_id: null, ai_employee_id: 'ai-layan' }] });
  const projects = [
    project('prj-1', 'موقع الشركة الجديد', 'active', 60, 'dep-mkt', 25),
    project('prj-2', 'نظام التقارير المالية الشهرية', 'active', 35, 'dep-fin', 45),
    project('prj-3', 'برنامج ولاء العملاء', 'planned', 5, 'dep-sales', 80),
  ];
  const task = (id: string, title: string, status: string, priority: string, due: number, ai_id: string | null, member: string | null, project_id: string | null, description = ''): Row => ({
    id, title, description, status, priority, due_date: date(due), project_id, mission_id: null, parent_task_id: null, assignee_member_id: member, assignee_ai_employee_id: ai_id, creator_user_id: DEMO_USER_ID, creator_ai_employee_id: null, tags: [], requires_approval: false, created_at: days(-10), deleted_at: null, depends_on: [], comments: [],
  });
  const tasks = [
    task('tsk-1', 'إعداد عرض تقديمي لنتائج الربع الثالث', 'in_progress', 'high', 3, 'ai-atlas', null, null, 'عرض من 10 شرائح يلخص الإيرادات والعملاء والتوصيات.'),
    task('tsk-2', 'كتابة خطة محتوى شهر أكتوبر', 'todo', 'medium', 6, 'ai-layan', null, 'prj-1'),
    task('tsk-3', 'تحليل تكاليف التشغيل الشهرية', 'review', 'high', 2, 'ai-waleed', null, 'prj-2'),
    task('tsk-4', 'مراجعة عقد المورد الجديد', 'todo', 'urgent', 1, null, 'mem-sara', null),
    task('tsk-5', 'تصميم صفحة الأسعار', 'done', 'medium', -2, null, 'mem-fahad', 'prj-1'),
    task('tsk-6', 'متابعة 15 عميلًا محتملًا', 'in_progress', 'medium', 4, null, 'mem-fahad', 'prj-3'),
    task('tsk-7', 'إعداد متطلبات تطبيق الجوال', 'todo', 'low', 14, 'ai-noor', null, null),
  ];
  const meetings: Row[] = [
    { id: 'mtg-1', title: 'اجتماع الإدارة الأسبوعي', scheduled_at: days(1), duration_minutes: 45, agenda: '1. مؤشرات الأداء\n2. الحملة التسويقية\n3. الميزانية', notes: 'تمت مناقشة أداء المبيعات. الاتفاق على زيادة ميزانية الإعلانات 10%. فهد يتابع العملاء الكبار.', summary: null, decisions_extracted: [], action_items: [], project_id: null, mission_id: 'mis-1', status: 'scheduled', meeting_link: null, deleted_at: null },
    { id: 'mtg-2', title: 'مراجعة خطة التسويق', scheduled_at: days(-3), duration_minutes: 30, agenda: 'مراجعة القنوات', notes: 'الاتفاق على التركيز على لينكدإن وسناب شات.', summary: 'تم اعتماد التركيز على قناتين رئيسيتين مع قياس أسبوعي للنتائج.', decisions_extracted: [{ title: 'التركيز على لينكدإن وسناب شات', reasoning: 'أعلى عائد في الربع السابق' }], action_items: [{ title: 'إعداد تقويم محتوى للقناتين', owner_hint: 'ليان' }], project_id: 'prj-1', mission_id: null, status: 'completed', meeting_link: null, deleted_at: null },
  ];
  const documents: Row[] = [
    { id: 'doc-1', title: 'ملخص تنفيذي — سبتمبر', doc_type: 'report', content: '## الملخص\nنمت الإيرادات 18% مقارنة بالشهر السابق، وارتفع عدد العملاء إلى 62.\n\n## التوصيات\n- زيادة ميزانية التسويق الرقمي\n- إطلاق برنامج الولاء في الربع القادم', status: 'final', current_version: 2, created_by_ai_employee_id: 'ai-atlas', updated_at: days(-1), project_id: null, deleted_at: null },
    { id: 'doc-2', title: 'خطة الحملة التسويقية', doc_type: 'plan', content: '## الهدف\nزيادة العملاء المحتملين 40%.\n\n## القنوات\n- لينكدإن\n- سناب شات', status: 'draft', current_version: 1, created_by_ai_employee_id: 'ai-layan', updated_at: days(-2), project_id: 'prj-1', deleted_at: null },
  ];
  const decisions: Row[] = [
    { id: 'dec-1', title: 'التركيز على لينكدإن وسناب شات', context: 'مراجعة قنوات التسويق', chosen_option: 'قناتان رئيسيتان', reasoning: 'أعلى عائد في الربع السابق', impact: 'high', status: 'decided', created_at: days(-3) },
  ];
  const memories: Row[] = [
    { id: 'memo-1', memory_type: 'preference', title: 'أسلوب التقارير', content: 'المدير يفضل التقارير المختصرة بنقاط واضحة وأرقام.', pinned: true, tags: [], source: 'human', ai_employee_id: null, updated_at: days(-5) },
    { id: 'memo-2', memory_type: 'company', title: 'السنة المالية', content: 'تبدأ السنة المالية للشركة في يناير.', pinned: false, tags: [], source: 'ai', ai_employee_id: 'ai-waleed', updated_at: days(-8) },
  ];
  const file = (id: string, name: string, ext: string, category: string, size: number, space: string, folder_id: string | null, ai_id: string | null = null): Row => ({
    id, organization_id: DEMO_ORG_ID, space, visibility: space === 'private' ? 'private_owner' : space === 'ai_workspace' ? 'restricted' : 'organization_shared', owner_user_id: space === 'private' ? DEMO_USER_ID : null, uploaded_by_user_id: ai_id ? null : DEMO_USER_ID, uploaded_by_ai_employee_id: ai_id, folder_id, original_name: name, extension: ext, mime_type: 'application/octet-stream', category, size, status: 'ready', scan_status: 'clean', created_at: days(-Math.ceil(size % 9) - 1), updated_at: days(-1), deleted_at: null, uploader_name: ai_id ? null : 'عبدالله',
  });
  const folders: Row[] = [
    { id: 'fld-1', name: 'التسويق', parent_id: null, space: 'shared', created_by_user_id: DEMO_USER_ID, created_at: days(-30) },
    { id: 'fld-2', name: 'المالية', parent_id: null, space: 'shared', created_by_user_id: DEMO_USER_ID, created_at: days(-30) },
    { id: 'fld-3', name: 'ملفاتي الشخصية', parent_id: null, space: 'private', created_by_user_id: DEMO_USER_ID, created_at: days(-30) },
  ];
  const files = [
    file('fil-1', 'دليل الهوية البصرية.pdf', 'pdf', 'pdf', 4_200_000, 'shared', 'fld-1'),
    file('fil-2', 'الميزانية 2026.xlsx', 'xlsx', 'spreadsheet', 820_000, 'shared', 'fld-2'),
    file('fil-3', 'عرض المستثمرين.pptx', 'pptx', 'presentation', 6_100_000, 'shared', null),
    file('fil-4', 'سياسة الموارد البشرية.docx', 'docx', 'document', 310_000, 'shared', null),
    file('fil-5', 'شعار الشركة.png', 'png', 'image', 95_000, 'shared', 'fld-1'),
    file('fil-6', 'ملاحظات خاصة.txt', 'txt', 'text', 4_000, 'private', 'fld-3'),
    file('fil-7', 'عقد الشراكة (سري).pdf', 'pdf', 'pdf', 1_300_000, 'private', null),
  ];
  const approvals: Row[] = [
    { id: 'apr-1', title: 'اعتماد تقرير تحليل التكاليف', description: 'أنهى وليد تحليل تكاليف التشغيل ويطلب الاعتماد قبل مشاركته مع الإدارة.', approval_type: 'ai_output', status: 'pending', risk: 'low', payload: {}, session_id: 'ses-2', task_id: 'tsk-3', created_at: minutes(-90), decided_at: null, decision_comment: null, ai_employees: { name: 'وليد', job_title: 'المحلل المالي' }, comments: [], output: { title: 'تحليل تكاليف التشغيل — سبتمبر', content: '## أبرز النتائج\n- تكاليف الاستضافة ارتفعت 12%\n- يمكن توفير 8,000 ر.س شهريًا بإعادة التفاوض مع المورد\n\n## التوصية\nإعادة التفاوض على عقد الاستضافة قبل نهاية الربع.' } },
    { id: 'apr-2', title: 'إرسال بريد متابعة لعميل خارجي', description: 'ليان تطلب إرسال بريد متابعة بعد الاجتماع إلى عميل خارجي.', approval_type: 'email_send', status: 'pending', risk: 'medium', payload: {}, session_id: null, task_id: null, created_at: minutes(-30), decided_at: null, decision_comment: null, ai_employees: { name: 'ليان', job_title: 'مديرة التسويق' }, comments: [], output: null },
  ];
  const sessions: Row[] = [
    { id: 'ses-1', ai_employee_id: 'ai-atlas', task_id: 'tsk-1', status: 'running', current_step: 'يجمع أرقام الإيرادات من ملفات المالية', provider: 'anthropic', model: 'claude-sonnet-5', started_at: minutes(-6), completed_at: null, queued_at: minutes(-7), created_at: minutes(-7), input_tokens: 18_400, output_tokens: 2_100, estimated_cost_usd: 0.06, delegation_depth: 0, error: null, outputs: [], tasks: { title: 'إعداد عرض تقديمي لنتائج الربع الثالث' } },
    { id: 'ses-2', ai_employee_id: 'ai-waleed', task_id: 'tsk-3', status: 'waiting_approval', current_step: 'بانتظار اعتماد المدير', provider: 'anthropic', model: 'claude-sonnet-5', started_at: minutes(-120), completed_at: null, queued_at: minutes(-121), created_at: minutes(-121), input_tokens: 41_000, output_tokens: 6_300, estimated_cost_usd: 0.15, delegation_depth: 0, error: null, outputs: [], tasks: { title: 'تحليل تكاليف التشغيل الشهرية' } },
    { id: 'ses-3', ai_employee_id: 'ai-layan', task_id: 'tsk-2', status: 'completed', current_step: 'اكتملت المهمة', provider: 'anthropic', model: 'claude-sonnet-5', started_at: days(-2), completed_at: days(-2), queued_at: days(-2), created_at: days(-2), input_tokens: 22_000, output_tokens: 4_800, estimated_cost_usd: 0.09, delegation_depth: 0, error: null, outputs: [], tasks: { title: 'خطة الحملة التسويقية' } },
  ];
  const outputs: Row[] = [
    { id: 'out-1', title: 'خطة الحملة التسويقية', status: 'approved', ai_employee_id: 'ai-layan', document_id: 'doc-2', content: 'خطة الحملة', created_at: days(-2), ai_employees: { name: 'ليان' } },
    { id: 'out-2', title: 'ملخص تنفيذي — سبتمبر', status: 'approved', ai_employee_id: 'ai-atlas', document_id: 'doc-1', content: 'ملخص', created_at: days(-1), ai_employees: { name: 'أطلس' } },
  ];
  const notifications: Row[] = [
    { id: 'ntf-1', title: 'طلب اعتماد جديد', body: 'وليد يطلب اعتماد تقرير تحليل التكاليف', link: '/app/approvals', type: 'approval_requested', read_at: null, created_at: minutes(-90) },
    { id: 'ntf-2', title: 'اكتملت مهمة', body: 'ليان أنهت خطة الحملة التسويقية', link: '/app/tasks', type: 'ai_completed', read_at: null, created_at: days(-2) },
    { id: 'ntf-3', title: 'مرحبًا بك في NEXUS', body: 'هذه نسخة تجريبية على جهازك', link: null, type: 'info', read_at: days(-3), created_at: days(-3) },
  ];
  const activity: Row[] = [
    { id: 1, verb: 'started', entity_type: 'ai_session', summary: 'أطلس بدأ العمل على عرض نتائج الربع الثالث', created_at: minutes(-6), actor_ai_employee_id: 'ai-atlas' },
    { id: 2, verb: 'requested_approval', entity_type: 'approval', summary: 'وليد طلب اعتماد تقرير التكاليف', created_at: minutes(-90), actor_ai_employee_id: 'ai-waleed' },
    { id: 3, verb: 'completed', entity_type: 'task', summary: 'فهد أنهى تصميم صفحة الأسعار', created_at: days(-2), actor_ai_employee_id: null },
    { id: 4, verb: 'completed', entity_type: 'ai_session', summary: 'ليان أنهت خطة الحملة التسويقية', created_at: days(-2), actor_ai_employee_id: 'ai-layan' },
  ] as unknown as Row[];
  const deck: DeckSpec = {
    title: 'نتائج الربع الثالث 2026',
    language: 'ar',
    slides: [
      { kind: 'cover', title: 'نتائج الربع الثالث 2026', subtitle: 'شركة الأفق للتقنية', presenter: 'أطلس — وكيل الرئيس التنفيذي' },
      { kind: 'agenda', title: 'المحتويات', items: ['أبرز الأرقام', 'الإيرادات', 'الخطة القادمة'] },
      { kind: 'kpis', title: 'أبرز الأرقام', metrics: [{ label: 'الإيرادات', value: '1.2M ر.س', detail: '+18% عن الربع السابق' }, { label: 'العملاء', value: '62', detail: '+14 عميلًا' }, { label: 'رضا العملاء', value: '94%', detail: 'استبيان سبتمبر' }] },
      { kind: 'chart', title: 'الإيرادات الشهرية (ألف ر.س)', chart_type: 'bar', categories: ['يوليو', 'أغسطس', 'سبتمبر'], series: [{ name: 'الإيرادات', values: [340, 390, 470] }], caption: 'نمو مستمر خلال الربع' },
      { kind: 'bullets', role: 'recommendations', title: 'التوصيات', points: ['زيادة ميزانية التسويق الرقمي 10%', 'إطلاق برنامج الولاء', 'توظيف موظف ذكاء اصطناعي لخدمة العملاء'], note: '' },
      { kind: 'closing', title: 'شكرًا', subtitle: 'أسئلة ونقاش', contact: '' },
    ],
  };
  const presentations: Row[] = [
    { id: 'pre-1', title: deck.title, status: 'pending_approval', language: 'ar', current_version: 1, ai_employee_id: 'ai-atlas', project_id: null, meeting_id: 'mtg-1', updated_at: minutes(-20), created_at: minutes(-25), published_file_id: null, ai_employees: { name: 'أطلس' }, deleted_at: null,
      versions: [{ id: 'pv-1', version: 1, label: 'v1', slide_count: deck.slides.length, change_summary: 'النسخة الأولى', created_at: minutes(-20), created_by_user_id: null, created_by_ai_employee_id: 'ai-atlas', spec: deck }],
      approvals: [] },
  ];
  const mail: Row[] = [
    { id: 'mail-1', ai_employee_id: 'ai-layan', direction: 'outbound', folder: 'drafts', status: 'pending_approval', from_address: 'layan@agents.example.com', to_addresses: ['client@example.org'], subject: 'متابعة اجتماع اليوم', body_text: 'مرحبًا،\nشكرًا على وقتكم اليوم. نرفق لكم ملخص ما تم الاتفاق عليه.\n\n— ليان (موظفة ذكاء اصطناعي في شركة الأفق للتقنية)', is_external: true, risk: 'medium', failure_reason: null, task_id: null, created_at: minutes(-30), sent_at: null },
    { id: 'mail-2', ai_employee_id: 'ai-layan', direction: 'outbound', folder: 'sent', status: 'sent', from_address: 'layan@agents.example.com', to_addresses: ['sara@example.com'], subject: 'تقويم المحتوى لشهر أكتوبر', body_text: 'مرفق تقويم المحتوى المقترح.', is_external: false, risk: 'low', failure_reason: null, task_id: 'tsk-2', created_at: days(-1), sent_at: days(-1) },
  ];
  const calendar_events: Row[] = [
    { id: 'evt-1', title: 'اجتماع الإدارة الأسبوعي', event_type: 'meeting', starts_at: days(1), ends_at: new Date(now + 86_400_000 + 45 * 60_000).toISOString(), meeting_id: 'mtg-1', location: 'قاعة الاجتماعات', ai_employee_id: 'ai-atlas' },
    { id: 'evt-2', title: 'عرض نتائج الربع للإدارة', event_type: 'meeting', starts_at: days(3), ends_at: new Date(now + 3 * 86_400_000 + 60 * 60_000).toISOString(), meeting_id: null, location: null, ai_employee_id: 'ai-atlas' },
  ];
  const conversations: Row[] = [];
  const messages: Record<string, Row[]> = {};
  const invitations: Row[] = [{ id: 'inv-1', email: 'new.hire@example.com', role: 'member', expires_at: days(5), accepted_at: null, revoked_at: null }];
  const audit: Row[] = [
    { id: 1, action: 'ai_employee.created', actor_type: 'human', target_type: 'ai_employee', created_at: days(-45), metadata: {} },
    { id: 2, action: 'file.uploaded', actor_type: 'human', target_type: 'file', created_at: days(-10), metadata: {} },
    { id: 3, action: 'approval.requested', actor_type: 'ai', target_type: 'approval', created_at: minutes(-90), metadata: {} },
  ] as unknown as Row[];
  return { departments, members, ai_employees, goals, missions, projects, tasks, meetings, documents, decisions, memories, folders, files, approvals, sessions, outputs, notifications, activity, presentations, mail, calendar_events, conversations, messages, invitations, audit, templates: DEMO_TEMPLATES as unknown as Row[] };
}

export const db = seed();
export type DemoDb = typeof db;
export const isoNow = () => new Date().toISOString();
export const dayOffset = days;
