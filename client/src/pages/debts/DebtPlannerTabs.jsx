import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/utils.js';

const TABS = [
  { to: '/debts', end: true, label: 'Overview' },
  { to: '/debts/what-if', end: false, label: 'What-If BT' },
  { to: '/debts/bonus', end: false, label: 'Bonus payment' },
  { to: '/debts/reminders', end: false, label: 'Reminders' },
];

/**
 * In-page tab navigation for the Debt Planner. Mirrors the same dropdown the
 * top nav exposes — page-level tabs let users flit between sub-views without
 * traversing the global nav each time.
 *
 * The Overview tab uses `end` so it doesn't stay highlighted when sub-routes
 * are active (which would cause two tabs to appear active at once).
 */
export default function DebtPlannerTabs() {
  return (
    <div className="flex items-center gap-1 rounded-md bg-muted p-1 w-fit flex-wrap">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
