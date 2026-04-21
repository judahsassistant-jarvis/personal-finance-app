import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { COLLECTIONS, newMonthlyBudgetDoc } from '../firebase/schema.js';
import {
  fetchWhere,
  createDoc,
  updateDocById,
  deleteDocById,
} from '../firebase/helpers.js';

const COLLECTION = COLLECTIONS.MONTHLY_BUDGETS;

export const fetchBudgets = createAsyncThunk('budgets/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  return fetchWhere(COLLECTION, uid);
});

export const addBudget = createAsyncThunk('budgets/add', async (input, { getState }) => {
  const uid = getState().auth.user.uid;
  const data = newMonthlyBudgetDoc({ user_id: uid, ...input });
  return createDoc(COLLECTION, uid, data);
});

export const editBudget = createAsyncThunk('budgets/edit', async ({ id, ...updates }) => {
  return updateDocById(COLLECTION, id, updates);
});

export const removeBudget = createAsyncThunk('budgets/remove', async (id) => {
  return deleteDocById(COLLECTION, id);
});

const slice = createSlice({
  name: 'budgets',
  initialState: { items: [], loading: false, error: null },
  reducers: {
    reset: (state) => { state.items = []; state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchBudgets.pending, (s) => { s.loading = true; });
    b.addCase(fetchBudgets.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; });
    b.addCase(fetchBudgets.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
    b.addCase(addBudget.fulfilled, (s, a) => { s.items.push(a.payload); });
    b.addCase(editBudget.fulfilled, (s, a) => {
      const i = s.items.findIndex((x) => x.id === a.payload.id);
      if (i >= 0) s.items[i] = { ...s.items[i], ...a.payload };
    });
    b.addCase(removeBudget.fulfilled, (s, a) => {
      s.items = s.items.filter((x) => x.id !== a.payload);
    });
  },
});

export const { reset: resetBudgets } = slice.actions;
export default slice.reducer;
