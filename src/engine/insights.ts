/**
 * THE "WHAT IT HAS LEARNED" PAGE: turns a profile into 8-16 plain sentences,
 * strongest first. Each line has a stable key ('genre:comedy',
 * 'keyword:sitcom', 'trait:dropIn') that a manual correction can be pinned to.
 *
 * Strength combines what the favourites have in common with what swipes and
 * an imported watch history have taught; a manual correction overrides all of
 * them. A line that comes mainly from the watch history says so ("You watch a
 * lot of...") rather than talking about swipes.
 */
import type { Catalog, Profile, TasteInsight } from '../contracts';
import { getIndex, NICHES, type NicheId } from './catalogIndex';
import { phraseForKey } from './phrases';
import { getFavModel, IMPORT_GENRE, IMPORT_KEYWORD, IMPORT_TRAIT, isImportKey } from './taste';
import { clamp, round4 } from './util';

const MAX_LINES = 16;
const QUOTA: Record<string, number> = { genre: 6, keyword: 7, trait: 3 };
/** How much a learned weight counts next to the favourites when judging strength. */
const LEARNED_GAIN = 1.6;
/** The same for what a watch-history import taught (its weights top out at 0.5, so a line from it alone reaches about 0.6). */
const IMPORTED_GAIN = 1.2;
/** Traits worth stating from favourites alone (the rest only appear once swipes say so). */
const FAVOURITE_TRAITS = ['dropIn', 'serialized', 'short', 'hourlong', 'kind:movie'];

interface Draft {
  key: string;
  kind: 'genre' | 'keyword' | 'trait';
  fromFavs: number;
  /** From swipes. */
  learned: number;
  /** From an imported watch history. */
  imported: number;
}

function sentence(phrase: string, strength: number, source: TasteInsight['source'], correction: TasteInsight['correction'], watched: 'no' | 'theme' | 'habit'): string {
  if (correction === 'more') return `More ${phrase}, as you asked`;
  if (correction === 'less') return `Less ${phrase}, as you asked`;
  if (strength < 0) return strength <= -0.4 ? `You steer clear of ${phrase}` : `You've been skipping ${phrase}`;
  if (source === 'learned' && watched === 'habit') return `You often go for ${phrase}`;
  if (source === 'learned' && watched === 'theme') return strength >= 0.55 ? `You watch a lot of ${phrase}` : `You often watch ${phrase}`;
  if (source === 'learned') return strength >= 0.55 ? `You keep saying yes to ${phrase}` : `You've been saying yes to ${phrase}`;
  if (strength >= 0.6) return `You love ${phrase}`;
  if (strength >= 0.42) return `You're drawn to ${phrase}`;
  return `You lean towards ${phrase}`;
}

export function describeTaste(profile: Profile, catalog: Catalog): TasteInsight[] {
  const index = getIndex(catalog);
  const fav = getFavModel(catalog, profile.favorites);
  const taste = profile.taste;
  const drafts = new Map<string, Draft>();
  const draft = (key: string, kind: Draft['kind']): Draft => {
    let d = drafts.get(key);
    if (!d) {
      d = { key, kind, fromFavs: 0, learned: 0, imported: 0 };
      drafts.set(key, d);
    }
    return d;
  };

  // ---- what the favourites have in common ----
  const nFav = fav.favs.length;
  if (nFav >= 2) {
    for (const [g, share] of fav.genreShare) {
      if (share * nFav >= 2) draft(`genre:${g}`, 'genre').fromFavs = clamp(0.2 + 0.9 * share);
    }
    for (const [k, count] of fav.kwCount) {
      // Rarer themes say more about a person than ones half the catalog shares.
      if (count >= 2) draft(`keyword:${k}`, 'keyword').fromFavs = clamp(0.18 + 0.9 * (count / nFav) + 0.2 * index.kwWeight(k));
    }
    for (const t of FAVOURITE_TRAITS) {
      const share = fav.traitShare.get(t) ?? 0;
      const needed = t === 'kind:movie' ? 0.3 : 0.5;
      if (share >= needed) draft(`trait:${t}`, 'trait').fromFavs = clamp(0.1 + 0.6 * share);
    }
  }

  // ---- acquired tastes the favourites don't include (held back until shown otherwise) ----
  const heldBack = new Map<string, NicheId>();
  for (const n of Object.keys(NICHES) as NicheId[]) {
    if (fav.niches.has(n) || nFav === 0) continue;
    const d = draft(NICHES[n].key, n === 'anime' ? 'keyword' : 'genre');
    d.fromFavs = -0.3;
    heldBack.set(d.key, n);
  }

  // ---- what swipes have taught ----
  for (const [g, w] of Object.entries(taste?.genres ?? {})) if (typeof w === 'number') draft(`genre:${g}`, 'genre').learned = w;
  for (const [k, w] of Object.entries(taste?.keywords ?? {})) draft(`keyword:${k}`, 'keyword').learned = w;
  for (const [t, w] of Object.entries(taste?.traits ?? {})) {
    if (typeof w !== 'number' || !Number.isFinite(w)) continue;
    if (!isImportKey(t)) draft(`trait:${t}`, 'trait').learned = w;
    // ---- what an imported watch history has taught ----
    else if (t.startsWith(IMPORT_GENRE)) draft(`genre:${t.slice(IMPORT_GENRE.length)}`, 'genre').imported = w;
    else if (t.startsWith(IMPORT_KEYWORD)) draft(`keyword:${t.slice(IMPORT_KEYWORD.length)}`, 'keyword').imported = w;
    else if (t.startsWith(IMPORT_TRAIT)) draft(`trait:${t.slice(IMPORT_TRAIT.length)}`, 'trait').imported = w;
  }

  // ---- manual corrections always get a line ----
  const corrections = taste?.corrections ?? {};
  for (const key of Object.keys(corrections)) {
    const kind = key.slice(0, key.indexOf(':'));
    if (kind === 'genre' || kind === 'keyword' || kind === 'trait') draft(key, kind);
  }

  const lines: (TasteInsight & { kind: string })[] = [];
  for (const d of drafts.values()) {
    const phrase = phraseForKey(d.key);
    if (!phrase) continue;
    const correction = corrections[d.key] === 'more' || corrections[d.key] === 'less' ? corrections[d.key] : null;
    const learnedTotal = clamp(d.learned + d.imported, -1, 1);
    const learnedPart = clamp(LEARNED_GAIN * d.learned + IMPORTED_GAIN * d.imported, -LEARNED_GAIN, LEARNED_GAIN);
    // A held-back acquired taste comes off hold as soon as swipes (or their watch history) show interest.
    const favPart = heldBack.has(d.key) && learnedTotal > 0 ? Math.min(0, d.fromFavs + learnedTotal * 2) : d.fromFavs;
    let strength = clamp(favPart + learnedPart, -1, 1);
    let source: TasteInsight['source'] = Math.abs(learnedPart) >= 0.06 && Math.abs(learnedPart) >= Math.abs(favPart) * 0.75 ? 'learned' : 'favorites';
    if (correction) {
      source = 'corrected';
      strength = correction === 'more' ? Math.max(0.9, strength) : Math.min(-0.9, strength);
    } else if (Math.abs(strength) < 0.06) {
      continue; // no real opinion
    } else if (source === 'favorites' && favPart === 0) {
      continue;
    }
    const held = heldBack.get(d.key);
    const text =
      held && !correction && source === 'favorites' && strength < 0
        ? `None of your favourites are ${NICHES[held].label}, so you'll see very little of it`
        : sentence(phrase, strength, source, correction, d.imported > Math.abs(d.learned) ? (d.kind === 'trait' ? 'habit' : 'theme') : 'no');
    lines.push({ key: d.key, kind: d.kind, text, strength: round4(strength), source, correction });
  }

  // Strongest first; corrections are always kept; the rest fill per-kind quotas so
  // the page is a mix of genres, themes and habits rather than sixteen keywords.
  lines.sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength) || (a.key < b.key ? -1 : 1));
  const used: Record<string, number> = {};
  const seenText = new Set<string>();
  const kept: TasteInsight[] = [];
  const overflow: TasteInsight[] = [];
  for (const { kind, ...line } of lines) {
    const dup = seenText.has(line.text);
    if (line.correction) {
      kept.push(line);
      seenText.add(line.text);
      continue;
    }
    if (dup) continue; // two keywords that read the same (e.g. "book adaptations")
    if ((used[kind] ?? 0) < (QUOTA[kind] ?? 3)) {
      used[kind] = (used[kind] ?? 0) + 1;
      kept.push(line);
      seenText.add(line.text);
    } else {
      overflow.push(line);
    }
  }
  let out = kept.slice(0, Math.max(MAX_LINES, kept.filter((l) => l.correction).length));
  // If quotas left the page short, top it up with the strongest of what was held back.
  for (const line of overflow) {
    if (out.length >= 8) break;
    if (!seenText.has(line.text)) {
      out.push(line);
      seenText.add(line.text);
    }
  }
  out = out.sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength) || (a.key < b.key ? -1 : 1));
  return out;
}
