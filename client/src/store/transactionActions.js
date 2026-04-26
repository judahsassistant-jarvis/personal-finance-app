/**
 * Cross-slice action creators. Lives in its own file so importBatchesSlice
 * can dispatch into transactionsSlice without a circular import.
 */

import { createAction } from '@reduxjs/toolkit';

/**
 * Fired when a removeImportBatch cascade finishes. Carries the deleted
 * batch id and the ids of every transaction the cascade removed, so
 * transactionsSlice can drop them from in-memory state without refetching.
 */
export const transactionsRemovedByBatch = createAction('transactions/removedByBatch');
