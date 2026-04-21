import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config.js';
import { COLLECTIONS, newUserDoc } from '../firebase/schema.js';
import { serializeDoc } from '../firebase/helpers.js';

/**
 * Ensure a users/{uid} doc exists; create with defaults on first sign-in.
 * Returns the serialised profile (id + all fields, with Timestamps → millis).
 */
async function ensureUserDoc(firebaseUser) {
  const ref = doc(db, COLLECTIONS.USERS, firebaseUser.uid);
  let snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, newUserDoc({
      email: firebaseUser.email,
      display_name: firebaseUser.displayName,
    }));
    snap = await getDoc(ref);
  }
  return serializeDoc(snap);
}

export const signInWithGoogle = createAsyncThunk('auth/signInWithGoogle', async () => {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const profile = await ensureUserDoc(result.user);
  return { user: serializeUser(result.user), profile };
});

export const signOut = createAsyncThunk('auth/signOut', async () => {
  await fbSignOut(auth);
});

/** Update arbitrary fields on the users/{uid} doc. */
export const updateProfile = createAsyncThunk('auth/updateProfile', async (updates, { getState }) => {
  const uid = getState().auth.user?.uid;
  if (!uid) throw new Error('not signed in');
  await updateDoc(doc(db, COLLECTIONS.USERS, uid), updates);
  return updates;
});

/** One-shot attach of auth state listener. Loads profile alongside user. */
export function subscribeToAuth(dispatch) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      const profile = await ensureUserDoc(firebaseUser);
      dispatch(authSlice.actions.setUserAndProfile({
        user: serializeUser(firebaseUser),
        profile,
      }));
    } else {
      dispatch(authSlice.actions.setUserAndProfile({ user: null, profile: null }));
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
    profile: null,         // users/{uid} doc contents
    initialized: false,
    loading: false,
    error: null,
  },
  reducers: {
    setUserAndProfile: (state, action) => {
      state.user = action.payload.user;
      state.profile = action.payload.profile;
      state.initialized = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(signInWithGoogle.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(signInWithGoogle.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload.user;
        state.profile = action.payload.profile;
        state.initialized = true;
      })
      .addCase(signInWithGoogle.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(signOut.fulfilled, (state) => {
        state.user = null;
        state.profile = null;
      })
      .addCase(updateProfile.fulfilled, (state, action) => {
        if (state.profile) state.profile = { ...state.profile, ...action.payload };
      });
  },
});

export default authSlice.reducer;
