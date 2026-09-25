import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Brain,
  CalendarDays,
  CheckCircle2,
  FileText,
  Flag,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  Library,
  ListChecks,
  Network,
  Scale,
  Settings,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@nexus/shared';

export interface NavItem {
  to: string;
  key: string;
  icon: LucideIcon;
  permission?: Permission;
}

export interface NavGroup {
  key: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    key: 'overview',
    items: [
      { to: '/app', key: 'dashboard', icon: LayoutDashboard },
      { to: '/app/nexus', key: 'nexusAi', icon: Sparkles, permission: 'nexus_ai.use' },
      { to: '/app/notifications', key: 'notifications', icon: Bell },
    ],
  },
  {
    key: 'aiWorkforce',
    items: [
      { to: '/app/workforce', key: 'workforce', icon: Bot, permission: 'ai.view' },
      { to: '/app/operations', key: 'operations', icon: Activity, permission: 'ai.view' },
      { to: '/app/approvals', key: 'approvals', icon: CheckCircle2 },
    ],
  },
  {
    key: 'company',
    items: [
      { to: '/app/org-graph', key: 'orgGraph', icon: Network },
      { to: '/app/departments', key: 'departments', icon: Users },
      { to: '/app/files', key: 'companyFiles', icon: FolderOpen, permission: 'files.shared.view' },
    ],
  },
  {
    key: 'work',
    items: [
      { to: '/app/goals', key: 'goals', icon: Target },
      { to: '/app/missions', key: 'missions', icon: Flag },
      { to: '/app/projects', key: 'projects', icon: FolderKanban },
      { to: '/app/tasks', key: 'tasks', icon: ListChecks },
      { to: '/app/meetings', key: 'meetings', icon: CalendarDays },
    ],
  },
  {
    key: 'knowledge',
    items: [
      { to: '/app/documents', key: 'documents', icon: FileText },
      { to: '/app/decisions', key: 'decisions', icon: Scale },
      { to: '/app/memory', key: 'memory', icon: Brain },
      { to: '/app/knowledge', key: 'knowledgeCenter', icon: Library },
    ],
  },
  {
    key: 'insights',
    items: [
      { to: '/app/analytics', key: 'analytics', icon: BarChart3, permission: 'analytics.view' },
      { to: '/app/settings', key: 'settings', icon: Settings },
    ],
  },
];
