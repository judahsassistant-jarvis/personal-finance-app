import { useDispatch, useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { signInWithGoogle } from '../store/authSlice.js';

export default function Login() {
  const dispatch = useDispatch();
  const { user, loading, error, initialized } = useSelector((s) => s.auth);

  if (!initialized) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>;
  }
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-sm w-full bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Personal Finance</h1>
        <p className="text-sm text-gray-500 mb-6">Phase 2a dogfood</p>
        <button
          onClick={() => dispatch(signInWithGoogle())}
          disabled={loading}
          className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-md transition-colors"
        >
          {loading ? 'Signing in...' : 'Sign in with Google'}
        </button>
        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}
        {import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' && (
          <p className="mt-6 text-xs text-gray-400">
            Emulator mode — auto-signs in as dev user
          </p>
        )}
      </div>
    </div>
  );
}
