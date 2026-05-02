import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config.js';
import { COLLECTIONS, newDebtConfigDoc } from '../firebase/schema.js';
import { serializeDoc } from '../firebase/helpers.js';
import { updateDocById } from '../firebase/helpers.js';

const COLLECTION = COLLECTIONS.DEBT_CONFIG;

/**
 * Load the user's debt_config doc, self-migrating legacy random-ID docs to
 * the new {uid}-keyed convention.
 *
 * Pre-2026-05-02 the slice used `addDoc` which assigned auto IDs; multiple
 * components dispatching `ensureDebtConfig` on mount raced, all saw "no
 * existing doc" via the user_id query, and all called createDoc — leaving
 * users with N copies. Fix: use `setDoc(doc(db, COL, uid), ..., {merge})`
 * so racing writes converge on the same ref. Legacy docs are migrated
 * the first time the new code reads them.
 */
async function loadConfig(uid) {
  const ref = doc(db, COLLECTION, uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { ref, snap, exists: true };

  const legacy = await getDocs(query(
    collection(db, COLLECTION),
    where('user_id', '==', uid),
  ));
  if (!legacy.empty) {
    const old = legacy.docs[0];
    await setDoc(ref, old.data());
    // Best-effort cleanup; if a parallel client already deleted it, ignore.
    try { await deleteDoc(old.ref); } catch { /* noop */ }
    const fresh = await getDoc(ref);
    return { ref, snap: fresh, exists: true };
  }

  return { ref, snap: null, exists: false };
}

export const fetchDebtConfig = createAsyncThunk('debtConfig/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  if (!uid) return null;
  const { snap, exists } = await loadConfig(uid);
  return exists ? serializeDoc(snap) : null;
});

export const ensureDebtConfig = createAsyncThunk('debtConfig/ensure', async (_, { getState }) => {
  const uid = getState().auth.user.uid;
  const { ref, snap, exists } = await loadConfig(uid);
  if (exists) return serializeDoc(snap);

  const data = newDebtConfigDoc({ user_id: uid });
  await setDoc(ref, { ...data, created: serverTimestamp() });
  const fresh = await getDoc(ref);
  return serializeDoc(fresh);
});

export const updateDebtConfig = createAsyncThunk('debtConfig/update', async ({ id, ...updates }) => {
  return updateDocById(COLLECTION, id, updates);
});

const slice = createSlice({
  name: 'debtConfig',
  initialState: { doc: null, loading: false, error: null },
  reducers: {
    reset: (state) => { state.doc = null; state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchDebtConfig.pending, (s) => { s.loading = true; });
    b.addCase(fetchDebtConfig.fulfilled, (s, a) => { s.loading = false; s.doc = a.payload; });
    b.addCase(fetchDebtConfig.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
    b.addCase(ensureDebtConfig.fulfilled, (s, a) => { s.doc = a.payload; });
    b.addCase(updateDebtConfig.fulfilled, (s, a) => {
      s.doc = { ...s.doc, ...a.payload };
    });
  },
});

export const { reset: resetDebtConfig } = slice.actions;
export default slice.reducer;
