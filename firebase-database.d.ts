/**
 * firebase-rtdb-types.d.ts
 *
 * Ambient type declarations untuk Firebase Realtime Database.
 * Diperlukan karena @firebase/database tidak memiliki field "types"
 * (hanya "typings") sehingga moduleResolution: bundler tidak mengenalinya.
 */

declare module "@firebase/database" {
  // Core types
  export interface Database {
    readonly app: import("firebase/app").FirebaseApp;
    readonly type: "database";
  }

  export interface DatabaseReference extends Query {
    readonly key: string | null;
    readonly parent: DatabaseReference | null;
    readonly root: DatabaseReference;
    child(path: string): DatabaseReference;
  }

  export interface Query {
    readonly ref: DatabaseReference;
    isEqual(other: Query | null): boolean;
    toJSON(): string;
    toString(): string;
  }

  export interface DataSnapshot {
    readonly key: string | null;
    readonly ref: DatabaseReference;
    readonly size: number;
    child(path: string): DataSnapshot;
    exists(): boolean;
    exportVal(): unknown;
    forEach(action: (child: DataSnapshot) => boolean | void): boolean;
    hasChild(path: string): boolean;
    hasChildren(): boolean;
    numChildren(): number;
    toJSON(): unknown;
    val(): unknown;
  }

  export interface ListenOptions {
    readonly onlyOnce?: boolean;
  }

  export type Unsubscribe = () => void;

  export type EventType =
    | "value"
    | "child_added"
    | "child_changed"
    | "child_moved"
    | "child_removed";

  export interface QueryConstraint {
    readonly type: string;
  }

  // Main functions
  export function getDatabase(app?: import("firebase/app").FirebaseApp, url?: string): Database;
  export function ref(db: Database, path?: string): DatabaseReference;
  export function onValue(
    query: Query,
    callback: (snapshot: DataSnapshot) => void,
    options?: ListenOptions
  ): Unsubscribe;
  export function onValue(
    query: Query,
    callback: (snapshot: DataSnapshot) => void,
    cancelCallback?: (error: Error) => void,
    options?: ListenOptions
  ): Unsubscribe;
  export function off(
    query: Query,
    eventType?: EventType,
    callback?: (snapshot: DataSnapshot, previousChildName?: string | null) => void
  ): void;
  export function get(query: Query): Promise<DataSnapshot>;
  export function set(ref: DatabaseReference, value: unknown): Promise<void>;
  export function update(ref: DatabaseReference, values: object): Promise<void>;
  export function remove(ref: DatabaseReference): Promise<void>;
  export function push(parent: DatabaseReference, value?: unknown): Promise<DatabaseReference>;
  export function query(query: Query, ...queryConstraints: QueryConstraint[]): Query;
  export function orderByKey(): QueryConstraint;
  export function orderByChild(path: string): QueryConstraint;
  export function orderByPriority(): QueryConstraint;
  export function orderByValue(): QueryConstraint;
  export function limitToFirst(limit: number): QueryConstraint;
  export function limitToLast(limit: number): QueryConstraint;
  export function startAt(value: number | string | boolean | null, key?: string): QueryConstraint;
  export function startAfter(value: number | string | boolean | null, key?: string): QueryConstraint;
  export function endAt(value: number | string | boolean | null, key?: string): QueryConstraint;
  export function endBefore(value: number | string | boolean | null, key?: string): QueryConstraint;
  export function equalTo(value: number | string | boolean | null, key?: string): QueryConstraint;
  export function enableLogging(logger?: boolean | ((msg: string) => void), persistent?: boolean): void;
  export function connectDatabaseEmulator(db: Database, host: string, port: number, options?: { mockUserToken?: string }): void;
  export function goOffline(db: Database): void;
  export function goOnline(db: Database): void;
}
