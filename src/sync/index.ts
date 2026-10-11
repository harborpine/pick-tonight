import type { CreateSyncOptions, SyncApi } from '../contracts';
import { createMemorySync } from './memory';

/** PLACEHOLDER wiring from the lead: the sync teammate adds the Firebase implementation. */
export function createSync(opts: CreateSyncOptions): SyncApi {
  if (opts.mode === 'memory') return createMemorySync();
  throw new Error('Firebase sync is not built yet. Open the app with ?sync=memory for now.');
}
