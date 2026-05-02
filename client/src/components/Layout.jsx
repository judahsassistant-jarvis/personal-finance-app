import { NavLink, Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { LogOut } from 'lucide-react';
import { signOut } from '../store/authSlice.js';
import { Button } from './ui/button.jsx';
import NavDropdown from './NavDropdown.jsx';
import { cn } from '../lib/utils.js';

// Plain top-level entries. Debt Planner is special-cased below as a
// dropdown so the sub-routes (What-If / Bonus / Reminders) are reachable
// from the global nav without flat-listing them all.
const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/import', label: 'Import' },
  { to: '/budgets', label: 'Budgets' },
  { to: '/forecast', label: 'Forecast' },
];

const debtPlannerItems = [
  { to: '/debts', end: true, label: 'Overview' },
  { to: '/debts/what-if', label: 'What-If BT' },
  { to: '/debts/bonus', label: 'Bonus payment' },
  { to: '/debts/reminders', label: 'Reminders' },
];

export default function Layout() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);

  return (
    <div className="min-h-screen bg-muted/30">
      {import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' && (
        <div className="bg-amber-500 text-amber-950 text-center text-xs py-1.5 font-semibold tracking-wide">
          EMULATOR MODE — data is local only and will not appear in production
        </div>
      )}
      <header className="bg-background border-b border-border">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-8">
              <span className="font-semibold text-sm tracking-tight">Personal Finance</span>
              <nav className="flex items-center gap-1">
                {navItems.slice(0, 2).map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-secondary text-secondary-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
                <NavDropdown label="Debt Planner" basePath="/debts" items={debtPlannerItems} />
                {navItems.slice(2).map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-secondary text-secondary-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground hidden md:inline">{user?.email}</span>
              <Button
                onClick={() => dispatch(signOut())}
                variant="ghost"
                size="sm"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
