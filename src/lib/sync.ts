import { Platform } from 'react-native';

export type SyncStatus = 'CONNECTING' | 'SYNCING' | 'PAUSED' | 'FAILED' | 'COMPLETE';

export interface SyncResult {
  status: SyncStatus;
  sent: number;
  received: number;
  reason?: 'syncNoWeb' | 'syncNoNative';
}

/**
 * No nearby transport is installed yet (Android: Google Nearby Connections needs a dev-build native module).
 * So nothing is ever "discovered" and a sync attempt honestly FAILS — no mock devices, no fake progress.
 */
export const transport = {
  available: false,
  reason: (Platform.OS === 'web' ? 'syncNoWeb' : 'syncNoNative') as 'syncNoWeb' | 'syncNoNative',
};

export function runSync(): SyncResult {
  return { status: 'FAILED', sent: 0, received: 0, reason: transport.reason };
}
