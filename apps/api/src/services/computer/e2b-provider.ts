import { AppError } from '../../lib/errors.js';
import type { ComputerProvider } from './computer-provider.js';
import { StorageWorkspaceComputerProvider } from './storage-workspace-provider.js';

/**
 * Placeholder for an external sandbox provider (e.g. E2B) that would add a real isolated
 * browser + terminal. The integration is intentionally NOT implemented until an account and
 * API key are provided — selecting it fails loudly at boot instead of pretending to work.
 *
 * Integration plan (see docs/ai-computers.md):
 *   - createSession → start an ephemeral sandbox VM per work session (no host mounts, no secrets)
 *   - terminalCommand / browserAction → proxied to the sandbox with command allow-lists + timeouts
 *   - file sync ↔ the employee's storage workspace prefix only
 *   - terminateSession → destroy the VM; usage seconds → usage_counters('computer_seconds')
 */
export function createE2BProvider(): ComputerProvider {
  throw new AppError(
    503,
    'computer_provider_not_implemented',
    'COMPUTER_PROVIDER=e2b selected, but the E2B integration has not been connected yet. Use storage_workspace.',
  );
}

export { StorageWorkspaceComputerProvider };
