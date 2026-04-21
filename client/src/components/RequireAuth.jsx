import { useSelector } from 'react-redux';
import { Navigate, useLocation } from 'react-router-dom';

export default function RequireAuth({ children }) {
  const { user, initialized } = useSelector((s) => s.auth);
  const location = useLocation();

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}
