// Ramp-style tokens: one chartreuse accent, hairline borders, single font weight (400).
export const C = {
  accent: '#e4f222',
  ink: '#0c0a08',
  obsidian: '#1a1919',
  paper: '#ffffff',
  bone: '#f4f2f0',
  ash: '#6d6c6b',
  hairline: '#e5e7eb',
  smoke: '#d3d3d3',
} as const;

// Radii allowed by the system: buttons/tags 6, inputs 10, wash 12, cards 16.
export const R = { tag: 6, button: 6, input: 10, wash: 12, card: 16 } as const;

export const FONT = 'Inter_400Regular';
export const MAX_WIDTH = 960;
