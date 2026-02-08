import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getCreditCards, createCreditCard, updateCreditCard, deleteCreditCard,
  createCardBucket, updateCardBucket, deleteCardBucket } from '../api/client';

export const fetchCards = createAsyncThunk('cards/fetch', async () => {
  const { data } = await getCreditCards();
  return data;
});

export const addCard = createAsyncThunk('cards/add', async (cardData) => {
  const { data } = await createCreditCard(cardData);
  return data;
});

export const editCard = createAsyncThunk('cards/edit', async ({ id, ...updates }) => {
  const { data } = await updateCreditCard(id, updates);
  return data;
});

export const removeCard = createAsyncThunk('cards/remove', async (id) => {
  await deleteCreditCard(id);
  return id;
});

export const addBucket = createAsyncThunk('cards/addBucket', async (bucketData) => {
  const { data } = await createCardBucket(bucketData);
  return data;
});

export const editBucket = createAsyncThunk('cards/editBucket', async ({ id, ...updates }) => {
  const { data } = await updateCardBucket(id, updates);
  return data;
});

export const removeBucket = createAsyncThunk('cards/removeBucket', async ({ id, cardId }) => {
  await deleteCardBucket(id);
  return { id, cardId };
});

const cardsSlice = createSlice({
  name: 'cards',
  initialState: { items: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchCards.pending, (state) => { state.loading = true; })
      .addCase(fetchCards.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchCards.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(addCard.fulfilled, (state, action) => {
        state.items.push({ ...action.payload, buckets: [] });
      })
      .addCase(editCard.fulfilled, (state, action) => {
        const idx = state.items.findIndex((c) => c.id === action.payload.id);
        if (idx >= 0) {
          state.items[idx] = { ...state.items[idx], ...action.payload };
        }
      })
      .addCase(removeCard.fulfilled, (state, action) => {
        state.items = state.items.filter((c) => c.id !== action.payload);
      })
      .addCase(addBucket.fulfilled, (state, action) => {
        const card = state.items.find((c) => c.id === action.payload.card_id);
        if (card) card.buckets.push(action.payload);
      })
      .addCase(editBucket.fulfilled, (state, action) => {
        const card = state.items.find((c) => c.id === action.payload.card_id);
        if (card) {
          const idx = card.buckets.findIndex((b) => b.id === action.payload.id);
          if (idx >= 0) card.buckets[idx] = action.payload;
        }
      })
      .addCase(removeBucket.fulfilled, (state, action) => {
        const card = state.items.find((c) => c.id === action.payload.cardId);
        if (card) {
          card.buckets = card.buckets.filter((b) => b.id !== action.payload.id);
        }
      })
      .addCase(addCard.rejected, (state, action) => {
        state.error = action.error.message;
      })
      .addCase(editCard.rejected, (state, action) => {
        state.error = action.error.message;
      });
  },
});

export default cardsSlice.reducer;
