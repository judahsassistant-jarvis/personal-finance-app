import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getAccounts, createAccount, updateAccount, deleteAccount } from '../api/client';

export const fetchAccounts = createAsyncThunk('accounts/fetch', async () => {
  const { data } = await getAccounts();
  return data;
});

export const addAccount = createAsyncThunk('accounts/add', async (accountData) => {
  const { data } = await createAccount(accountData);
  return data;
});

export const editAccount = createAsyncThunk('accounts/edit', async ({ id, ...updates }) => {
  const { data } = await updateAccount(id, updates);
  return data;
});

export const removeAccount = createAsyncThunk('accounts/remove', async (id) => {
  await deleteAccount(id);
  return id;
});

const accountsSlice = createSlice({
  name: 'accounts',
  initialState: { items: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAccounts.pending, (state) => { state.loading = true; })
      .addCase(fetchAccounts.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchAccounts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(addAccount.fulfilled, (state, action) => {
        state.items.push(action.payload);
      })
      .addCase(editAccount.fulfilled, (state, action) => {
        const idx = state.items.findIndex((a) => a.id === action.payload.id);
        if (idx >= 0) state.items[idx] = action.payload;
      })
      .addCase(removeAccount.fulfilled, (state, action) => {
        state.items = state.items.filter((a) => a.id !== action.payload);
      });
  },
});

export default accountsSlice.reducer;
