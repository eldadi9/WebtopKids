# WebtopKids UI Upgrade — March 4, 2025

## Phase 0 — Current UI Structure Summary

### Main UI Areas
- **Pull-to-refresh (PTR)**: Fixed top bar, slides down when pulling
- **Logo banner**: Full-width hero (mobile only), logo + brand name, scrolls away
- **Loading overlay**: Centered spinner + logo during data load
- **Sticky top bar**: Header, stats bar, insights bar, section tabs
- **Header**: App logo, student info (name, avatar, switcher pills, add-photo), update timestamps, theme toggle, refresh button
- **Stats bar**: Stat chips (homework count, etc.)
- **Insights bar**: Smart chips (overdue, soon, alerts, ok)
- **Section tabs**: 8 tabs (homework, alerts, grades, calendar, approvals, messages, feed, external)
- **Page sections**: Single-column card lists per section
- **Cards**: Type-colored left border, header, meta, description, badges, mark-done button
- **Modals**: Detail modal (bottom sheet), crop modal (photo positioning)
- **Error banner**: Shown when daemon not running

### Main Issues for Child Usability (Before Upgrade)
- Card titles too small on mobile (~15px)
- Tabs cramped, font size ~11px on mobile
- Weak contrast on muted text (#64748b)
- Student pills and stat chips very small
- Logo banner modest height (140px)
- Card shadows subtle, corners standard
- Refresh button looked like secondary action
- Section titles small (0.88rem)
- Empty state icon and text modest

---

## Phase 1 — Backups

- **Location**: `public/backup_ui_20250304_1500/`
- **Files**: `index.html`, `style.css`
- Backups created before any edits.

---

## Phase 2–3 — Changes Implemented

### A. Typography & Sizing
- **Design tokens**: Added `--text-card-mobile` (18px), `--text-card-desktop` (20px), `--text-3xl`, `--space-5xl`, `--tap-min-lg` (48px)
- **Line height**: `--line-height-content` increased to 1.65
- **Card titles**: Mobile 1.125rem (18px), desktop 1.25rem (20px)
- **Section titles**: 1rem, bolder
- **Empty state**: Icon 4rem, text 1.1rem, more padding

### B. Tap Targets & Buttons
- All interactive elements keep min 44px height
- **Refresh button**: Primary style (blue gradient, white text) for clear primary action
- **Student pills**: Font 0.82rem, padding 0.28rem 0.65rem
- **Stat chips**: Font 0.85rem, padding 0.28rem 0.7rem
- **Filter tabs**: Min-height 44px

### C. Logo Banner (Hero)
- **Height**: min-height 180px (was 140px)
- **Gradient**: Stronger gradient (145deg, deeper blues)
- **Logo**: 112px (was 96px), stronger shadow
- **Brand name**: 1.75rem (28px), letter-spacing 0.08em

### D. Cards
- **Radius**: 18px base, 20px on desktop
- **Shadows**: Softer (`--shadow-card`, `--shadow-card-hover`, `--shadow-card-pressed`)
- **Border**: 1px solid, 4px accent on right (RTL)
- **Hover**: translateX(-3px), stronger shadow
- **Pressed** (touch): scale(0.99), pressed shadow
- **Spacing**: More padding, card-list gap 0.85rem

### E. Section Tabs
- **Size**: min-width 100px, font 0.9rem, padding increased
- **Scroll**: Horizontal scroll with snap, gradient fade at edges (mask-image)
- **Active**: Stronger blue, font-weight 700

### F. Accessibility
- **Focus**: 3px outline, 3px offset (was 2px)
- **Contrast**: `--text-secondary` lightened to #a8b8cc (was #94a3b8)
- **Focus-visible**: Applied to all interactive elements

### G. Modal (Bottom Sheet)
- **Title**: 1.35rem on desktop, 1.2rem on mobile
- **Content padding**: Increased
- **Close button**: 44px min, clear hover
- **Primary action** (btn-done-modal): min-height 52px, larger font

### H. Dark Mode
- **Backgrounds**: Deep grays (#0f172a, #111827, #1a2235) — no pure black
- **Card surfaces**: Layered for depth
- **Borders**: Subtle, consistent

### I. Spacing System
- **single-col**: padding `var(--space-xl) var(--space-2xl)`, gap `var(--space-lg)`
- **card-list**: gap 0.85rem
- **section-title**: padding-bottom 0.5rem

### J. Mobile Breakpoints
- **640px**: Card titles 1.125rem, single-col padding adjusted
- **360px**: Stab font 0.8rem (was 0.68rem) for readability
- **Landscape**: Kept compact rules for small height

---

## Phase 3 — HTML Changes

**None.** All changes were CSS-only. No IDs, classes used by JS, or structure were modified.

**Cache bust**: `style.css?v=8` in `index.html` to force fresh load of new styles.

---

## Phase 4 — Visual QA Checklist

| Breakpoint   | Tabs        | Cards       | Buttons   | RTL  | Modal | Themes |
|-------------|-------------|-------------|-----------|------|-------|--------|
| 360×800     | ✓ scroll    | ✓ readable  | ✓ 44px    | ✓    | ✓     | ✓      |
| 768×1024    | ✓           | ✓           | ✓         | ✓    | ✓     | ✓      |
| 1440×900    | ✓           | ✓           | ✓         | ✓    | ✓     | ✓      |

---

## Extra UI Ideas (No Logic Changes)

1. **Primary action bar**: Style refresh as floating action button on mobile (CSS-only, if wrapper exists)
2. **Micro-animations**: Tab switch fade, card appear stagger (CSS `@keyframes` + `animation-delay`)
3. **Skeleton loading**: `.skeleton` class with shimmer for card placeholders (CSS only)
4. **Subject colors**: Map subject names to soft palette for card left border (requires data attribute from JS — optional)
5. **Date hierarchy**: Larger `.cal-date-header`, `.section-title` for schedule scan
6. **Avatar styling**: Circular border, soft shadow (already partially done)
7. **Spacing variables**: Expand `--space-*` scale for more consistency
8. **Dark mode polish**: Slightly lighter card surfaces for better separation
9. **Empty states**: Optional illustration or larger icon block
10. **Reduced motion**: Already respected via `prefers-reduced-motion`

---

## Files Modified

- `public/style.css` — All visual upgrades
- `public/index.html` — Cache param `style.css?v=8` only

## Backup Location

- `public/backup_ui_20250304_1500/index.html`
- `public/backup_ui_20250304_1500/style.css`
