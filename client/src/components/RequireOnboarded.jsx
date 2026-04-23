import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';

/**
 * Gate that redirects signed-in users whose profile has `onboarding_complete: false`
 * to the first-run wizard at /welcome. Nested inside RequireAuth — assumes a user
 * is already present.
 */
export default function RequireOnboarded({ children }) {
  const profile = useSelector((s) => s.auth.profile);
  if (profile && !profile.onboarding_complete) {
    return <Navigate to="/welcome" replace />;
  }
  return children;
}
