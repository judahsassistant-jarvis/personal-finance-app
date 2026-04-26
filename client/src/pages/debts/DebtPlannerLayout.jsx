import { Outlet } from 'react-router-dom';
import DebtPlannerTabs from './DebtPlannerTabs.jsx';

/**
 * Shared layout for the Debt Planner section. Renders the tab strip and the
 * matched sub-route's content via Outlet. Each sub-page owns its own H1 +
 * subtitle so the page identity matches the active tab.
 */
export default function DebtPlannerLayout() {
  return (
    <div className="space-y-6">
      <DebtPlannerTabs />
      <Outlet />
    </div>
  );
}
