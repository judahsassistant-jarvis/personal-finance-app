import { formatGBP } from '../../firebase/schema.js';

// Sub-caption suffix differs by reference type. Installment debts anchor on
// the original principal ("starting"); overdrafts anchor on the facility size.
const MODE_COPY = {
  installment: { suffix: 'starting balance', noun: 'paid' },
  overdraft: { suffix: 'overdraft facility', noun: 'cleared' },
};

export default function PayoffProgressBar({ progress }) {
  if (!progress) return null;
  const { progressRatio, referencePennies, paidPennies, mode } = progress;
  const pctLabel = `${Math.round(progressRatio * 100)}%`;
  const copy = MODE_COPY[mode] ?? MODE_COPY.installment;

  return (
    <div className="mt-2 mb-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 gap-2 flex-wrap">
        <span>
          Payoff progress <span className="text-foreground">{pctLabel}</span>
        </span>
        <span className="tabular-nums">
          {formatGBP(paidPennies)} {copy.noun} of {formatGBP(referencePennies)} {copy.suffix}
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
