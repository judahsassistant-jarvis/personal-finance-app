import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils.js';

/**
 * Top-nav dropdown — used by Layout for the Debt Planner section so the
 * sub-routes (Overview / What-If / Bonus / Reminders) are reachable from the
 * global nav without crowding it. Click toggles, hover opens, mouse-leave on
 * the panel closes.
 *
 * Active styling: the trigger highlights when the current pathname matches
 * any of the items' `to` paths under the section's base. The matched item
 * gets the active treatment too.
 *
 * @param {Object} props
 * @param {string} props.label - the trigger label ("Debt Planner")
 * @param {string} props.basePath - the section root ("/debts"); used to
 *   decide if the trigger should appear active.
 * @param {Array<{to: string, end?: boolean, label: string}>} props.items
 */
export default function NavDropdown({ label, basePath, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  const sectionActive = location.pathname === basePath || location.pathname.startsWith(`${basePath}/`);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Close on route change so the panel doesn't linger after navigating.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={cn(
          'px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1',
          sectionActive
            ? 'bg-secondary text-secondary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
      >
        {label}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 mt-1 min-w-[180px] rounded-md border border-border bg-background shadow-md z-50 p-1"
          onMouseLeave={() => setOpen(false)}
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              role="menuitem"
              className={({ isActive }) =>
                cn(
                  'block px-3 py-1.5 text-sm rounded-md transition-colors',
                  isActive
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
