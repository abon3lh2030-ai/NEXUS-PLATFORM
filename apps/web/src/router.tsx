import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { FullPageLoader, RequireAuth, RequireOrg, RequirePaid, RequireSuperAdmin } from './components/guards';
import { LoadingBlock } from './components/common';
import { AppLayout } from './layouts/app-layout';
import { PublicLayout } from './layouts/public-layout';
import {
  AcceptInvitePage,
  AuthCallbackPage,
  ForgotPasswordPage,
  LoginPage,
  OnboardingPage,
  ResetPasswordPage,
  SignupPage,
} from './pages/auth/auth-pages';
import { ContactPage, EnterprisePage } from './pages/public/forms';
import { LandingPage } from './pages/public/landing';
import { AiWorkforcePublicPage, FeaturesPage, LegalPage, NotFoundPage, PlatformPage, PricingPage } from './pages/public/marketing';

// App & admin areas are code-split so the public site stays light.
const m = <T extends Record<string, unknown>, K extends keyof T>(loader: () => Promise<T>, name: K) =>
  lazy(async () => ({ default: (await loader())[name] as React.ComponentType }));

const Dashboard = m(() => import('./pages/app/dashboard'), 'DashboardPage');
const Files = m(() => import('./features/files/files-page'), 'FilesPage');
const Workforce = m(() => import('./features/ai/workforce-page'), 'WorkforcePage');
const Employee = m(() => import('./features/ai/employee-page'), 'EmployeePage');
const Operations = m(() => import('./features/ai/operations-page'), 'OperationsPage');
const Approvals = m(() => import('./features/ai/approvals-page'), 'ApprovalsPage');
const Nexus = m(() => import('./features/ai/nexus-page'), 'NexusPage');
const Tasks = m(() => import('./features/work/tasks'), 'TasksPage');
const Task = m(() => import('./features/work/tasks'), 'TaskPage');
const Projects = m(() => import('./features/work/planning'), 'ProjectsPage');
const Project = m(() => import('./features/work/planning'), 'ProjectPage');
const Missions = m(() => import('./features/work/planning'), 'MissionsPage');
const Mission = m(() => import('./features/work/planning'), 'MissionPage');
const Goals = m(() => import('./features/work/planning'), 'GoalsPage');
const Departments = m(() => import('./features/work/planning'), 'DepartmentsPage');
const Meetings = m(() => import('./features/work/knowledge'), 'MeetingsPage');
const Meeting = m(() => import('./features/work/knowledge'), 'MeetingPage');
const Documents = m(() => import('./features/work/knowledge'), 'DocumentsPage');
const Document = m(() => import('./features/work/knowledge'), 'DocumentPage');
const Decisions = m(() => import('./features/work/knowledge'), 'DecisionsPage');
const Memory = m(() => import('./features/work/knowledge'), 'MemoryPage');
const Knowledge = m(() => import('./features/work/knowledge'), 'KnowledgePage');
const Analytics = m(() => import('./features/insights/insights'), 'AnalyticsPage');
const OrgGraph = m(() => import('./features/insights/insights'), 'OrgGraphPage');
const Notifications = m(() => import('./features/insights/insights'), 'NotificationsPage');
const SettingsLayout = m(() => import('./features/settings/settings-pages'), 'SettingsLayout');
const ProfileSettings = m(() => import('./features/settings/settings-pages'), 'ProfileSettings');
const OrganizationSettings = m(() => import('./features/settings/settings-pages'), 'OrganizationSettings');
const MembersSettings = m(() => import('./features/settings/settings-pages'), 'MembersSettings');
const PermissionsSettings = m(() => import('./features/settings/settings-pages'), 'PermissionsSettings');
const AuditSettings = m(() => import('./features/settings/settings-pages'), 'AuditSettings');
const Billing = m(() => import('./features/settings/billing'), 'BillingPage');
const BillingCallback = m(() => import('./features/settings/billing'), 'BillingCallbackPage');
const EnterpriseOffer = m(() => import('./features/settings/billing'), 'EnterpriseOfferPage');
const AdminLayout = m(() => import('./pages/admin/admin'), 'AdminLayout');
const AdminDashboard = m(() => import('./pages/admin/admin'), 'AdminDashboard');
const AdminApplications = m(() => import('./pages/admin/admin'), 'AdminApplications');
const AdminApplication = m(() => import('./pages/admin/admin'), 'AdminApplication');
const AdminEnterpriseList = m(() => import('./pages/admin/admin'), 'AdminEnterpriseList');
const AdminEnterpriseDetail = m(() => import('./pages/admin/admin'), 'AdminEnterpriseDetail');
const AdminOrganizations = m(() => import('./pages/admin/admin'), 'AdminOrganizations');
const AdminPayments = m(() => import('./pages/admin/admin'), 'AdminPayments');

const s = (el: ReactNode) => <Suspense fallback={<LoadingBlock />}>{el}</Suspense>;
/** Paid feature pages: server enforces the same (HTTP 402); this shows a clear paywall. */
const p = (el: ReactNode) => s(<RequirePaid>{el}</RequirePaid>);

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/platform', element: <PlatformPage /> },
      { path: '/ai-workforce', element: <AiWorkforcePublicPage /> },
      { path: '/features', element: <FeaturesPage /> },
      { path: '/pricing', element: <PricingPage /> },
      { path: '/enterprise', element: <EnterprisePage /> },
      { path: '/contact', element: <ContactPage /> },
      { path: '/privacy', element: <LegalPage kind="privacy" /> },
      { path: '/terms', element: <LegalPage kind="terms" /> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <RequireAuth><ResetPasswordPage /></RequireAuth> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/invite/:token', element: <AcceptInvitePage /> },
  { path: '/onboarding', element: <RequireAuth><OnboardingPage /></RequireAuth> },
  {
    path: '/app',
    element: <RequireAuth><RequireOrg><AppLayout /></RequireOrg></RequireAuth>,
    children: [
      { index: true, element: p(<Dashboard />) },
      { path: 'nexus', element: p(<Nexus />) },
      { path: 'notifications', element: s(<Notifications />) },
      { path: 'workforce', element: p(<Workforce />) },
      { path: 'workforce/:id', element: p(<Employee />) },
      { path: 'operations', element: p(<Operations />) },
      { path: 'approvals', element: p(<Approvals />) },
      { path: 'org-graph', element: p(<OrgGraph />) },
      { path: 'departments', element: p(<Departments />) },
      { path: 'files', element: p(<Files />) },
      { path: 'goals', element: p(<Goals />) },
      { path: 'missions', element: p(<Missions />) },
      { path: 'missions/:id', element: p(<Mission />) },
      { path: 'projects', element: p(<Projects />) },
      { path: 'projects/:id', element: p(<Project />) },
      { path: 'tasks', element: p(<Tasks />) },
      { path: 'tasks/:id', element: p(<Task />) },
      { path: 'meetings', element: p(<Meetings />) },
      { path: 'meetings/:id', element: p(<Meeting />) },
      { path: 'documents', element: p(<Documents />) },
      { path: 'documents/:id', element: p(<Document />) },
      { path: 'decisions', element: p(<Decisions />) },
      { path: 'memory', element: p(<Memory />) },
      { path: 'knowledge', element: p(<Knowledge />) },
      { path: 'analytics', element: p(<Analytics />) },
      { path: 'billing/callback', element: s(<BillingCallback />) },
      { path: 'billing/offers/:id', element: s(<EnterpriseOffer />) },
      {
        path: 'settings',
        element: s(<SettingsLayout />),
        children: [
          { index: true, element: s(<ProfileSettings />) },
          { path: 'organization', element: s(<OrganizationSettings />) },
          { path: 'members', element: s(<MembersSettings />) },
          { path: 'billing', element: s(<Billing />) },
          { path: 'permissions', element: p(<PermissionsSettings />) },
          { path: 'audit', element: p(<AuditSettings />) },
        ],
      },
    ],
  },
  {
    path: '/admin',
    element: <RequireAuth><RequireSuperAdmin><Suspense fallback={<FullPageLoader />}><AdminLayout /></Suspense></RequireSuperAdmin></RequireAuth>,
    children: [
      { index: true, element: s(<AdminDashboard />) },
      { path: 'applications', element: s(<AdminApplications />) },
      { path: 'applications/:id', element: s(<AdminApplication />) },
      { path: 'enterprise', element: s(<AdminEnterpriseList />) },
      { path: 'enterprise/:id', element: s(<AdminEnterpriseDetail />) },
      { path: 'organizations', element: s(<AdminOrganizations />) },
      { path: 'payments', element: s(<AdminPayments />) },
    ],
  },
  { path: '/app/*', element: <Navigate to="/app" replace /> },
  { element: <PublicLayout />, children: [{ path: '*', element: <NotFoundPage /> }] },
]);
