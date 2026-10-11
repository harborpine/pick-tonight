/** Small builders shared by the sync tests. */
import { DEFAULT_PLANS, type DeckCard, type HouseholdSeed, type PersonId, type Profile, type SuggestRequest, type TitleSnapshot } from '../contracts';

export const profile = (id: PersonId, favorites: string[] = []): Profile => ({
  id,
  favorites,
  dealbreakers: { horror: id === 'BG', trueCrime: id === 'BG', scary: id === 'BG' },
  taste: { genres: {}, keywords: {}, traits: {}, corrections: {} },
  onboarded: false,
});

export const seed = (): HouseholdSeed => ({
  profiles: { HG: profile('HG', ['tv-1']), BG: profile('BG', ['tv-2']) },
  settings: { plans: { ...DEFAULT_PLANS } },
});

export const card = (itemId: string): DeckCard => ({
  itemId,
  pick: { type: 'movie' },
  service: { serviceId: 'netflix', planId: 'standard', adFree: true },
  minutes: 100,
  score: 1,
  reasons: ['Because you love Scrubs'],
});

export const snap = (title = 'A Movie'): TitleSnapshot => ({ title, year: 2020, poster: null });

export const request: SuggestRequest = {
  who: 'Together',
  viewing: 'focused',
  mood: 'laugh',
  time: 120,
  novelty: 'either',
  genre: null,
};
