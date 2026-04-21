import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { COLLECTIONS, newAccountDoc } from '../firebase/schema.js';
import { fetchAll, createDoc, updateDocById, deleteDocById } from '../firebase/helpers.js';

const COLLECTION = COLLECTIONS.ACCOUNTS;

export const fetchAccounts = createAsyncThunk('accounts/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  return fetchAll(COLLECTION, uid, { orderByField: 'created', direction: 'asc' });
});

export const addAccount = createAsyncThunk('accounts/add', async (input, { getState }) => {
  const uid = getState().auth.user.uid;
  const data = newAccountDoc({ user_id: uid, ...input });
  return createDoc(COLLECTION, uid, data);
});

export const editAccount = createAsyncThunk('accounts/edit', async ({ id, ...updates }) => {
  return updateDocById(COLLECTION, id, updates);
});

export const removeAccount = createAsyncThunk('accounts/remove', async (id) => {
  return deleteDocById(COLLECTION, id);
});

const slice = createSlice({
  name: 'accounts',
  initialState: { items: [], loading: false, error: null },
  reducers: {
    reset: (state) => { state.items = []; state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchAccounts.pending, (s) => { s.loading = true; s.error = null; });
    b.addCase(fetchAccounts.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; });
    b.addCase(fetchAccounts.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
    b.addCase(addAccount.fulfilled, (s, a) => { s.items.push(a.payload); });
    b.addCase(editAccount.fulfilled, (s, a) => {
      const i = s.items.findIndex((x) => x.id === a.payload.id);
      if (i >= 0) s.items[i] = { ...s.items[i], ...a.payload };
    });
    b.addCase(removeAccount.fulfilled, (s, a) => {
      s.items = s.items.filter((x) => x.id !== a.payload);
    });
  },
});

export const { reset: resetAccounts } = slice.actions;
export default slice.reducer;
