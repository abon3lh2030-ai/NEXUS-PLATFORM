import type { EmailMessage } from './provider.js';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Button {
  label: string;
  url: string;
  tone?: 'primary' | 'danger';
}

function layout(title: string, bodyHtml: string, buttons: Button[] = []): string {
  const btns = buttons
    .map(
      (b) =>
        `<a href="${escapeHtml(b.url)}" style="display:inline-block;margin:6px 4px;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;color:#fff;background:${b.tone === 'danger' ? '#b42318' : '#4338ca'}">${escapeHtml(b.label)}</a>`,
    )
    .join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:Tahoma,Arial,sans-serif;color:#111827">
<div style="max-width:640px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
<div style="background:#0b1020;color:#fff;padding:20px 28px;font-size:20px;font-weight:700;letter-spacing:2px">NEXUS</div>
<div style="padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${bodyHtml}
${btns ? `<div style="margin-top:24px">${btns}</div>` : ''}
</div>
<div style="padding:16px 28px;font-size:12px;color:#6b7280;border-top:1px solid #f0f0f0">منصة NEXUS — منصة تشغيل وإدارة الشركات بالذكاء الاصطناعي</div>
</div></body></html>`;
}

function table(rows: Array<[string, unknown]>): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px;border-bottom:1px solid #f0f0f0;color:#6b7280;width:40%">${escapeHtml(k)}</td><td style="padding:8px;border-bottom:1px solid #f0f0f0">${escapeHtml(v)}</td></tr>`,
    )
    .join('')}</table>`;
}

function text(rows: Array<[string, unknown]>): string {
  return rows.map(([k, v]) => `${k}: ${String(v ?? '')}`).join('\n');
}

export function companyApplicationEmail(to: string, a: Record<string, unknown>, reviewUrl: string): EmailMessage {
  const rows: Array<[string, unknown]> = [
    ['اسم المنشأة', a.company_name],
    ['رقم السجل التجاري', a.commercial_registration],
    ['البريد الرسمي للمنشأة', a.company_email],
    ['رقم تواصل المنشأة', a.company_phone],
    ['الموقع', a.website ?? '—'],
    ['مقدم الطلب (الحساب)', `${String(a.applicant_name ?? '')} <${String(a.applicant_account_email ?? '')}>`],
    ['منصب مقدم الطلب', a.applicant_role],
    ['القطاع', a.industry],
    ['حجم الشركة', a.company_size],
    ['ملاحظة', a.note || '—'],
  ];
  return {
    to,
    template: 'company_application_admin',
    subject: `طلب تسجيل شركة جديد — ${String(a.company_name)}`,
    html: layout('طلب تسجيل شركة جديد', table(rows), [{ label: 'مراجعة الطلب', url: reviewUrl }]),
    text: `طلب تسجيل شركة جديد\n\n${text(rows)}\n\nمراجعة: ${reviewUrl}`,
  };
}

export function enterpriseRequestEmail(to: string, r: Record<string, unknown>, reviewUrl: string): EmailMessage {
  const rows: Array<[string, unknown]> = [
    ['اسم الشركة', r.company_name],
    ['رقم السجل التجاري', r.commercial_registration],
    ['الموقع', r.website ?? '—'],
    ['جهة الاتصال', r.contact_name],
    ['البريد', r.work_email],
    ['حجم الشركة', r.company_size],
    ['القطاع', r.industry],
    ['الموظفون البشريون المتوقعون', r.expected_human_members],
    ['موظفو الذكاء الاصطناعي المتوقعون', r.expected_ai_employees],
    ['استخدام الذكاء الاصطناعي المتوقع', r.expected_ai_usage],
    ['استخدام الأجهزة الافتراضية المتوقع', r.expected_computer_usage],
    ['التخزين المتوقع', r.expected_storage],
    ['المتطلبات', r.requirements],
    ['ملاحظة العميل', r.customer_note || '—'],
  ];
  // Buttons only OPEN the secure admin page; they never execute a decision (login + super_admin required).
  return {
    to,
    template: 'enterprise_request_admin',
    subject: `طلب باقة مؤسسات جديد — ${String(r.company_name)}`,
    html: layout('طلب باقة مخصصة جديد', table(rows), [
      { label: 'مراجعة / موافقة', url: `${reviewUrl}?intent=approve` },
      { label: 'رفض', url: `${reviewUrl}?intent=reject`, tone: 'danger' },
    ]),
    text: `طلب باقة مخصصة جديد\n\n${text(rows)}\n\nمراجعة: ${reviewUrl}`,
  };
}

export function enterpriseApprovedEmail(to: string, priceSar: number, offerUrl: string): EmailMessage {
  const price = new Intl.NumberFormat('ar-SA').format(priceSar);
  return {
    to,
    template: 'enterprise_approved_customer',
    subject: 'تمت الموافقة على طلب الباقة المخصصة — NEXUS',
    html: layout(
      'تمت الموافقة على طلب الباقة المخصصة.',
      `<p style="font-size:16px">السعر السنوي المخصص: <strong>${escapeHtml(price)} ر.س</strong></p>`,
      [{ label: 'عرض العرض والدفع', url: offerUrl }],
    ),
    text: `تمت الموافقة على طلب الباقة المخصصة.\nالسعر السنوي المخصص: ${price} ر.س\nعرض العرض والدفع: ${offerUrl}`,
  };
}

export function enterpriseRejectedEmail(to: string, note: string): EmailMessage {
  return {
    to,
    template: 'enterprise_rejected_customer',
    subject: 'بخصوص طلب الباقة المخصصة — NEXUS',
    html: layout('نعتذر، لم تتم الموافقة على طلب الباقة المخصصة حاليًا.', note ? `<p>${escapeHtml(note)}</p>` : ''),
    text: `نعتذر، لم تتم الموافقة على طلب الباقة المخصصة حاليًا.\n${note}`,
  };
}

export function companyClosedEmail(to: string, o: { name: string; cr: string; closedBy: string; reason: string; closedAt: string }): EmailMessage {
  const rows: Array<[string, unknown]> = [
    ['الشركة', o.name],
    ['السجل التجاري', o.cr],
    ['أُغلقت بواسطة', o.closedBy],
    ['السبب', o.reason],
    ['وقت الإغلاق', o.closedAt],
  ];
  return {
    to,
    template: 'company_closed_admin',
    subject: `إغلاق شركة — ${o.name}`,
    html: layout('تم إغلاق شركة على المنصة', table(rows)),
    text: `تم إغلاق شركة\n\n${text(rows)}`,
  };
}

export function invitationEmail(to: string, orgName: string, role: string, url: string): EmailMessage {
  return {
    to,
    template: 'member_invitation',
    subject: `دعوة للانضمام إلى ${orgName} على NEXUS`,
    html: layout(`تمت دعوتك للانضمام إلى ${orgName}`, `<p>الدور: ${escapeHtml(role)}</p>`, [{ label: 'قبول الدعوة', url }]),
    text: `تمت دعوتك للانضمام إلى ${orgName} (${role}).\n${url}`,
  };
}

export function subscriptionNoticeEmail(to: string, kind: 'expiring' | 'expired', orgName: string, endsAt: string, url: string): EmailMessage {
  const title = kind === 'expiring' ? `اشتراك ${orgName} على وشك الانتهاء` : `انتهى اشتراك ${orgName}`;
  const body =
    kind === 'expiring'
      ? `<p>ينتهي الاشتراك السنوي بتاريخ ${escapeHtml(endsAt)}. جدّد الآن دون خسارة الأيام المتبقية.</p>`
      : `<p>انتهى الاشتراك بتاريخ ${escapeHtml(endsAt)} وتم إيقاف الوصول المدفوع. بياناتك محفوظة ولم يُحذف شيء.</p>`;
  return {
    to,
    template: `subscription_${kind}`,
    subject: title,
    html: layout(title, body, [{ label: 'تجديد الاشتراك', url }]),
    text: `${title}\n${url}`,
  };
}
