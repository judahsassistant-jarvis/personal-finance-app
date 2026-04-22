import { formatGBP } from '../../firebase/schema.js';

// Band → Tailwind bg class. Kept here (not in the helper) because CSS classes
// are a presentation concern; the pure helper only classifies the ratio.
const BAND_BG = {
  good: 'bg-positive',
  fair: 'bg-warning',
  poor: 'bg-destructive',
};

const BAND_LABEL = {
  good: 'low',
  fair: 'moderate',
  poor: 'high',
};

export default function UtilisationBar({ utilisation }) {
  if (!utilisation) return null;
  const { ratio, band, overLimit, limitPennies, balancePennies } = utilisation;
  const pctLabel = `${Math.round(ratio * 100)}%`;
  const displayRatio = Math.min(1, Math.max(0, ratio));
  const barBg = BAND_BG[band] ?? BAND_BG.poor;

  return (
    <div className="mt-2 mb-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1 gap-2 flex-wrap">
        <span>
          Utilisation <span className="text-foreground">{pctLabel}</span>
          <span className="text-muted-foreground"> ({BAND_LABEL[band]})</span>
          {overLimit && <span className="text-destructive font-medium"> — over limit</span>}
        </span>
        <span className="tabular-nums">
          {formatGBP(balancePennies)} / {formatGBP(limitPennies)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${barBg} transition-all`}
          style={{ width: `${displayRatio * 100}%` }}
        />
      </div>
    </div>
  );
}
