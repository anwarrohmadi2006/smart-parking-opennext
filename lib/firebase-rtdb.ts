/**
 * Firebase Realtime Database wrapper
 *
 * Re-export semua fungsi dari @firebase/database. TypeScript types untuk
 * modul ini tersedia via firebase-database.d.ts (ambient declaration).
 */

export type { DataSnapshot, Database, DatabaseReference, Query, Unsubscribe, EventType, QueryConstraint } from "@firebase/database";

import {
  getDatabase,
  ref,
  onValue,
  off,
  get,
  set,
  update,
  remove,
  push,
  query,
  orderByKey,
  orderByChild,
  orderByValue,
  limitToFirst,
  limitToLast,
  startAt,
  endAt,
  equalTo,
  enableLogging,
  connectDatabaseEmulator,
  goOffline,
  goOnline
} from "@firebase/database";

export {
  getDatabase,
  ref,
  onValue,
  off,
  get,
  set,
  update,
  remove,
  push,
  query,
  orderByKey,
  orderByChild,
  orderByValue,
  limitToFirst,
  limitToLast,
  startAt,
  endAt,
  equalTo,
  enableLogging,
  connectDatabaseEmulator,
  goOffline,
  goOnline
};
