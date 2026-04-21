import { useDispatch, useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { signInWithGoogle } from '../store/authSlice.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { Alert, AlertDescription } from '../components/ui/alert.jsx';

export default function Login() {
  const dispatch = useDispatch();
  const { user, loading, error, initialized } = useSelector((s) => s.auth);

  if (!initialized) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Personal Finance</CardTitle>
          <CardDescription>Phase 2a dogfood</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => dispatch(signInWithGoogle())}
            disabled={loading}
            variant="accent"
            className="w-full"
            size="lg"
          >
            {loading ? 'Signing in…' : 'Sign in with Google'}
          </Button>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        {import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' && (
          <CardFooter>
            <p className="text-xs text-muted-foreground">
              Emulator mode — the popup lists test users; pick <span className="font-medium">judahsassistant@gmail.com</span> to see seed data.
            </p>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
