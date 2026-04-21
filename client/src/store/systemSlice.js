import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config.js';
import { serializeDoc } from '../firebase/helpers.js';

/**
 * System docs — bank holidays, etc. Single-doc reads, global scope.
 * Held in Redux so the Dashboard doesn't have to re-fetch on every render.
 */

export const fetchBankHolidays = createAsyncThunk('system/fetchBankHolidays', async () => {
  const snap = await getDoc(doc(db, 'system', 'bank_holidays'));
  if (!snap.exists()) return null;
  return serializeDoc(snap);
});

const slice = createSlice({
  name: 'system',
  initialState: {
    bankHolidays: null,
    loading: false,
    error: null,
  },
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchBankHolidays.pending, (s) => { s.loading = true; });
    b.addCase(fetchBankHolidays.fulfilled, (s, a) => { s.loading = false; s.bankHolidays = a.payload; });
    b.addCase(fetchBankHolidays.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
  },
});

export default slice.reducer;
