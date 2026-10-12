/**
 * Curated corrections for famous titles where the rule-based tags misfire.
 * Matched by kind + normalised title (+ year when given, so remakes don't collide).
 * Keep this short and objective: only corrections that are right for anyone, not matters of taste.
 */
import type { Attention, MoodId, TitleKind } from '../../src/contracts/catalog';

export interface Override {
  kind: TitleKind;
  title: string;
  year?: number;
  attention?: Attention;
  dropIn?: boolean;
  flags?: { horror?: boolean; trueCrime?: boolean; scary?: boolean };
  moods?: Partial<Record<MoodId, number>>;
}

const NOT_SCARY = { horror: false, scary: false };

export const OVERRIDES: Override[] = [
  // Complicated, so Focused only.
  { kind: 'tv', title: 'Game of Thrones', attention: 'high' },
  { kind: 'tv', title: 'Dark', year: 2017, attention: 'high' },
  { kind: 'tv', title: 'Succession', attention: 'high' },
  { kind: 'movie', title: 'Inception', attention: 'high' },
  { kind: 'movie', title: 'Tenet', attention: 'high' },
  { kind: 'tv', title: 'Severance', attention: 'high' },
  { kind: 'tv', title: 'Westworld', attention: 'high' },
  { kind: 'tv', title: 'Lost', year: 2004, attention: 'high' },
  { kind: 'tv', title: 'House of the Dragon', attention: 'high' },
  { kind: 'tv', title: 'Black Mirror', attention: 'high', dropIn: true },
  { kind: 'tv', title: 'Squid Game', attention: 'high', dropIn: false },
  { kind: 'tv', title: 'The White Lotus', attention: 'medium', dropIn: false },
  { kind: 'tv', title: 'Jeopardy!', attention: 'low', dropIn: true },
  { kind: 'tv', title: 'Wheel of Fortune', attention: 'low', dropIn: true },
  { kind: 'tv', title: "RuPaul's Drag Race", attention: 'low', dropIn: true },
  { kind: 'tv', title: "The Devil's Plan", attention: 'high' },

  // Easy to follow, drop-in.
  { kind: 'tv', title: 'Family Guy', attention: 'low', dropIn: true },
  { kind: 'tv', title: 'The Simpsons', attention: 'low', dropIn: true },
  { kind: 'tv', title: 'South Park', attention: 'low', dropIn: true },
  { kind: 'tv', title: 'American Dad!', attention: 'low', dropIn: true },
  { kind: 'tv', title: 'Futurama', attention: 'low', dropIn: true },
  { kind: 'tv', title: 'Friends', attention: 'low', dropIn: true },
  { kind: 'tv', title: 'The Office', year: 2005, attention: 'low', dropIn: true },
  { kind: 'tv', title: 'The Great British Bake Off', attention: 'low', dropIn: true, moods: { cozy: 0.95, feelgood: 0.85, brainoff: 0.85 } },
  { kind: 'tv', title: 'The Great British Baking Show', attention: 'low', dropIn: true, moods: { cozy: 0.95, feelgood: 0.85, brainoff: 0.85 } },
  { kind: 'tv', title: 'Summer House', attention: 'low', dropIn: true },
  { kind: 'tv', title: 'Love Island', year: 2019, attention: 'low', dropIn: true },
  { kind: 'tv', title: 'Love Island USA', attention: 'low', dropIn: true },
  { kind: 'tv', title: 'You', year: 2018, attention: 'medium' },

  // Gripping, but the rule-based moods under-rate them.
  { kind: 'tv', title: 'Breaking Bad', moods: { gripped: 0.95, cry: 0.2 } },
  { kind: 'tv', title: 'Better Call Saul', moods: { gripped: 0.9, cry: 0.2 } },
  { kind: 'tv', title: 'The Bear', moods: { cry: 0.35 } },

  // Thrillers and dramas that are tense, not frightening: the keyword rules over-flag them as scary.
  { kind: 'tv', title: 'Killing Eve', flags: NOT_SCARY },
  { kind: 'tv', title: 'You', year: 2018, flags: NOT_SCARY },
  { kind: 'tv', title: 'How to Get Away with Murder', flags: NOT_SCARY },
  { kind: 'tv', title: 'Scandal', year: 2012, flags: NOT_SCARY },
  { kind: 'movie', title: 'The Hunger Games', flags: NOT_SCARY },
  { kind: 'movie', title: 'Gone Girl', flags: { horror: false } },

  // Scary even though not tagged horror.
  { kind: 'tv', title: 'Stranger Things', flags: { scary: true } },
  { kind: 'tv', title: 'American Horror Story', flags: { horror: true, scary: true } },
  { kind: 'tv', title: 'Dexter', flags: { scary: true } },
  { kind: 'tv', title: 'Mindhunter', flags: { scary: true } },
  { kind: 'tv', title: 'The Walking Dead', flags: { horror: true, scary: true } },

  // True crime that TMDB doesn't tag as such.
  { kind: 'tv', title: 'Dateline NBC', flags: { trueCrime: true } },
  { kind: 'tv', title: 'Dateline', flags: { trueCrime: true } },
  { kind: 'tv', title: '48 Hours', flags: { trueCrime: true } },
  { kind: 'tv', title: 'Unsolved Mysteries', flags: { trueCrime: true } },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** All matching entries merged (later entries win field by field). */
export function findOverride(kind: TitleKind, title: string, year: number): Override | undefined {
  const n = norm(title);
  const hits = OVERRIDES.filter((o) => o.kind === kind && norm(o.title) === n && (o.year === undefined || o.year === year));
  if (!hits.length) return undefined;
  return hits.reduce((a, b) => ({ ...a, ...b, flags: { ...a.flags, ...b.flags }, moods: { ...a.moods, ...b.moods } }));
}
