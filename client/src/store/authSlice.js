import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config.js';
import { COLLECTIONS, newUserDoc } from '../firebase/schema.js';

/** Ensure a users/{uid} doc exists; create with defaults on first sign-in. */
async function ensureUserDoc(firebaseUser) {
  const ref = doc(db, COLLECTIONS.USERS, firebaseUser.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const data = newUserDoc({
      email: firebaseUser.email,
      display_name: firebaseUser.displayName,
    });
    await setDoc(ref, data);
  }
}

/**
 * Sign in with Google.
 *
 * signInWithPopup works against the emulator too — it pops a Firebase-hosted
 * auth UI at localhost:9099 where you select an existing test user (e.g. the
 * one the seed script created) or add a new one. For production, standard
 * Google OAuth flow.
 */
export const signInWithGoogle = createAsyncThunk('auth/signInWithGoogle', async () => {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  await ensureUserDoc(result.user);
  return serializeUser(result.user);
});

export const signOut = createAsyncThunk('auth/signOut', async () => {
  await fbSignOut(auth);
});

/** One-shot attach of auth state listener. Dispatches setUser when it changes. */
export function subscribeToAuth(dispatch) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      await ensureUserDoc(firebaseUser);
      dispatch(authSlice.actions.setUser(serializeUser(firebaseUser)));
    } else {
      dispatch(authSlice.actions.setUser(null));
    }
  });
}

function serializeUser(u) {
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
  };
}

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    initialized: false,
    loading: false,
    error: null,
  },
  reducers: {
    setUser: (state, action) => {
      state.user = action.payload;
      state.initialized = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(signInWithGoogle.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(signInWithGoogle.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload;
        state.initialized = true;
      })
      .addCase(signInWithGoogle.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(signOut.fulfilled, (state) => {
        state.user = null;
      });
  },
});

export default authSlice.reducer;
