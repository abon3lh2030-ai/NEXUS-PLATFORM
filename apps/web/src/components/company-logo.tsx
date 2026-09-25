import { Avatar, cn } from '@nexus/ui';
import { LOGO_MAX_BYTES } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';
import { apiBlobUrl, ApiError } from '@/lib/api';
import { useSession } from '@/providers/session';

/** Shows the organization's PNG logo (streamed from private storage) or an initials fallback. */
export function CompanyLogo({ className }: { className?: string }) {
  const { org, orgId } = useSession();
  const updated = org?.organization.logo_updated_at ?? null;
  const { data } = useQuery({
    queryKey: ['org-logo', orgId, updated],
    queryFn: () => apiBlobUrl('/org/logo'),
    enabled: Boolean(orgId && updated),
    staleTime: Infinity,
  });
  if (data?.url) {
    return <img src={data.url} alt={org?.organization.name ?? ''} className={cn('size-8 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-border', className)} />;
  }
  return <Avatar name={org?.organization.name ?? '?'} square className={cn('size-8', className)} />;
}

/** Reads a user-selected logo file; only PNG up to 1 MB is accepted (server re-verifies the bytes). */
export async function readLogoFile(file: File): Promise<string> {
  if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) throw new ApiError(400, 'logo_must_be_png');
  if (file.size > LOGO_MAX_BYTES) throw new ApiError(400, 'logo_too_large');
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(binary);
}
