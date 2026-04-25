import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { COLLECTIONS, newCategoryRuleDoc } from '../firebase/schema.js';
import { fetchAll, createDoc, deleteDocById } from '../firebase/helpers.js';

const COLLECTION = COLLECTIONS.CATEGORY_RULES;

export const fetchCategoryRules = createAsyncThunk('categoryRules/fetch', async (_, { getState }) => {
  const uid = getState().auth.user?.uid;
  return fetchAll(COLLECTION, uid);
});

export const addCategoryRule = createAsyncThunk('categoryRules/add', async (input, { getState }) => {
  const uid = getState().auth.user.uid;
  const data = newCategoryRuleDoc({ user_id: uid, ...input });
  return createDoc(COLLECTION, uid, data);
});

export const removeCategoryRule = createAsyncThunk('categoryRules/remove', async (id) => {
  return deleteDocById(COLLECTION, id);
});

const slice = createSlice({
  name: 'categoryRules',
  initialState: { items: [], loading: false, error: null },
  reducers: {
    reset: (state) => { state.items = []; state.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(fetchCategoryRules.pending, (s) => { s.loading = true; });
    b.addCase(fetchCategoryRules.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; });
    b.addCase(fetchCategoryRules.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
    b.addCase(addCategoryRule.fulfilled, (s, a) => {
      // Replace any existing rule for the same merchant rather than letting
      // duplicates accumulate. Last write wins.
      const i = s.items.findIndex(
        (r) => r.merchant.toLowerCase() === a.payload.merchant.toLowerCase()
      );
      if (i >= 0) s.items[i] = a.payload;
      else s.items.push(a.payload);
    });
    b.addCase(removeCategoryRule.fulfilled, (s, a) => {
      s.items = s.items.filter((x) => x.id !== a.payload);
    });
  },
});

export const { reset: resetCategoryRules } = slice.actions;
export default slice.reducer;
