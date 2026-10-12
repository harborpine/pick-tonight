import { expect, test, type Page } from '@playwright/test';
import {
  HIGH_ATTENTION,
  OFF_PLAN,
  SAMPLE,
  SCARY_TITLES,
  act,
  ask,
  availableMoods,
  catalogRows,
  currentCardId,
  engineDecks,
  findCard,
  joinAs,
  pageThroughDeck,
  parseMinutes,
  quickHousehold,
  request,
  seenBy,
  sharedState,
  settle,
  setPlans,
  setProfile,
  startTogether,
  subsets,
  tid,
  toAsk,
  wtw,
  type Household,
  type MemberSpec,
} from '../helpers/app';

/**
 * The nine rules from SPEC.md as a user would meet them, on the sample catalog, for households of 1, 2, 3 and 4.
 * Every audience (every non-empty group of members) is checked against the engine's full decks, and the main ones are
 * also walked through on screen.
 */
const DEE: MemberSpec = { name: 'Dee', dealbreakers: { subtitled: true } };
const MEMBERS: Record<number, MemberSpec[]> = {
  1: [SAMPLE[0]],
  2: [SAMPLE[0], SAMPLE[1]],
  3: SAMPLE,
  4: [...SAMPLE, DEE],
};
const SIZES = [1, 2, 3, 4];
const MOODS = ['laugh', 'cozy', 'brainoff', 'gripped', 'feelgood', 'think', 'romantic', 'cry', 'hyped'];

async function setup(page: Page, n: number): Promise<{ h: Household; ids: string[]; byName: Record<string, string> }> {
  const h = await quickHousehold(page, MEMBERS[n]);
  const ids = MEMBERS[n].map((m) => h.ids[m.name]);
  return { h, ids, byName: h.ids };
}
const idsOf = (deck: { id: string }[]) => deck.map((c) => c.id);

for (const n of SIZES) {
  test.describe(`household of ${n}`, () => {
    test(`rule 1: nothing off the household's plans is ever suggested; it appears once the plan is added, and goes when removed`, async ({ page }) => {
      const { ids } = await setup(page, n);
      const audiences = subsets(ids);
      const reqs = audiences.flatMap((who) => ['laugh', 'gripped', 'feelgood'].map((mood) => request(who, { mood, time: 'any', novelty: 'either' })));
      const decks = await engineDecks(page, reqs);
      expect(decks.some((d) => d.length > 10), 'control: decks are not empty').toBe(true);
      for (const [i, d] of decks.entries()) for (const id of OFF_PLAN) expect(idsOf(d), `${id} for ${JSON.stringify(reqs[i].who)}/${reqs[i].mood}`).not.toContain(id);

      // every card is on a service the household pays for, in the plan it has
      const rows = await catalogRows(page);
      const plans = (await sharedState(page)).settings.plans as Record<string, string>;
      for (const d of decks) {
        for (const c of d) expect(Object.keys(plans), `${c.id} is shown on ${c.service}`).toContain(c.service);
        for (const c of d) expect(rows[c.id].providers.length).toBeGreaterThan(0);
      }

      // Poker Face is on Peacock Premium Plus only: choose that plan and it can be suggested
      await setPlans(page, { ...plans, peacock: 'premium-plus' });
      const withPlus = await engineDecks(page, [request([ids[0]], { mood: 'gripped', time: 'any', novelty: 'either' })]);
      expect(idsOf(withPlus[0])).toContain('tv-120998');
      // ...and when the household drops Hulu, nothing that is only on Hulu is suggested any more
      const hulu = Object.values(rows).filter((r) => r.providers.length === 1 && r.providers[0] === 15).map((r) => r.id);
      expect(hulu.length).toBeGreaterThan(3);
      const before = await engineDecks(page, [request([ids[0]], { mood: 'laugh', time: 'any' })]);
      expect(hulu.some((id) => idsOf(before[0]).includes(id)), 'control: Hulu-only titles are suggested while Hulu is on').toBe(true);
      await setPlans(page, { ...plans, peacock: 'premium-plus', hulu: null });
      const after = await engineDecks(page, [request([ids[0]], { mood: 'laugh', time: 'any' })]);
      for (const id of hulu) expect(idsOf(after[0]), id).not.toContain(id);
      // restoring the earlier plan takes Poker Face away again
      await setPlans(page, plans);
      const back = await engineDecks(page, [request([ids[0]], { mood: 'gripped', time: 'any' })]);
      expect(idsOf(back[0])).not.toContain('tv-120998');
    });

    test('rule 2: a watcher\'s never-show-me choices (scary, a whole genre, not in English) exclude titles for every audience with them in it, and only those', async ({ page }) => {
      const { ids, byName } = await setup(page, n);
      const rows = await catalogRows(page);
      const sam = byName.Sam;
      const kit = byName.Kit;
      const dee = byName.Dee;
      // Kit never wants reality TV (a whole genre)
      if (kit) await setProfile(page, kit, { dealbreakers: { genres: ['reality'] } });
      const audiences = subsets(ids);
      const decks = await engineDecks(page, audiences.map((who) => request(who, { mood: 'gripped', time: 'any', novelty: 'either' })));
      const scaryAll = Object.values(rows).filter((r) => r.flags.horror || r.flags.trueCrime || r.flags.scary).map((r) => r.id);
      for (const [i, who] of audiences.entries()) {
        const d = idsOf(decks[i]);
        const hasSam = sam && who.includes(sam);
        const hasKit = kit && who.includes(kit);
        const hasDee = dee && who.includes(dee);
        if (hasSam) for (const id of scaryAll) expect(d, `${id} for audience containing Sam`).not.toContain(id);
        if (hasKit) for (const id of d) expect(rows[id].genres, `${rows[id].title} is reality`).not.toContain('reality');
        if (hasDee) for (const id of d) expect(rows[id].lang, `${rows[id].title} is not in English`).toBe('en');
      }
      // controls: people without those choices DO get them, so the checks above are not vacuous
      const alexOnly = decks[audiences.findIndex((w) => w.length === 1 && w[0] === ids[0])];
      for (const id of SCARY_TITLES) expect(idsOf(alexOnly), `control: Alex alone gets ${id}`).toContain(id);
      expect(idsOf(alexOnly).some((id) => rows[id].lang !== 'en'), 'control: Alex alone gets a subtitled show').toBe(true);
      if (kit) {
        const kitFree = (await engineDecks(page, [request([ids[0]], { mood: 'brainoff', time: 'any' })]))[0];
        expect(idsOf(kitFree).some((id) => rows[id].genres.includes('reality')), 'control: Alex gets reality TV').toBe(true);
      }
      if (sam && n >= 2) {
        // Sam alone gets nothing flagged; Alex + Sam is the same
        const dSam = (await engineDecks(page, [request([sam], { mood: 'gripped', time: 'any' })]))[0];
        expect(dSam.length).toBeGreaterThan(5);
      }
    });

    test('rule 2: the Scared mood is offered only when no watcher has a horror or scary choice', async ({ page }) => {
      const { ids, byName } = await setup(page, n);
      for (const who of subsets(ids)) {
        const moods = await availableMoods(page, who);
        const samIn = byName.Sam && who.includes(byName.Sam);
        if (samIn) expect(moods, `scared offered to ${JSON.stringify(who)}`).not.toContain('scared');
        else expect(moods, `scared missing for ${JSON.stringify(who)}`).toContain('scared');
      }
      // on screen: the chip is there when only Alex is watching...
      await toAsk(page);
      if (n >= 2) {
        await expect(tid(page, 'ask-mood-scared')).toBeVisible();
        await tid(page, `who-${byName.Sam}`).click(); // ...and gone as soon as Sam is
        await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
        await tid(page, `who-${byName.Sam}`).click();
        await expect(tid(page, 'ask-mood-scared')).toBeVisible();
      } else {
        await expect(tid(page, 'ask-mood-scared')).toBeVisible();
      }
      // a profile change shows up: once Alex says "anything scary", the chip goes for him too
      await setProfile(page, ids[0], { dealbreakers: { scary: true } });
      await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
      await setProfile(page, ids[0], { dealbreakers: { scary: false, horror: true } });
      await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
    });

    test('rule 3: Background and While eating only ever return low-attention titles, for every audience and mood; low ones are eligible for every viewing type', async ({ page }) => {
      const { ids } = await setup(page, n);
      const rows = await catalogRows(page);
      const audiences = subsets(ids);
      for (const viewing of ['background', 'eating'] as const) {
        const decks = await engineDecks(page, audiences.flatMap((who) => MOODS.map((mood) => request(who, { viewing, mood, time: 'any' }))));
        expect(decks.filter((d) => d.length > 0).length, `${viewing}: decks exist`).toBeGreaterThanOrEqual(MOODS.length);
        for (const d of decks) for (const c of d) expect(rows[c.id].attention, `${rows[c.id].title} in ${viewing}`).toBe('low');
        for (const d of decks) for (const id of HIGH_ATTENTION) expect(idsOf(d)).not.toContain(id);
      }
      // Focused does offer the heavy ones (control) and also the low ones
      const focused = (await engineDecks(page, [request([ids[0]], { viewing: 'focused', mood: 'gripped', time: 'any' })]))[0];
      for (const id of HIGH_ATTENTION) expect(idsOf(focused)).toContain(id);
      const lowFocused = (await engineDecks(page, [request([ids[0]], { viewing: 'focused', mood: 'laugh', time: 'any' })]))[0];
      expect(lowFocused.some((c) => rows[c.id].attention === 'low')).toBe(true);
    });

    test('rule 4: nothing longer than the time available (episode length for shows, runtime for movies); "I don\'t care" has no limit', async ({ page }) => {
      const { ids } = await setup(page, n);
      const limits: [20 | 45 | 60, number][] = [[20, 25], [45, 50], [60, 65]];
      for (const who of subsets(ids)) {
        const decks = await engineDecks(page, limits.flatMap(([time]) => ['laugh', 'cozy', 'gripped', 'brainoff'].map((mood) => request(who, { time, mood }))));
        let i = 0;
        for (const [, limit] of limits) {
          for (let m = 0; m < 4; m++) for (const c of decks[i++]) expect(c.minutes, `${c.id} (${c.minutes} min) for a ${limit}-minute budget`).toBeLessThanOrEqual(limit);
        }
      }
      const rows = await catalogRows(page);
      const anyDeck = (await engineDecks(page, [request([ids[0]], { time: 'any', mood: 'laugh' })]))[0];
      expect(anyDeck.some((c) => c.minutes <= 25), "I don't care includes short things").toBe(true);
      expect(anyDeck.some((c) => c.minutes >= 90), "I don't care includes feature films").toBe(true);
      const longDeck = (await engineDecks(page, [request([ids[0]], { time: 120, mood: 'laugh' })]))[0];
      expect(longDeck.some((c) => c.minutes >= 90)).toBe(true);
      void rows;
    });

    test('rule 5: New leaves out anything any watcher has seen; Rewatch only offers titles a watcher has seen; Either leans new', async ({ page }) => {
      const { ids } = await setup(page, n);
      const seen = await seenBy(page, ids);
      expect(seen[ids[0]].size, 'control: Alex has seen several catalog titles').toBeGreaterThan(5);
      for (const who of subsets(ids)) {
        const [dNew, dRe, dEither] = await engineDecks(page, [
          request(who, { novelty: 'new', time: 'any', mood: 'laugh' }),
          request(who, { novelty: 'rewatch', time: 'any', mood: 'laugh' }),
          request(who, { novelty: 'either', time: 'any', mood: 'laugh' }),
        ]);
        const anySeen = (id: string) => who.some((m) => seen[m].has(id));
        for (const c of dNew) expect(anySeen(c.id), `New offered ${c.id}, seen by a watcher`).toBe(false);
        for (const c of dRe) expect(anySeen(c.id), `Rewatch offered ${c.id}, seen by nobody`).toBe(true);
        if (dEither.length >= 10 && dRe.length > 0) {
          const share = dEither.filter((c) => anySeen(c.id)).length / dEither.length;
          expect(share, `Either is mostly new (${JSON.stringify(who)})`).toBeLessThanOrEqual(0.3);
        }
        if (who.length === 1 && who[0] === ids[0]) expect(dRe.length, 'control: Alex has something to rewatch').toBeGreaterThan(2);
      }
    });

    test('rule 6: when a title is on several of the household\'s services, an ad-free one is shown', async ({ page }) => {
      const { ids } = await setup(page, n);
      const rows = await catalogRows(page);
      const info = await wtw(page, (w) => {
        // per item: is there an ad-free plan among the household's plans that carries it?
        const plans = w.sync.getState().settings.plans as Record<string, string>;
        const out: Record<string, { adFree: boolean; any: boolean }> = {};
        for (const i of w.catalogs.get().catalog.items) {
          const c = w.engine.chooseService(i, plans);
          out[i.id] = { adFree: !!c?.adFree, any: !!c };
        }
        return out;
      });
      const decks = await engineDecks(page, subsets(ids).map((who) => request(who, { time: 'any', mood: 'laugh', novelty: 'either' })));
      for (const d of decks) for (const c of d) expect(c.adFree, `${rows[c.id].title}: card says ${c.adFree ? 'ad-free' : 'ads'}, the engine's best choice is ${info[c.id].adFree}`).toBe(info[c.id].adFree);
      // The sample catalog's known case: How I Met Your Mother is on Hulu (ads) AND Netflix (ad-free) -> Netflix, ad-free.
      const rewatch = (await engineDecks(page, [request([ids[0]], { novelty: 'rewatch', time: 'any', mood: 'laugh' })]))[0];
      const himym = rewatch.find((c) => c.id === 'tv-1100');
      expect(himym).toBeTruthy();
      expect([himym!.service, himym!.adFree]).toEqual(['netflix', true]);
      // South Park is only on ad tiers: shown with ads, never as ad-free
      const sp = (await engineDecks(page, [request([ids[0]], { novelty: 'rewatch', time: 'any', mood: 'laugh' })]))[0].find((c) => c.id === 'tv-2190');
      if (sp) expect(sp.adFree).toBe(false);
    });

    test('rule 7: Never hides a title for every audience containing someone who tapped it; once everyone has tapped it, it is gone everywhere', async ({ page }) => {
      const { ids } = await setup(page, n);
      const audiences = subsets(ids);
      const reqs = audiences.map((who) => request(who, { novelty: 'new', time: 'any', mood: 'laugh' }));
      const decks = await engineDecks(page, reqs);
      // a title every audience can currently be offered
      const common = idsOf(decks[0]).filter((id) => decks.every((d) => idsOf(d).includes(id)));
      expect(common.length, 'there is a title offered to every audience').toBeGreaterThan(0);
      const x = common[0];
      const taps = async (who: string) => wtw(page, (w, a) => w.sync.setNever(a.who, a.id, true), { who, id: x });
      const check = async (tapped: string[]) => {
        const d = await engineDecks(page, reqs);
        for (const [i, who] of audiences.entries()) {
          const has = idsOf(d[i]).includes(x);
          const shouldHide = who.some((m) => tapped.includes(m));
          if (shouldHide) expect(has, `${x} still offered to ${JSON.stringify(who)} after ${tapped} tapped Never`).toBe(false);
        }
        return d;
      };
      await taps(ids[0]);
      const afterFirst = await check([ids[0]]);
      // someone who has NOT tapped Never, alone, still gets it (it is only hidden for the people who tapped)
      if (n >= 2) {
        const soloOther = audiences.findIndex((w) => w.length === 1 && w[0] === ids[1]);
        expect(idsOf(afterFirst[soloOther]), 'control: the other person alone is still offered it').toContain(x);
      }
      for (const m of ids.slice(1)) {
        await taps(m);
        await check(ids.slice(0, ids.indexOf(m) + 1));
      }
      const last = await check(ids);
      for (const d of last) expect(idsOf(d)).not.toContain(x); // gone everywhere
    });

    test('rule 8: a title sitting in Matches is left out of decks for any audience that overlaps the pick\'s people', async ({ page }) => {
      const { ids } = await setup(page, n);
      const audiences = subsets(ids);
      const reqs = audiences.map((who) => request(who, { novelty: 'new', time: 'any', mood: 'laugh' }));
      const decks = await engineDecks(page, reqs);
      const common = idsOf(decks[0]).filter((id) => decks.every((d) => idsOf(d).includes(id)));
      const x = common[0];
      const pickFor = async (who: string[], item: string) =>
        wtw(
          page,
          async (w, a) => {
            const card = w.engine.buildDeck({ who: a.who, viewing: 'focused', mood: 'laugh', time: 'any', novelty: 'new', genre: null }, { catalog: w.catalogs.get().catalog, state: w.sync.getState(), today: '2026-10-11' }, { limit: 500 }).find((c: any) => c.itemId === a.item);
            await w.sync.addPick({ kind: a.who.length > 1 ? 'match' : 'solo', who: a.who, itemId: a.item, snapshot: { title: a.item, year: 2000, poster: null }, pick: card.pick, service: card.service });
          },
          { who, item },
        );
      // Alex liked it alone: gone for Alex alone and for every group with Alex in it; Sam alone still gets it
      await pickFor([ids[0]], x);
      let d = await engineDecks(page, reqs);
      for (const [i, who] of audiences.entries()) {
        const overlaps = who.includes(ids[0]);
        expect(idsOf(d[i]).includes(x), `${x} for ${JSON.stringify(who)} (overlaps Alex: ${overlaps})`).toBe(!overlaps);
      }
      // Removing the pick brings it back
      const st = await sharedState(page);
      await wtw(page, (w, id) => w.sync.removePick(id), st.picks[0].id);
      d = await engineDecks(page, reqs);
      expect(d.every((deck) => idsOf(deck).includes(x))).toBe(true);
      // A Together match for Alex + Sam hides it from anyone overlapping them, but not from the others
      if (n < 2) return;
      await pickFor([ids[0], ids[1]].sort(), x);
      d = await engineDecks(page, reqs);
      for (const [i, who] of audiences.entries()) {
        const overlaps = who.includes(ids[0]) || who.includes(ids[1]);
        expect(idsOf(d[i]).includes(x), `${x} for ${JSON.stringify(who)} after an Alex+Sam match`).toBe(!overlaps);
      }
    });
  });
}

// --- on screen: the same rules, walking whole decks as a person would -------------------------------------------------------------

test('on screen, solo: off-plan, scary, attention, time and ad-free rules hold for every card in whole decks', async ({ page }) => {
  const h = await quickHousehold(page, [{ ...SAMPLE[1] }]); // Sam alone: never scary
  const rows = await catalogRows(page);
  // control for the scary rule
  const control = (await engineDecks(page, [request([h.first], { mood: 'gripped', time: 'any' })]))[0];
  expect(control.length).toBeGreaterThan(5);

  await ask(page, { viewing: 'focused', mood: 'laugh', time: 20, novelty: 'either' });
  const short = await pageThroughDeck(page);
  expect(short.length).toBeGreaterThanOrEqual(3);
  for (const c of short) expect(parseMinutes(c.minutes), `${c.title} is ${c.minutes}`).toBeLessThanOrEqual(25);
  await tid(page, 'empty-back').click();

  await ask(page, { mood: 'gripped', time: 120, viewing: 'focused', novelty: 'either' });
  const deck = await pageThroughDeck(page);
  expect(deck.length).toBeGreaterThan(5);
  for (const c of deck) {
    const f = rows[c.id].flags;
    expect(f.horror || f.trueCrime || f.scary, `${c.title} is flagged`).toBe(false);
  }
  for (const id of OFF_PLAN) expect(idsOf(deck)).not.toContain(id);
  await tid(page, 'empty-back').click();

  await ask(page, { viewing: 'eating', mood: 'gripped', time: 120 });
  const eating = await pageThroughDeck(page);
  expect(eating.length).toBeGreaterThan(2);
  for (const c of eating) expect(rows[c.id].attention, `${c.title} while eating`).toBe('low');
  await tid(page, 'empty-back').click();
});

test('on screen, solo: New / Rewatch, ad-free first, and a liked title leaves the next deck', async ({ page }) => {
  const h = await quickHousehold(page, [SAMPLE[0]]); // Alex alone
  const seen = (await seenBy(page, [h.first]))[h.first];
  await ask(page, { mood: 'laugh', time: 120, novelty: 'rewatch' });
  const rew = await pageThroughDeck(page);
  expect(rew.length).toBeGreaterThan(2);
  for (const c of rew) expect(seen.has(c.id), `${c.title} not seen by Alex`).toBe(true);
  const himym = rew.find((c) => c.id === 'tv-1100');
  expect(himym, 'How I Met Your Mother is a rewatch for Alex').toBeTruthy();
  expect(himym!.service).toBe('Netflix');
  expect(himym!.adFree).toBe(true);
  expect(himym!.badge.toLowerCase()).toBe('ad-free');
  await tid(page, 'empty-back').click();

  await ask(page, { novelty: 'new' });
  const fresh = await pageThroughDeck(page);
  expect(fresh.length).toBeGreaterThan(5);
  for (const c of fresh) expect(seen.has(c.id), `${c.title} already seen`).toBe(false);
  await tid(page, 'empty-back').click();

  // rule 8 on screen: like one, and the next deck for the same question does not offer it again
  await ask(page, { novelty: 'new' });
  const liked = (await currentCardId(page))!;
  await act(page, 'yes');
  await toAsk(page);
  await ask(page, { novelty: 'new' });
  const next = await pageThroughDeck(page);
  expect(idsOf(next)).not.toContain(liked);
});

test('on screen, three people: a Together deck honours the least-tolerant watcher and the shortest time', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  const rows = await catalogRows(page);
  await startTogether(page, Object.values(h.ids).sort(), { mood: 'gripped', time: 45, viewing: 'focused' });
  const deck = await pageThroughDeck(page);
  expect(deck.length).toBeGreaterThanOrEqual(2);
  for (const c of deck) {
    const f = rows[c.id].flags;
    expect(f.horror || f.trueCrime || f.scary, `${c.title} is flagged`).toBe(false);
    expect(parseMinutes(c.minutes)).toBeLessThanOrEqual(50);
    expect(OFF_PLAN).not.toContain(c.id);
  }
});

test('on screen, a rewatch for someone who has seen nothing says so kindly', async ({ page }) => {
  await quickHousehold(page, [{ name: 'Kit' }]);
  await ask(page, { novelty: 'rewatch', mood: 'laugh', time: 120 });
  await expect(tid(page, 'empty-deck')).toBeVisible();
  await expect(tid(page, 'empty-deck')).toContainText('Nothing fits');
  await expect(tid(page, 'empty-deck')).toContainText('Either');
  await tid(page, 'empty-back').click();
  await expect(tid(page, 'ask')).toBeVisible();
  // a title can be found by walking a bit, just like any other deck
  await ask(page, { novelty: 'either' });
  expect(await findCard(page, () => true)).not.toBeNull();
});

// --- rule 9 -----------------------------------------------------------------------------------------------------------------------

for (const n of [2, 3, 4]) {
  test(`rule 9: a Together match for ${n} people needs a yes from every one of them and is recorded exactly once`, async ({ page }) => {
    const { h } = await setup(page, n);
    const names = MEMBERS[n].map((m) => m.name);
    const all = names.map((nm) => h.ids[nm]).sort();
    await startTogether(page, all, { mood: 'laugh', time: 120 });
    const first = (await currentCardId(page))!;
    await act(page, 'yes'); // the first member
    await settle(page);
    for (const [k, nm] of names.slice(1).entries()) {
      await joinAs(page, h, nm);
      expect(await currentCardId(page)).toBe(first); // everyone swipes the same deck, same order
      const last = k === names.length - 2;
      if (!last) {
        await act(page, 'yes');
        await settle(page);
        await expect(tid(page, 'match-screen'), `no match with ${k + 2} of ${n} yes`).toHaveCount(0);
        const s = await sharedState(page);
        expect(s.picks, 'nothing recorded yet').toHaveLength(0);
        expect(s.activeSession.matches).toHaveLength(0);
      } else {
        await act(page, 'yes');
        await expect(tid(page, 'match-screen')).toBeVisible({ timeout: 15_000 });
        await expect(tid(page, 'match-screen')).toHaveAttribute('data-item-id', first);
        await expect(tid(page, 'match-headline')).toHaveText(n >= 3 ? 'Everyone’s in!' : 'It’s a match!');
      }
    }
    // recorded exactly once, in Matches, for everyone in the audience
    let s = await sharedState(page);
    expect(s.picks).toHaveLength(1);
    expect(s.picks[0].kind).toBe('match');
    expect(s.picks[0].who).toEqual(all);
    expect(s.picks[0].itemId).toBe(first);
    expect(s.activeSession.matches).toHaveLength(1);
    // a second yes from someone on the same title changes nothing
    await wtw(page, (w, a) => w.sync.swipeInSession(a.sid, a.me, a.item, true, { title: 'x', year: 2000, poster: null }), {
      sid: s.activeSession.id,
      me: all[all.length - 1],
      item: first,
    });
    s = await sharedState(page);
    expect(s.picks).toHaveLength(1);
    expect(s.activeSession.matches).toHaveLength(1);
  });
}
