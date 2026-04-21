import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { COLLECTIONS, newCardBucketDoc } from '../firebase/schema.js';
import { fetchAll, createDoc, updateDocById, deleteDocById } from '../firebase/helpers.js';

const COLLECTION = COLLECTIONS.CARD_BUCKETS;

export const fetchBuckets = createAsyncThunk('cardBuckets/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  return fetchAll(COLLECTION, uid, { orderByField: 'created', direction: 'asc' });
});

export const addBucket = createAsyncThunk('cardBuckets/add', async (input, { getState }) => {
  const uid = getState().auth.user.uid;
  const data = newCardBucketDoc({ user_id: uid, ...input });
  return createDoc(COLLECTION, uid, data);
});

export const editBucket = createAsyncThunk('cardBuckets/edit', async ({ id, ...updates }) => {
  return updateDocById(COLLECTION, id, updates);
});

export const removeBucket = createAsyncThunk('cardBuckets/remove', async (id) => {
  return deleteDocById(COLLECTION, id);
});

const slice = createSlice({
  name: 'cardBuckets',
  initialState: { items: [], loading: false, error: null },
  reducers: {
    reset: (state) => { state.items = []; state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchBuckets.pending, (s) => { s.loading = true; s.error = null; });
    b.addCase(fetchBuckets.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; });
    b.addCase(fetchBuckets.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
    b.addCase(addBucket.fulfilled, (s, a) => { s.items.push(a.payload); });
    b.addCase(editBucket.fulfilled, (s, a) => {
      const i = s.items.findIndex((x) => x.id === a.payload.id);
      if (i >= 0) s.items[i] = { ...s.items[i], ...a.payload };
    });
    b.addCase(removeBucket.fulfilled, (s, a) => {
      s.items = s.items.filter((x) => x.id !== a.payload);
    });
  },
});

export const { reset: resetBuckets } = slice.actions;
export default slice.reducer;
