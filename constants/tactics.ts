import { TeamTactics } from '@/src/models/types';

export interface TacticSection {
  key: keyof TeamTactics;
  title: string;
  options: string[];
  descriptions: Record<string, string>;
}

export const TACTIC_SECTIONS: TacticSection[] = [
  {
    key: 'mentality',
    title: 'Mentality',
    options: ['Defensive', 'Balanced', 'Attacking'],
    descriptions: {
      Defensive: 'Focus on shape and discipline. Lower goal threat but 15% better defense.',
      Balanced: 'Standard approach. No specific stat bonuses or penalties.',
      Attacking: 'Push players forward. Increased shooting accuracy but vulnerable to counters.',
    },
  },
  {
    key: 'passingStyle',
    title: 'Passing Style',
    options: ['Short', 'Mixed', 'Direct'],
    descriptions: {
      Short: 'Patient buildup. Higher pass completion but fewer direct balls.',
      Mixed: 'A balanced blend of short and direct passing.',
      Direct: 'Bypass midfield more often. More through-balls, more risk.',
    },
  },
  {
    key: 'tempo',
    title: 'Tempo',
    options: ['Slow', 'Normal', 'Fast'],
    descriptions: {
      Slow: 'Control the game and conserve more energy.',
      Normal: 'Standard rhythm and frequency of play.',
      Fast: 'Higher intensity and chance creation, but burns more energy.',
    },
  },
  {
    key: 'defensiveLine',
    title: 'Defensive Line',
    options: ['Deep', 'Standard', 'High'],
    descriptions: {
      Deep: 'Protect space behind the defense but concede more midfield territory.',
      Standard: 'Balanced defensive positioning.',
      High: 'Compress the pitch, but risk through-balls behind.',
    },
  },
  {
    key: 'pressing',
    title: 'Pressing',
    options: ['None', 'Medium', 'High'],
    descriptions: {
      None: 'Sit off and conserve energy.',
      Medium: 'Press selectively.',
      High: 'Aggressive pressure with higher energy cost.',
    },
  },
];
