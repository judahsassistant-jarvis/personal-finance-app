# Design system — Personal Finance App

**Status:** Locked 2026-04-21 for Phase 2a. Dark mode defined but not implemented until Sprint 7.5.

## Influences

Mixed in this order of priority:

1. **Monarch Money** — primary: warm off-white background, teal accent, finance-domain patterns (account cards, debt cards, balance hero numbers, chart treatments).
2. **Linear** — tight spacing, minimal visual noise, confident typography, data-first hierarchy.
3. **Stripe Dashboard** — data-density patterns, financial row layouts, tabular figures.

Not referenced: Revolut (too consumer-app), Emma (too cluttered), YNAB (too spreadsheet).

**Selected on 2026-04-21** from the `/design` preview page comparing three directions (A: Muted/Linear, B: Coloured/Monarch, C: Bold/Stripe). B won — reads as approachable without being consumer-y.

## Vocabulary

| Token | Role | Colour |
|---|---|---|
| `background` | page background | warm cream |
| `foreground` | primary text | deep teal-black |
| `card` | elevated surface background | off-white (slightly warmer than background) |
| `muted` | soft background panel | pale teal-grey |
| `muted-foreground` | secondary text | medium teal-grey |
| `border` | dividers, card outlines | soft teal-grey |
| `accent` | single accent colour | teal |
| `positive` | positive monetary values, success states | deep green |
| `destructive` | negative monetary values, errors | warm rose |
| `warning` | BT cliffs, overdraft warnings, low safe-to-spend | amber |

All tokens are CSS variables on `:root` defined in `client/src/index.css`, exposed to Tailwind via `@theme`.

## Rules

- **Tabular figures for all monetary values.** Use `font-mono tabular-nums` or the `.tabular-nums` utility. Finance rows must line up vertically.
- **Pennies everywhere; format at display only.** Use `formatGBP(pennies)` from `schema.js`.
- **Subtle borders over heavy shadows.** Cards use `shadow-xs` + `border-border`. No large dropshadows.
- **Muted accents.** Use the accent colour sparingly — for primary CTAs, active nav, and focus rings. Don't splash indigo across summary cards.
- **Negative amounts use `text-destructive`, positive amounts `text-positive`.** Never red/green colour alone — pair with a `-` sign or bracket notation so colourblind users have a signal.
- **Type hierarchy:** page title `text-2xl font-bold tracking-tight`; section title `text-base font-semibold`; body `text-sm`; captions `text-xs text-muted-foreground`.
- **Spacing rhythm:** 8/12/16/24/32. Prefer the smaller step — tight rows read as professional.
- **Rounded corners:** `rounded-md` (6px) for most things; `rounded-lg` (8px) for cards.
- **Icons:** Lucide only. 16-18px in row contexts, 20-24px in section headers.

## Component library

Shadcn-pattern primitives in `client/src/components/ui/`:

- `Button` — variants: default, accent, destructive, outline, secondary, ghost, link; sizes: default, sm, lg, icon.
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.
- `Badge` — variants: default, secondary, outline, accent, positive, destructive, warning, muted.
- `Input`
- `Separator`
- `Alert`, `AlertTitle`, `AlertDescription` — variants: default, destructive, warning, positive.

Add more (`Select`, `Dialog`, `Tabs`, `DropdownMenu`, `Tooltip`) as each sprint needs them — don't pre-build.

## Patterns

### Hero numbers (Dashboard)

```
<Card>
  <CardHeader>
    <CardDescription>Liquid balance</CardDescription>
    <CardTitle className="text-3xl font-mono tabular-nums">£16,950.00</CardTitle>
  </CardHeader>
</Card>
```

### Data row

```
<div className="flex items-center justify-between py-3 border-b border-border last:border-0">
  <div>
    <div className="font-medium">Barclaycard Platinum</div>
    <div className="text-xs text-muted-foreground">card · priority</div>
  </div>
  <span className="font-mono tabular-nums text-destructive">-£3,200.00</span>
</div>
```

### Subtype badge

```
<Badge variant="muted">card</Badge>
<Badge variant="warning">BT cliff · 4 months</Badge>
<Badge variant="positive">liquid</Badge>
```

## Dark mode (Sprint 7.5)

Add a `.dark` class to `:root` that overrides each colour token with its dark counterpart. Tailwind's `dark:` utilities pick it up automatically. Design intent: same structure as light mode, inverted surface, same accents.

## What this replaces

Phase 1 used ad-hoc Tailwind classes + inline `bg-indigo-600` etc. throughout. Ripping those out in 4c / 4d / 6 as those pages are rebuilt.
