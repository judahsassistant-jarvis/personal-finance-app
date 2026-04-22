import { AlertCircle, Clock } from 'lucide-react';
import { formatGBP } from '../../firebase/schema.js';
import { promoUrgency } from '../../pages/debtPlannerHelpers.js';

// Urgency → container class. Critical / urgent get a tinted background so the
// card reads as "action required" at a glance. Warning / distant are plain —
// informational, not alarming.
const URGENCY_STYLES = {
  critical: {
    container: 'bg-destructive/10 text-destructive border border-destructive/20',
    icon: AlertCircle,
    iconClass: 'text-destructive',
    daysClass: 'text-destructive font-medium',
  },
  urgent: {
    container: 'bg-warning/15 text-warning-foreground border border-warning/25',
    icon: AlertCircle,
    iconClass: 'text-warning-foreground',
    daysClass: 'font-medium',
  },
  warning: {
    container: 'text-foreground',
    icon: Clock,
    iconClass: 'text-muted-foreground',
    daysClass: 'text-foreground',
  },
  distant: {
    container: 'text-muted-foreground',
    icon: Clock,
    iconClass: 'text-muted-foreground',
    daysClass: 'text-muted-foreground',
  },
};

export default function PromoCliffCountdown({ promo }) {
  if (!promo) return null;
  const { days, end, bucketName, balancePennies } = promo;
  const tier = promoUrgency(days);
  const style = URGENCY_STYLES[tier] ?? URGENCY_STYLES.distant;
  const Icon = style.icon;

  return (
    <div className={`mt-2 flex items-center gap-2 text-xs rounded-md px-2 py-1.5 ${style.container}`}>
      <Icon className={`w-3.5 h-3.5 shrink-0 ${style.iconClass}`} aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="font-medium">{bucketName}</span>
        <span> promo</span>
        {balancePennies > 0 && (
          <>
            <span> · </span>
            <span className="tabular-nums">{formatGBP(balancePennies)}</span>
          </>
        )}
        <span> · ends </span>
        <span className="tabular-nums">{formatPromoEndDate(end)}</span>
        <span> </span>
        <span className={`tabular-nums ${style.daysClass}`}>({formatDaysRemaining(days)})</span>
      </span>
    </div>
  );
}

function formatPromoEndDate(end) {
  if (!end) return '';
  const d = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDaysRemaining(days) {
  if (days == null || !Number.isFinite(days)) return '';
  if (days < 0) return 'already expired';
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}
