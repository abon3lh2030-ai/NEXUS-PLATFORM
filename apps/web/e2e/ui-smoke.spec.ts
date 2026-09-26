import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:9';

const plans = [
  { code: 'starter', name_ar: 'المبتدئة', name_en: 'Starter', price_halalas: 99900, currency: 'SAR', billing_interval: 'yearly', is_popular: false, is_custom: false, sort_order: 1, entitlements: { human_members: 1, ai_employees: 3, ai_executions_per_year: 300, active_projects: 5, storage_bytes: 5368709120, max_file_size_bytes: 26214400, concurrent_ai_sessions: 1, computer_minutes_per_year: 600, features: ['basic_memory', 'basic_analytics'] } },
  { code: 'pro', name_ar: 'الاحترافية', name_en: 'Pro', price_halalas: 199900, currency: 'SAR', billing_interval: 'yearly', is_popular: true, is_custom: false, sort_order: 2, entitlements: { human_members: 5, ai_employees: 10, ai_executions_per_year: 1500, active_projects: null, storage_bytes: 26843545600, max_file_size_bytes: 52428800, concurrent_ai_sessions: 3, computer_minutes_per_year: 3000, features: ['full_memory', 'knowledge', 'decisions', 'meetings', 'approvals', 'agent_orchestration', 'advanced_analytics'] } },
  { code: 'business', name_ar: 'الأعمال', name_en: 'Business', price_halalas: 299900, currency: 'SAR', billing_interval: 'yearly', is_popular: false, is_custom: false, sort_order: 3, entitlements: { human_members: 15, ai_employees: 30, ai_executions_per_year: 5000, active_projects: null, storage_bytes: 107374182400, max_file_size_bytes: 104857600, concurrent_ai_sessions: 8, computer_minutes_per_year: 12000, features: ['full_memory', 'audit_logs'] } },
  { code: 'enterprise', name_ar: 'المؤسسات', name_en: 'Enterprise', price_halalas: null, currency: 'SAR', billing_interval: 'yearly', is_popular: false, is_custom: true, sort_order: 4, entitlements: { human_members: null, ai_employees: null, ai_executions_per_year: null, active_projects: null, storage_bytes: null, max_file_size_bytes: 262144000, concurrent_ai_sessions: 20, computer_minutes_per_year: null, features: [] } },
];

async function mockApi(page: Page) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/plans') return route.fulfill({ json: plans, headers: cors });
    if (url.pathname === '/public/enterprise-requests') return route.fulfill({ json: { id: 'x' }, headers: cors });
    return route.fulfill({ status: 401, json: { error: 'unauthorized' }, headers: cors });
  });
  // No real Supabase in the smoke suite.
  await page.route('http://127.0.0.1:54321/**', (route) => route.fulfill({ status: 400, json: {} }));
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('landing is Arabic RTL by default', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('شغّل شركتك');
});

test('language toggle switches to English LTR and persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'اللغة' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Run your company');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('pricing shows annual SAR plans from the API with the popular badge', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByText('الأكثر شعبية')).toBeVisible();
  const body = page.locator('main');
  await expect(body).toContainText('999');
  await expect(body).toContainText('1,999');
  await expect(body).toContainText('2,999');
  await expect(page.getByRole('link', { name: 'طلب باقة مخصصة' }).first()).toBeVisible();
});

test('enterprise form validates Saudi CR and the Saudi confirmation', async ({ page }) => {
  await page.goto('/enterprise');
  await page.getByRole('button', { name: 'طلب باقة مخصصة' }).click();
  await expect(page.getByText('يجب تأكيد أن المنشأة مسجلة في المملكة العربية السعودية')).toBeVisible();
  await page.getByLabel('رقم السجل التجاري').fill('123');
  await page.getByRole('button', { name: 'طلب باقة مخصصة' }).click();
  await expect(page.getByText('رقم السجل التجاري السعودي يتكون من 10 أرقام')).toBeVisible();
});

test('protected app routes redirect to login', async ({ page }) => {
  await page.goto('/app/files');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Ffiles/);
  await expect(page.getByRole('heading', { name: 'مرحبًا بعودتك' })).toBeVisible();
});

test('admin area also requires login', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
});

test('unknown routes show 404', async ({ page }) => {
  await page.goto('/does-not-exist');
  await expect(page.getByText('404')).toBeVisible();
});

test('dark theme can be selected', async ({ page, isMobile }) => {
  test.skip(isMobile, 'covered on desktop');
  await page.goto('/');
  await page.getByRole('button', { name: 'المظهر' }).click();
  await page.getByRole('menuitem', { name: 'داكن' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('footer shows CR, email, phone and WhatsApp; floating WhatsApp opens a support chat', async ({ page }) => {
  await page.goto('/');
  const contact = page.getByTestId('footer-contact');
  await expect(contact).toContainText('7055047331');
  await expect(contact).toContainText('abdullahfah2030@hotmail.com');
  await expect(contact).toContainText('+966 54 416 0181');
  await expect(contact.getByRole('link', { name: /واتساب/ })).toHaveAttribute('href', /^https:\/\/wa\.me\/966544160181\?text=/);
  const fab = page.getByRole('link', { name: 'تواصل مع الدعم عبر واتساب' });
  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute('href', /^https:\/\/wa\.me\/966544160181/);
  await expect(fab).toHaveAttribute('target', '_blank');
  const box = await fab.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box!.x).toBeLessThan(vw / 2); // bottom-LEFT corner, even in RTL
});
