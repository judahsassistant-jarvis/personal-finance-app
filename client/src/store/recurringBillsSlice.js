import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { COLLECTIONS, newRecurringBillDoc } from '../firebase/schema.js';
import { fetchAll, createDoc, updateDocById, deleteDocById } from '../firebase/helpers.js';

const COLLECTION = COLLECTIONS.RECURRING_BILLS;

export const fetchRecurringBills = createAsyncThunk('recurringBills/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  return fetchAll(COLLECTION, uid);
});

export const addRecurringBill = createAsyncThunk('recurringBills/add', async (input, { getState }) => {
  const uid = getState().auth.user.uid;
  const data = newRecurringBillDoc({ user_id: uid, ...input });
  return createDoc(COLLECTION, uid, data);
});

export const editRecurringBill = createAsyncThunk('recurringBills/edit', async ({ id, ...updates }) => {
  return updateDocById(COLLECTION, id, updates);
});

export const removeRecurringBill = createAsyncThunk('recurringBills/remove', async (id) => {
  return deleteDocById(COLLECTION, id);
});

const slice = createSlice({
  name: 'recurringBills',
  initialState: { items: [], loading: false, error: null },
  reducers: {
    reset: (state) => { state.items = []; state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchRecurringBills.pending, (s) => { s.loading = true; });
    b.addCase(fetchRecurringBills.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; });
    b.addCase(fetchRecurringBills.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
    b.addCase(addRecurringBill.fulfilled, (s, a) => { s.items.push(a.payload); });
    b.addCase(editRecurringBill.fulfilled, (s, a) => {
      const i = s.items.findIndex((x) => x.id === a.payload.id);
      if (i >= 0) s.items[i] = { ...s.items[i], ...a.payload };
    });
    b.addCase(removeRecurringBill.fulfilled, (s, a) => {
      s.items = s.items.filter((x) => x.id !== a.payload);
    });
  },
});

export const { reset: resetRecurringBills } = slice.actions;
export default slice.reducer;
