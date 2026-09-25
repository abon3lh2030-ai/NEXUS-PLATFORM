import { randomUUID } from 'node:crypto';

export const FILES_BUCKET = 'company-files';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(v: string, label: string): void {
  if (!UUID_RE.test(v)) throw new Error(`invalid_${label}`);
}

/**
 * Storage keys are built ONLY from server-controlled UUIDs — never from the user's file name —
 * which rules out path traversal and predictable URLs.
 */
export function buildStorageKey(
  input:
    | { space: 'shared'; orgId: string; fileId?: string }
    | { space: 'private'; orgId: string; ownerUserId: string; fileId?: string }
    | { space: 'ai_workspace'; orgId: string; aiEmployeeId: string; fileId?: string },
): { fileId: string; key: string } {
  const fileId = input.fileId ?? randomUUID();
  assertUuid(input.orgId, 'org');
  assertUuid(fileId, 'file');
  switch (input.space) {
    case 'shared':
      return { fileId, key: `${input.orgId}/shared/${fileId}` };
    case 'private':
      assertUuid(input.ownerUserId, 'owner');
      return { fileId, key: `${input.orgId}/private/${input.ownerUserId}/${fileId}` };
    case 'ai_workspace':
      assertUuid(input.aiEmployeeId, 'ai_employee');
      return { fileId, key: `${input.orgId}/ai/${input.aiEmployeeId}/${fileId}` };
  }
}
