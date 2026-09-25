import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Entitlements, HumanRole, Permission } from '@nexus/shared';
import { api } from '@/lib/api';
import { orgStore } from '@/lib/org-store';
import { supabase } from '@/lib/supabase';

export interface MeResponse {
  user_id: string;
  email: string | null;
  is_super_admin: boolean;
  profile: { full_name: string; locale: 'ar' | 'en'; theme: string; avatar_url: string | null } | null;
  organizations: Array<{ id: string; name: string; status: string; verification_status: string; role: HumanRole }>;
}

export interface OrgInfo {
  organization: { id: string; name: string; commercial_registration: string; company_email: string | null; company_phone: string | null; logo_updated_at: string | null; website: string | null; industry: string | null; company_size: string | null; status: string; verification_status: string; owner_user_id: string; default_locale: 'ar' | 'en'; created_at: string };
  membership: { role: HumanRole; member_id: string; permissions: Permission[] };
  billing: { active: boolean; plan_code: string | null; ends_at: string | null; entitlements: Entitlements };
  ai: { provider: string; is_mock: boolean; computer_provider: string; computer_capabilities: { files: boolean; documents: boolean; browser: boolean; terminal: boolean } };
}

interface SessionCtx {
  session: Session | null;
  loading: boolean;
  me: MeResponse | undefined;
  meLoading: boolean;
  orgId: string | null;
  org: OrgInfo | undefined;
  orgLoading: boolean;
  setOrg: (id: string | null) => void;
  can: (p: Permission) => boolean;
  hasFeature: (f: string) => boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const orgId = useSyncExternalStore(orgStore.subscribe, orgStore.get);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) qc.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/me', { org: false }), enabled: Boolean(session) });

  // Auto-select an organization (keep the stored one if still valid).
  useEffect(() => {
    const orgs = meQuery.data?.organizations;
    if (!orgs) return;
    if (orgs.length === 0) orgStore.set(null);
    else if (!orgId || !orgs.some((o) => o.id === orgId)) orgStore.set(orgs[0]!.id);
  }, [meQuery.data, orgId]);

  const orgQuery = useQuery({ queryKey: ['org', orgId], queryFn: () => api<OrgInfo>('/org'), enabled: Boolean(session && orgId && meQuery.data?.organizations.some((o) => o.id === orgId)) });

  const value = useMemo<SessionCtx>(() => {
    const perms = new Set(orgQuery.data?.membership.permissions ?? []);
    return {
      session,
      loading,
      me: meQuery.data,
      meLoading: meQuery.isLoading,
      orgId,
      org: orgQuery.data,
      orgLoading: orgQuery.isLoading,
      setOrg: (id) => {
        orgStore.set(id);
        void qc.invalidateQueries();
      },
      can: (p) => perms.has(p),
      hasFeature: (f) => Boolean(orgQuery.data?.billing.active && orgQuery.data.billing.entitlements.features.includes(f as never)),
      signOut: async () => {
        await supabase.auth.signOut();
        orgStore.set(null);
        qc.clear();
      },
    };
  }, [session, loading, meQuery.data, meQuery.isLoading, orgId, orgQuery.data, orgQuery.isLoading, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
