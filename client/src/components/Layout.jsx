import { NavLink, Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { signOut } from '../store/authSlice.js';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/debts', label: 'Debt Planner' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/import', label: 'Import' },
  { to: '/budgets', label: 'Budgets' },
  { to: '/forecast', label: 'Forecast' },
];

export default function Layout() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-indigo-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="font-bold text-xl">Personal Finance</div>
            <div className="flex items-center space-x-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-900 text-white'
                        : 'text-indigo-100 hover:bg-indigo-600'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <span className="pl-4 text-xs text-indigo-100">{user?.email}</span>
              <button
                onClick={() => dispatch(signOut())}
                className="ml-2 px-3 py-1 text-xs rounded-md bg-indigo-800 hover:bg-indigo-900"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
