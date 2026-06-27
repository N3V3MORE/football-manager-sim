/**
 * Design tokens — the single source of truth for the app's visual language.
 *
 * DECISION (B1): dark-only. The codebase ships a dark slate palette everywhere
 * and the half-wired light plumbing (`Colors.light`, `useColorScheme`,
 * `useThemeColor` light/dark branches, `ThemedText` light/dark props) is unused
 * by any screen. Rather than maintain a light theme nobody renders, we commit to
 * a single dark surface. The legacy light plumbing is removed in the B4 dead-UI
 * pass; until then these tokens are the canonical dark values screens migrate to.
 *
 * Values are consolidated from the ~200 inline hexes that were hardcoded across
 * screens (3 inconsistent screen tiers `#0a0f1e`/`#0f172a`/`#111827` → one
 * `bg.screen`; scattered slates → a single scale) so the migration in B3 is a
 * behavior-preserving visual refactor, not a redesign.
 */

export const color = {
  bg: {
    /** Deepest surface — screen backgrounds. Collapses #0a0f1e / #111827 / #0f172a. */
    screen: '#0f172a',
    /** Raised surface — cards, headers, list rows. */
    card: '#1e293b',
    /** Highest surface — raised interactive controls (info buttons, active chips). */
    elevated: '#334155',
  },
  border: {
    /** Standard 1px border / divider on card surfaces. */
    default: '#334155',
    /** Subtle divider sitting directly on the screen surface. */
    subtle: '#1e293b',
  },
  text: {
    /** Primary headings and high-emphasis labels. */
    primary: '#f8fafc',
    /** Secondary copy and cell values. */
    secondary: '#cbd5e1',
    /** Muted labels, captions, metadata. */
    muted: '#94a3b8',
    /** Faint subtitles and section labels. */
    faint: '#64748b',
    /** Disabled / placeholder hint text. */
    disabled: '#475569',
  },
  accent: {
    /** De-facto brand accent (sky-400). Used for active states, links, user row. */
    primary: '#38bdf8',
    /** Pressed / deeper accent (sky-500). */
    primaryPressed: '#0ea5e9',
    /** Text/icon placed on top of `accent.primary`. */
    onPrimary: '#0f172a',
    /** Translucent accent wash for subtle highlights (e.g. user table row). */
    dim: '#0ea5e920',
  },
  success: {
    base: '#10B981',
    fg: '#34d399',
    /** Dark green surface for open-status banners / confirm badges. */
    bg: '#065f46',
    /** Pitch / kit surface. */
    bgStrong: '#14532d',
    bgStrongBorder: '#166534',
  },
  warning: {
    base: '#f59e0b',
    /** Brighter yellow for inline highlights (mail badge, sub indicator). */
    fg: '#facc15',
  },
  danger: {
    base: '#ef4444',
    fg: '#fca5a5',
    /** Dark red surface for closed/critical banners. */
    bg: '#7f1d1d',
  },
  info: {
    base: '#60a5fa',
    /** Dark blue surface for pending/in-progress badges. */
    bg: '#1e3a8a',
  },
} as const;

/** Tab bar — consolidated from the hardcoded values in `app/(tabs)/_layout.tsx`. */
export const tabBar = {
  active: color.accent.primary,
  inactive: color.text.muted,
  bg: color.bg.card,
  border: color.border.default,
} as const;

/** 4-pt spacing scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

export const type = {
  caption: { fontSize: 11, fontWeight: '700', lineHeight: 16 },
  body: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  bodyStrong: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  subtitle: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  title: { fontSize: 20, fontWeight: '800', lineHeight: 26 },
  h2: { fontSize: 24, fontWeight: '900', lineHeight: 30 },
  h1: { fontSize: 32, fontWeight: '900', lineHeight: 36 },
} as const;
