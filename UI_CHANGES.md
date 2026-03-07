# WebtopKids UI Upgrade — Design-Only Changes

## Summary of Changes

### Design tokens & base
- **CSS variables** for spacing (`--space-xs` to `--space-4xl`), typography (`--text-xs` to `--text-2xl`), radius (`--radius-sm` to `--radius-full`), shadows (`--shadow-card`, `--shadow-card-hover`), and tap target (`--tap-min: 44px`).
- **`prefers-reduced-motion`** support: shorter transitions and disabled animations when the user prefers reduced motion.
- **Base typography**: `html` font-size 16px, `body` line-height 1.6 for readability.

### Accessibility
- **Focus states** (`:focus-visible`) for buttons, tabs, link cards, modal close, and photo picker options — 2px blue outline with offset.
- **Tap targets**: Buttons and tabs meet 44px minimum height on mobile.

### Typography & sizing
- **Card titles**: 1.125rem (18px) on mobile, 1.2rem on desktop.
- **Card description**: 1rem (16px) on mobile, 1.0625rem on desktop.
- **Last-update text**: 0.875rem instead of 0.72rem for better contrast.
- **Empty states**: Larger icon (3rem), `--text-secondary` for contrast, more padding.

### Buttons & controls
- **Refresh & theme buttons**: 44×44px (was 40×40), `--radius-md`.
- **Section tabs (`.stab`)**: `min-height: 44px`, `--text-sm` (0.875rem), `--radius-sm`.
- **Filter tabs (`.tab`)**: `min-height: 44px`.
- **Mark-done button**: `min-height: 44px`.

### Section tabs
- **Horizontal scroll** on mobile: `overflow-x: auto`, `scroll-snap-type: x mandatory`, `scroll-snap-align: start` on each tab.
- **Scrollbar hidden** for a cleaner look.
- **Gap and padding** use design tokens.

### Cards
- **Softer shadow**: `var(--shadow-card)` and `var(--shadow-card-hover)` on hover.
- **Rounded corners**: `--radius-lg` (16px).
- **Subtle border**: `1px solid var(--border)`.
- **Hover**: Slight translate and shadow on desktop; `:active` scale on mobile for pressed feedback.

### Logo banner (hero)
- **Larger hero**: Padding 1.5rem 1.25rem, gap 1.25rem.
- **Logo**: 100×100px, `--radius-lg`.
- **Brand name**: 1.75rem, letter-spacing 0.08em.
- **Gradient**: `linear-gradient(135deg, #0a0f1e 0%, #0d1529 35%, #1a2235 100%)`.

### Modal (bottom sheet)
- **Title**: 1.5rem (was 1.25rem).
- **Content padding**: 1rem 1.5rem 2.5rem.
- **Close button**: 40×40px (was 32×32).
- **Handle**: 48×5px, `--radius-sm`.
- **Animation**: Uses `--transition-normal`.

### Dark mode
- **Background**: `--bg-body: #0f172a` (deep gray instead of pure black).
- **Surfaces**: Kept for clear hierarchy.

### Light theme
- **Contrast**: `--text-muted` and `--text-secondary` tuned for readability.

---

## HTML Changes

**None.** No HTML structure, IDs, classes used by logic, or data attributes were changed. The `style.css?v=7` cache-bust parameter was updated to ensure new styles load.

---

## QA Notes (Tested Viewports)

| Viewport   | Notes |
|-----------|-------|
| 360×800   | Tabs scroll horizontally with snap; cards full width; buttons 44px; RTL correct. |
| 768×1024  | Tabs wrap or scroll; cards readable; modal fits. |
| 1440×900  | Content centered; max-width 960px; cards with hover states. |

**Verify**: Light/dark themes, modal open/close, RTL alignment, pull-to-refresh, all sections.

---

## Extra UI Ideas (No Logic Changes)

1. **Primary action emphasis** — Make the refresh button more prominent (e.g. primary blue) as the main sync action.
2. **Micro-animations** — Subtle transitions on tab switch, card hover, and modal open/close (already partially in place; `prefers-reduced-motion` respected).
3. **Skeleton loading (CSS only)** — Add `.skeleton` class with shimmer for cards/sections during load, without JS changes.
4. **Tab scroll hint** — Fade gradient at tab edges to indicate more tabs when horizontally scrollable.
5. **Subject color system** — Use type classes to add soft left-border or header colors per subject.
6. **Date hierarchy** — Larger typography and spacing for calendar dates and schedule headers.
7. **Child avatar** — Circular avatar in header (already present); ensure 44px min for tap target.
8. **Spacing system** — Use `--space-*` tokens consistently across components.
9. **Dark mode polish** — Ensure card backgrounds, shadows, and borders are consistent in dark theme.
10. **Empty states** — Add a simple icon block and clearer call-to-action styling where empty states exist.
