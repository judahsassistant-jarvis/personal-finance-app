import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { COLLECTIONS, newDebtConfigDoc } from '../firebase/schema.js';
import {
  fetchWhere,
  createDoc,
  updateDocById,
} from '../firebase/helpers.js';

const COLLECTION = COLLECTIONS.DEBT_CONFIG;

export const fetchDebtConfig = createAsyncThunk('debtConfig/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  const docs = await fetchWhere(COLLECTION, uid);
  return docs[0] ?? null;
});

export const ensureDebtConfig = createAsyncThunk('debtConfig/ensure', async (_, { getState, dispatch }) => {
  const uid = getState().auth.user.uid;
  const existing = await dispatch(fetchDebtConfig()).unwrap();
  if (existing) return existing;
  const data = newDebtConfigDoc({ user_id: uid });
  return createDoc(COLLECTION, uid, data);
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
