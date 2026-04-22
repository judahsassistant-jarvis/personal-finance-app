import { formatGBP } from '../../firebase/schema.js';

export default function PayoffProgressBar({ progress }) {
  if (!progress) return null;
  const { progressRatio, startingPennies, paidPennies } = progress;
  const pctLabel = `${Math.round(progressRatio * 100)}%`;

  return (
    <div className="mt-2 mb-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 gap-2 flex-wrap">
        <span>
          Payoff progress <span className="text-foreground">{pctLabel}</span>
        </span>
        <span className="tabular-nums">
          {formatGBP(paidPennies)} paid of {formatGBP(startingPennies)} starting balance
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-positive transition-all"
          style={{ width: `${progressRatio * 100}%` }}
        />
      </div>
    </div>
  );
}
