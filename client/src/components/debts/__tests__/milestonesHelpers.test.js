import { describe, it, expect } from 'vitest';
import { DEBT_SUBTYPES } from '../../../firebase/schema.js';
import { computeMilestones, computeUtilisationCrossings } from '../milestonesHelpers.js';

// Mirrors runForecast output.
function makeForecast({ debtFreeMonth = null, payoffSchedules = [], months = [] } = {}) {
  return { debtFreeMonth, payoffSchedules, months };
}

function makeMonth(label, perDebt = []) {
  return { month: label, per_debt: perDebt };
}

describe('computeMilestones', () => {
  it('returns empty structures when forecast is missing', () => {
    const out = computeMilestones(null, []);
    expect(out.debtFreeMonth).toBeNull();
    expect(out.perCategory).toEqual([]);
    expect(out.perDebt).toEqual([]);
    expect(out.utilisationCrossings).toEqual([]);
  });

  it('surfaces per-debt payoffs sorted by date, with names + interest', () => {
    const debts = [
      { id: 'a', name: 'Barclaycard', subtype: DEBT_SUBTYPES.CARD },
      { id: 'b', name: 'Zopa', subtype: DEBT_SUBTYPES.PERSONAL_LOAN },
    ];
    const forecast = makeForecast({
      payoffSchedules: [
        { debt_id: 'b', payoff_month: '2028-03-01', total_interest_pennies: 120000 },
        { debt_id: 'a', payoff_month: '2027-09-01', total_interest_pennies: 45000 },
      ],
    });
    const out = computeMilestones(forecast, debts);
    expect(out.perDebt.map((p) => p.name)).toEqual(['Barclaycard', 'Zopa']);
    expect(out.perDebt[0].totalInterestPennies).toBe(45000);
    expect(out.perDebt[0].payoffMonth).toBe('2027-09-01');
  });

  it('drops payoff rows whose debt_id is no longer in the debts list', () => {
    const debts = [{ id: 'a', name: 'Kept', subtype: DEBT_SUBTYPES.CARD }];
    const forecast = makeForecast({
      payoffSchedules: [
        { debt_id: 'a', payoff_month: '2027-01-01', total_interest_pennies: 10000 },
        { debt_id: 'ghost', payoff_month: '2027-02-01', total_interest_pennies: 20000 },
      ],
    });
    const out = computeMilestones(forecast, debts);
    expect(out.perDebt).toHaveLength(1);
    expect(out.perDebt[0].name).toBe('Kept');
  });

  it('rolls up per-category using the latest payoff in each subtype', () => {
    const debts = [
      { id: 'a', name: 'Barclaycard', subtype: DEBT_SUBTYPES.CARD },
      { id: 'b', name: 'Halifax', subtype: DEBT_SUBTYPES.CARD },
      { id: 'c', name: 'Zopa', subtype: DEBT_SUBTYPES.PERSONAL_LOAN },
    ];
    const forecast = makeForecast({
      payoffSchedules: [
        { debt_id: 'a', payoff_month: '2027-01-01', total_interest_pennies: 0 },
        { debt_id: 'b', payoff_month: '2027-06-01', total_interest_pennies: 0 },
        { debt_id: 'c', payoff_month: '2028-03-01', total_interest_pennies: 0 },
      ],
    });
    const cats = computeMilestones(forecast, debts).perCategory;
    const cardCat = cats.find((c) => c.subtype === DEBT_SUBTYPES.CARD);
    expect(cardCat.count).toBe(2);
    expect(cardCat.lastPayoffMonth).toBe('2027-06-01'); // the later of the two
    expect(cardCat.label).toBe('credit cards');
  });

  it('sorts per-category by which category clears first', () => {
    const debts = [
      { id: 'a', name: 'Card', subtype: DEBT_SUBTYPES.CARD },
      { id: 'b', name: 'Loan', subtype: DEBT_SUBTYPES.PERSONAL_LOAN },
    ];
    const forecast = makeForecast({
      payoffSchedules: [
        { debt_id: 'b', payoff_month: '2026-12-01', total_interest_pennies: 0 }, // earlier
        { debt_id: 'a', payoff_month: '2028-03-01', total_interest_pennies: 0 },
      ],
    });
    const cats = computeMilestones(forecast, debts).perCategory;
    expect(cats[0].subtype).toBe(DEBT_SUBTYPES.PERSONAL_LOAN);
    expect(cats[1].subtype).toBe(DEBT_SUBTYPES.CARD);
  });

  it('passes debtFreeMonth straight through from the forecast', () => {
    const out = computeMilestones(makeForecast({ debtFreeMonth: '2028-05-01' }), []);
    expect(out.debtFreeMonth).toBe('2028-05-01');
  });
});

describe('computeUtilisationCrossings', () => {
  const cardA = { id: 'a', limit_pennies: 200000 };      // £2k limit
  const cardB = { id: 'b', limit_pennies: 100000 };      // £1k limit
  const debts = [cardA, cardB];
  // Combined limit = 300000. Thresholds in pennies:
  //   75% = 225000,  50% = 150000,  30% = 90000

  it('returns empty array when no debt has a limit', () => {
    const noLimits = [{ id: 'x' }, { id: 'y' }];
    const months = [makeMonth('2026-05-01', [{ debt_id: 'x', ending_pennies: 1000 }])];
    expect(computeUtilisationCrossings(months, noLimits)).toEqual([]);
  });

  it('flags the first month each threshold is crossed downward', () => {
    // util over time: 80% → 70% → 45% → 20% → 0%
    const months = [
      // month 0: 80% utilisation — entry point, no milestone
      makeMonth('2026-05-01', [{ debt_id: 'a', ending_pennies: 200000 }, { debt_id: 'b', ending_pennies: 40000 }]),
      // month 1: 70% — crosses 75%
      makeMonth('2026-06-01', [{ debt_id: 'a', ending_pennies: 170000 }, { debt_id: 'b', ending_pennies: 40000 }]),
      // month 2: 45% — crosses 50%
      makeMonth('2026-07-01', [{ debt_id: 'a', ending_pennies: 100000 }, { debt_id: 'b', ending_pennies: 35000 }]),
      // month 3: 20% — crosses 30%
      makeMonth('2026-08-01', [{ debt_id: 'a', ending_pennies: 40000 }, { debt_id: 'b', ending_pennies: 20000 }]),
      // month 4: 0% — crosses 0%
      makeMonth('2026-09-01', [{ debt_id: 'a', ending_pennies: 0 }, { debt_id: 'b', ending_pennies: 0 }]),
    ];
    const crossings = computeUtilisationCrossings(months, debts);
    expect(crossings).toEqual([
      { threshold: 0.75, month: '2026-06-01' },
      { threshold: 0.50, month: '2026-07-01' },
      { threshold: 0.30, month: '2026-08-01' },
      { threshold: 0,    month: '2026-09-01' },
    ]);
  });

  it('does not fire a milestone for a threshold the user already starts below', () => {
    // Starts at 20% — already under 30%, 50%, 75%. No milestones until 0%.
    const months = [
      makeMonth('2026-05-01', [{ debt_id: 'a', ending_pennies: 40000 }, { debt_id: 'b', ending_pennies: 20000 }]),
      makeMonth('2026-06-01', [{ debt_id: 'a', ending_pennies: 0 }, { debt_id: 'b', ending_pennies: 0 }]),
    ];
    const crossings = computeUtilisationCrossings(months, debts);
    expect(crossings).toEqual([{ threshold: 0, month: '2026-06-01' }]);
  });

  it('records each threshold only once even if utilisation bounces back above', () => {
    const months = [
      makeMonth('2026-05-01', [{ debt_id: 'a', ending_pennies: 200000 }, { debt_id: 'b', ending_pennies: 40000 }]), // 80%
      makeMonth('2026-06-01', [{ debt_id: 'a', ending_pennies: 140000 }, { debt_id: 'b', ending_pennies: 30000 }]), // ~57%
      makeMonth('2026-07-01', [{ debt_id: 'a', ending_pennies: 200000 }, { debt_id: 'b', ending_pennies: 45000 }]), // ~82% (new charges)
      makeMonth('2026-08-01', [{ debt_id: 'a', ending_pennies: 140000 }, { debt_id: 'b', ending_pennies: 30000 }]), // ~57% again
    ];
    const crossings = computeUtilisationCrossings(months, debts);
    expect(crossings).toEqual([
      { threshold: 0.75, month: '2026-06-01' },
    ]);
  });

  it('collapses multiple crossings in the same month (big drop in one step)', () => {
    // Starts at 80%, jumps straight to 10% — all 3 thresholds cross in the same month
    const months = [
      makeMonth('2026-05-01', [{ debt_id: 'a', ending_pennies: 200000 }, { debt_id: 'b', ending_pennies: 40000 }]),
      makeMonth('2026-06-01', [{ debt_id: 'a', ending_pennies: 20000 }, { debt_id: 'b', ending_pennies: 10000 }]), // 10%
    ];
    const crossings = computeUtilisationCrossings(months, debts);
    expect(crossings.map((c) => c.threshold)).toEqual([0.75, 0.50, 0.30]);
    expect(crossings.every((c) => c.month === '2026-06-01')).toBe(true);
  });
});
