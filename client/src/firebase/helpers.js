/**
 * Firestore CRUD + Timestamp helpers shared across Redux slices.
 *
 * Every helper is user-scoped: reads filter by user_id; writes stamp user_id
 * from the authenticated user. This matches the security rules' ownership model.
 *
 * Firestore Timestamps are converted to epoch millis on deserialize so Redux
 * doesn't warn about non-serialisable state. Convert back to Date at the UI.
 */

import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './config.js';

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** Convert Firestore Timestamps in a doc to epoch millis for Redux storage. */
export function serializeDoc(snapshot) {
  const raw = snapshot.data();
  const out = { id: snapshot.id };
  for (const [k, v] of Object.entries(raw)) {
    if (v instanceof Timestamp) out[k] = v.toMillis();
    else if (v && typeof v === 'object' && !Array.isArray(v) && v.toMillis) out[k] = v.toMillis();
    else out[k] = v;
  }
  return out;
}

export function serializeSnapshot(snap) {
  return snap.docs.map(serializeDoc);
}

// ---------------------------------------------------------------------------
// Scoped CRUD
// ---------------------------------------------------------------------------

/** Fetch all docs in a collection scoped to user_id. Optional orderBy. */
export async function fetchAll(collectionName, userId, { orderByField, direction = 'asc' } = {}) {
  if (!userId) throw new Error('fetchAll requires userId');
  const clauses = [where('user_id', '==', userId)];
  if (orderByField) clauses.push(orderBy(orderByField, direction));
  const q = query(collection(db, collectionName), ...clauses);
  const snap = await getDocs(q);
  return serializeSnapshot(snap);
}

/** Fetch docs matching extra where clauses (always user-scoped). */
export async function fetchWhere(collectionName, userId, extraClauses = [], orderOpt) {
  if (!userId) throw new Error('fetchWhere requires userId');
  const clauses = [where('user_id', '==', userId), ...extraClauses];
  if (orderOpt) clauses.push(orderBy(orderOpt.field, orderOpt.direction || 'asc'));
  const q = query(collection(db, collectionName), ...clauses);
  const snap = await getDocs(q);
  return serializeSnapshot(snap);
}

/** Create a new doc, stamping user_id automatically. */
export async function createDoc(collectionName, userId, data) {
  if (!userId) throw new Error('createDoc requires userId');
  const ref = await addDoc(collection(db, collectionName), {
    ...data,
    user_id: userId,
    created: data.created ?? serverTimestamp(),
  });
  // Return shape compatible with the serialize path (avoid re-fetch).
  return { id: ref.id, ...data, user_id: userId };
}

export async function updateDocById(collectionName, id, updates) {
  await updateDoc(doc(db, collectionName, id), updates);
  return { id, ...updates };
}

export async function deleteDocById(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
  return id;
}

/** Batch-create many docs, stamping user_id on each. Returns the created docs. */
export async function batchCreate(collectionName, userId, dataArray) {
  if (!userId) throw new Error('batchCreate requires userId');
  const batch = writeBatch(db);
  const refs = [];
  for (const data of dataArray) {
    const ref = doc(collection(db, collectionName));
    refs.push(ref);
    batch.set(ref, {
      ...data,
      user_id: userId,
      created: data.created ?? serverTimestamp(),
    });
  }
  await batch.commit();
  return refs.map((ref, i) => ({
    id: ref.id,
    ...dataArray[i],
    user_id: userId,
  }));
}

/**
 * Update many docs in a single Firestore commit.
 *
 * @param {string} collectionName
 * @param {Array<{id: string, [field: string]: any}>} updates - each entry must
 *   include `id`; remaining fields are written via update().
 * @returns {Promise<Array<{id: string}>>} the input updates, one per row, useful
 *   for the slice's optimistic-update extraReducer.
 */
export async function batchUpdate(collectionName, updates) {
  if (!Array.isArray(updates) || updates.length === 0) return [];
  const batch = writeBatch(db);
  for (const { id, ...fields } of updates) {
    if (!id) throw new Error('batchUpdate entries require id');
    batch.update(doc(db, collectionName, id), fields);
  }
  await batch.commit();
  return updates;
}
