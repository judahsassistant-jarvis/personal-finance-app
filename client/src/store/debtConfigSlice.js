import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config.js';
import { COLLECTIONS, newDebtConfigDoc } from '../firebase/schema.js';
import { serializeDoc, updateDocById } from '../firebase/helpers.js';

const COLLECTION = COLLECTIONS.DEBT_CONFIG;

// Doc ID = user UID. Multiple components on the Debt Planner page each
// dispatch ensureDebtConfig() on mount; the deterministic ref ensures any
// racing setDoc writes converge on a single document instead of creating
// duplicates (which is what bit Judah on 2026-05-01 — see git history).
const refFor = (uid) => doc(db, COLLECTION, uid);

export const fetchDebtConfig = createAsyncThunk('debtConfig/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  if (!uid) return null;
  const snap = await getDoc(refFor(uid));
  return snap.exists() ? serializeDoc(snap) : null;
});

export const ensureDebtConfig = createAsyncThunk('debtConfig/ensure', async (_, { getState }) => {
  const uid = getState().auth.user.uid;
  const ref = refFor(uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return serializeDoc(snap);

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
    b.addCase(ensureDebtConfig.rejected, (s, a) => { s.error = a.error.message; });
    b.addCase(updateDebtConfig.fulfilled, (s, a) => {
      s.doc = { ...s.doc, ...a.payload };
    });
  },
});

export const { reset: resetDebtConfig } = slice.actions;
export default slice.reducer;
