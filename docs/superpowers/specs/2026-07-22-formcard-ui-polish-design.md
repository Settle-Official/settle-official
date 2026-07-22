# FormCard UI polish: remove number spinner, themed custom dropdown

## Problem

In `src/components/FormCard.tsx`:

1. The "AMOUNT IN USDC" field (`type="number"`) shows the browser's native up/down
   spinner arrows, which don't match the app's design.
2. `SelectField` (used for both "OFFRAMP CURRENCY" and "BANK") is a styled native
   `<select>` — the closed trigger is themed, but the open options list is the
   browser's unstyled native dropdown, which looks out of place against the rest
   of the UI.

## Scope

Both fixes are contained to `src/components/FormCard.tsx`. No other files change.
`SelectField` is shared by both the currency and bank selects, so upgrading it
fixes both consistently in one change.

## Fix 1: Remove the number input spinner

In `InputField`'s `<input>` element, add Tailwind arbitrary-variant classes to
suppress the native spinner across browsers:

- `[appearance:textfield]` (Firefox)
- `[&::-webkit-inner-spin-button]:appearance-none` and
  `[&::-webkit-outer-spin-button]:appearance-none` with `:m-0` (WebKit/Blink)

These only affect `type="number"` rendering — a no-op for the `type="text"` uses
of the same component (e.g. "ACCOUNT NUMBER").

## Fix 2: Custom-themed dropdown for SelectField

Replace the native `<select>` inside `SelectField` with a small hand-rolled
dropdown component (no new dependency — the option lists here, currencies and
banks, are short enough that a headless combobox library would be overkill):

- **Trigger**: a `<button>` styled identically to the current closed-select box
  (46px height, `border-[var(--line)]`, accent chevron icon), showing the
  selected option's label or the existing placeholder/loading text.
- **Panel**: rendered only while open, absolutely positioned directly below the
  trigger, dark background matching the theme, each option as a button row with
  accent-colored hover and selected states, `max-h` + `overflow-y-auto` so a long
  bank list scrolls instead of overflowing the page.
- **Dismissal**: closes on outside click (document `mousedown` listener checked
  against a container `ref`) and on `Escape`.
- **Explicit non-goal**: no arrow-key roving-tabindex navigation — this is a
  simple option-picker, not a full accessible combobox. Click/Enter/Escape only.
- Keeps the existing `SelectFieldProps` interface (`label`, `value`, `onChange`,
  `options`, `isLoading`) unchanged, so both call sites (currency, bank) need no
  changes beyond the component's internals.

## Testing

No test framework in this repo (consistent with the rest of the codebase).
Verify manually in the browser: number field shows no spinner in Chromium and
matches on scroll-wheel-over-focused-input (no value change); both dropdowns
open with themed styling, select an option, close on outside click and Escape,
and the selected value flows through exactly as before (currency change still
resets bank/account name; bank selection still enables account verification).
