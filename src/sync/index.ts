import type { CreateSyncOptions, SyncApi } from '../contracts';
import { createFirebaseSync } from './firebase';
import { createMemorySync } from './memory';

/** Firebase mode does nothing (no network, no sign-in) until init() is called. */
export function createSync(opts: CreateSyncOptions): SyncApi {
  return opts.mode === 'memory' ? createMemorySync() : createFirebaseSync();
}

export { createFirebaseSync } from './firebase';
export type { FirebaseSyncApi, FirebaseSyncOptions } from './firebase';
