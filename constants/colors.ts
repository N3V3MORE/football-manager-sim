// Note: useShallow from zustand/react/shallow should be adopted across the app
// for store subscriptions to prevent unnecessary re-renders:
//   import { useShallow } from 'zustand/react/shallow';
//   const { a, b } = useGameStore(useShallow(state => ({ a: state.a, b: state.b })));

export const Colors = {
  bg: '#0f172a',
  bgCard: '#1e293b',
  bgSurface: '#334155',
  bgDark: '#111827',

  accent: '#38bdf8',
  accentMuted: '#94a3b8',

  text: '#f8fafc',
  textMuted: '#94a3b8',
  textDim: '#64748b',
  textLight: '#cbd5e1',

  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  orange: '#f97316',

  white: '#ffffff',
} as const;
