import type { ScanStatus } from '@nexus/shared';

/**
 * Malware scanning abstraction. No scanner is connected yet, so files are honestly marked
 * `not_scanned` — the UI shows this status; we never claim a file is clean without a scan.
 * To integrate a provider (e.g. ClamAV sidecar, Cloudmersive, VirusTotal), implement this
 * interface and select it with MALWARE_SCAN_PROVIDER.
 */
export interface MalwareScanner {
  readonly name: string;
  readonly active: boolean;
  scan(input: { storageKey: string; size: number; mimeType: string }): Promise<ScanStatus>;
}

export class NoopScanner implements MalwareScanner {
  readonly name = 'none';
  readonly active = false;
  async scan(): Promise<ScanStatus> {
    return 'not_scanned';
  }
}
