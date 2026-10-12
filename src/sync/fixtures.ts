/** Small builders shared by the sync tests. */
import {
  NO_DEALBREAKERS,
  type DeckCard,
  type NewProfile,
  type Settings,
  type SuggestRequest,
  type TitleSnapshot,
  type Who,
  normalizeWho,
} from '../contracts';

export const profile = (favorites: string[] = [], horror = false): NewProfile => ({
  favorites: favorites.map((id) => ({ id, kind: 'tv', title: id, year: 2020, genres: [], keywords: [], poster: null })),
  dealbreakers: { ...NO_DEALBREAKERS, horror, genres: [] },
  taste: { genres: {}, keywords: {}, traits: {}, corrections: {} },
  onboarded: false,
});

export const settings = (): Settings => ({ plans: { netflix: 'standard', hulu: 'ads' } });

export const card = (itemId: string): DeckCard => ({
  itemId,
  pick: { type: 'movie' },
  service: { serviceId: 'netflix', planId: 'standard', adFree: true },
  minutes: 100,
  score: 1,
  reasons: ['Because you love Scrubs'],
});

export const snap = (title = 'A Movie'): TitleSnapshot => ({ title, year: 2020, poster: null });

export const requestFor = (who: Who | string[]): SuggestRequest => ({
  who: normalizeWho(who),
  viewing: 'focused',
  mood: 'laugh',
  time: 120,
  novelty: 'either',
  genre: null,
});
