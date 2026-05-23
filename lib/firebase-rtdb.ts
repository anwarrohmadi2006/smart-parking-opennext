/**
 * Firebase Realtime Database wrapper
 *
 * Re-export semua fungsi dari @firebase/database. TypeScript types untuk
 * modul ini tersedia via firebase-database.d.ts (ambient declaration).
 */

// Type-only exports (ambient types dari firebase-database.d.ts)
export type { DataSnapshot, Database, DatabaseReference, Query, Unsubscribe, EventType, QueryConstraint } from "@firebase/database";

/* eslint-disable @typescript-eslint/no-require-imports */
const m = require("@firebase/database");

export const getDatabase = m.getDatabase;
export const ref = m.ref;
export const onValue = m.onValue;
export const off = m.off;
export const get = m.get;
export const set = m.set;
export const update = m.update;
export const remove = m.remove;
export const push = m.push;
export const query = m.query;
export const orderByKey = m.orderByKey;
export const orderByChild = m.orderByChild;
export const orderByValue = m.orderByValue;
export const limitToFirst = m.limitToFirst;
export const limitToLast = m.limitToLast;
export const startAt = m.startAt;
export const endAt = m.endAt;
export const equalTo = m.equalTo;
export const enableLogging = m.enableLogging;
export const connectDatabaseEmulator = m.connectDatabaseEmulator;
export const goOffline = m.goOffline;
export const goOnline = m.goOnline;
