import { expect, test } from '@playwright/test';
import {
  SAMPLE,
  act,
  ask,
  currentCardId,
  joinAs,
  openTab,
  pageThroughDeck,
  quickHousehold,
  readCard,
  saveCard,
  settle,
  sharedState,
  startTogether,
  tid,
  toAsk,
  type MemberSpec,
} from '../helpers/app';

const DEE: MemberSpec = { name: 'Dee' };

test('2 members: chips by name, no "Everyone", the button says "Start together", the other gets a prompt, the match says "It\'s a match!"', async ({ page }) => {
  const h = await quickHousehold(page, [SAMPLE[0], { name: 'Sam', like: 'sam' }]);
  await expect(tid(page, 'who-picker')).toBeVisible();
  await expect(tid(page, `who-${h.ids.Alex}`)).toContainText('Alex (me)');
  await expect(tid(page, `who-${h.ids.Sam}`)).toHaveText('Sam');
  await expect(tid(page, 'who-everyone')).toHaveCount(0); // only with 3 or more
  await expect(tid(page, `who-${h.ids.Alex}`)).toHaveAttribute('data-selected', 'true'); // default: me
  await expect(tid(page, `who-${h.ids.Sam}`)).toHaveAttribute('data-selected', 'false');
  await expect(tid(page, 'ask-submit')).toHaveText('Show me');
  await tid(page, `who-${h.ids.Sam}`).click();
  await expect(tid(page, 'ask-submit')).toHaveText('Start together');

  await startTogether(page, [h.ids.Alex, h.ids.Sam].sort(), { mood: 'laugh' });
  await expect(tid(page, 'session-status')).toHaveAttribute('data-all-joined', 'false');
  await expect(tid(page, 'session-status')).toContainText('Waiting for Sam');
  const first = (await currentCardId(page))!;
  await act(page, 'yes');
  await settle(page);

  await h.actAs('Sam');
  await expect(tid(page, 'join-prompt')).toBeVisible();
  await expect(tid(page, 'join-text')).toContainText('Alex started a session with you');
  await tid(page, 'join-button').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  await expect(tid(page, 'session-status')).toHaveAttribute('data-all-joined', 'true');
  expect(await currentCardId(page)).toBe(first);
  await act(page, 'yes');
  await expect(tid(page, 'match-screen')).toBeVisible();
  await expect(tid(page, 'match-headline')).toHaveText('It’s a match!');
  await expect(tid(page, 'match-title')).not.toHaveText('');
  await expect(tid(page, 'match-what')).not.toHaveText('');
  await expect(tid(page, 'match-service')).not.toHaveText('');
  await expect(tid(page, 'match-ad-badge')).toHaveText(/ad-free|ads/i);
  await tid(page, 'match-keep').click();
  // keep swiping: the next card of the same deck
  await expect(tid(page, 'card')).toBeVisible();
  expect(await currentCardId(page)).not.toBe(first);
});

test('3 members: an "Everyone" chip, a session for all three matches only after the third yes, and says "Everyone\'s in!"', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await expect(tid(page, 'who-everyone')).toBeVisible();
  await tid(page, 'who-everyone').click();
  for (const nm of ['Alex', 'Sam', 'Kit']) await expect(tid(page, `who-${h.ids[nm]}`)).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'who-everyone')).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'ask-submit')).toHaveText('Start together');
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  await expect(tid(page, 'session-status')).toContainText('Waiting for Sam and Kit');
  const first = (await currentCardId(page))!;
  await act(page, 'yes');
  await settle(page);
  await joinAs(page, h, 'Sam');
  await expect(tid(page, 'join-text')).toHaveCount(0);
  await act(page, 'yes');
  await settle(page);
  await expect(tid(page, 'match-screen')).toHaveCount(0); // two of three is not enough
  await h.actAs('Kit');
  await expect(tid(page, 'join-prompt')).toBeVisible();
  await expect(tid(page, 'join-text')).toContainText('Alex started a session with you and Sam');
  await tid(page, 'join-button').click();
  expect(await currentCardId(page)).toBe(first);
  await act(page, 'yes');
  await expect(tid(page, 'match-screen')).toBeVisible();
  await expect(tid(page, 'match-headline')).toHaveText('Everyone’s in!');
  await tid(page, 'match-keep').click();
  const s = await sharedState(page);
  expect(s.picks).toHaveLength(1);
  expect(s.picks[0].who).toHaveLength(3);
  // one "no" among the three prevents a match on the next card
  const second = (await currentCardId(page))!;
  await act(page, 'yes'); // Kit
  await settle(page);
  await h.actAs('Sam');
  await act(page, 'not-tonight');
  await h.actAs('Alex');
  await act(page, 'yes');
  await settle(page);
  expect((await sharedState(page)).picks.filter((p: { itemId: string }) => p.itemId === second)).toHaveLength(0);
});

test('a pair inside a household of three: the third is not prompted, sees the quiet line, and can browse solo', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await startTogether(page, [h.ids.Alex, h.ids.Sam].sort(), { mood: 'laugh' });
  const first = (await currentCardId(page))!;
  await act(page, 'yes');
  await settle(page);

  await h.actAs('Kit');
  await expect(tid(page, 'join-prompt')).toHaveCount(0);
  await expect(tid(page, 'ask')).toBeVisible();
  await expect(tid(page, 'session-others')).toHaveText('Alex and Sam are picking together');
  await expect(tid(page, 'resume-session')).toHaveCount(0);
  // Kit browses on their own meanwhile
  await ask(page, { mood: 'laugh', time: 120, who: [h.ids.Kit] });
  await expect(tid(page, 'solo-deck')).toBeVisible();
  const solo = await readCard(page);
  await act(page, 'yes');
  await toAsk(page);
  // ...which neither matches with nor interferes with the pair's session
  const s = await sharedState(page);
  expect(s.activeSession.matches).toHaveLength(0);
  expect(s.activeSession.yes[h.ids.Kit] ?? []).toEqual([]);
  expect(s.picks.map((p: { kind: string }) => p.kind)).toEqual(['solo']);
  expect(s.picks[0].who).toEqual([h.ids.Kit]);
  expect(s.picks[0].itemId).toBe(solo.id);

  // Sam joins and matches with Alex; the headline is the two-person one
  await h.actAs('Sam');
  await tid(page, 'join-button').click();
  await act(page, 'yes');
  await expect(tid(page, 'match-screen')).toHaveAttribute('data-item-id', first);
  await expect(tid(page, 'match-headline')).toHaveText('It’s a match!');
  await tid(page, 'match-keep').click();

  // Kit sees the pair's match in Matches under Together, labelled with their names, and it is not Kit's to mark watched
  await h.actAs('Kit');
  await openTab(page, 'matches');
  await tid(page, 'matches-filter-together').click();
  await expect(tid(page, 'match-row')).toHaveCount(1);
  await expect(tid(page, 'match-label')).toHaveText('Match — Alex & Sam');
  await tid(page, 'matches-filter-mine').click();
  await expect(tid(page, 'match-row')).toHaveCount(1);
  await expect(tid(page, 'match-label')).toHaveText('Liked by Kit');
});

test('"We watched this" on a match marks everyone in the pick as having watched it, and only them', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  const pair = [h.ids.Alex, h.ids.Sam].sort();
  await startTogether(page, pair, { mood: 'laugh' });
  const first = (await currentCardId(page))!;
  await act(page, 'yes');
  await settle(page);
  await joinAs(page, h, 'Sam');
  await act(page, 'yes');
  await expect(tid(page, 'match-screen')).toBeVisible();
  await tid(page, 'match-keep').click();

  await openTab(page, 'matches');
  const row = page.locator(`[data-testid="match-row"][data-item-id="${first}"]`);
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('match-label')).toHaveText('Match — Alex & Sam');
  await row.click();
  await expect(tid(page, 'match-watched')).toHaveText('We watched this');
  await tid(page, 'match-watched').click();
  await expect(row).toHaveCount(0);
  const s = await sharedState(page);
  expect(Object.keys(s.seen[h.ids.Alex])).toContain(first);
  expect(Object.keys(s.seen[h.ids.Sam])).toContain(first);
  expect(Object.keys(s.seen[h.ids.Kit])).not.toContain(first);
  // History: Sam's list has it, Kit's does not
  await openTab(page, 'history');
  await tid(page, `history-person-${h.ids.Sam}`).click();
  await expect(page.locator(`[data-testid="history-row"][data-item-id="${first}"]`)).toHaveCount(1);
  await tid(page, `history-person-${h.ids.Kit}`).click();
  await expect(tid(page, 'history-empty')).toBeVisible();
});

test('4 members: Everyone starts a session that needs all four; names show in the waiting line', async ({ page }) => {
  const h = await quickHousehold(page, [...SAMPLE, DEE]);
  await tid(page, 'who-everyone').click();
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  await expect(tid(page, 'session-status')).toContainText('Waiting for Sam, Kit and Dee');
  await expect(tid(page, 'session-status')).toHaveAttribute('data-waiting', '3');
  await act(page, 'yes');
  await settle(page);
  await joinAs(page, h, 'Sam');
  await expect(tid(page, 'session-status')).toHaveAttribute('data-waiting', '2');
});

test('Not now keeps the invitation on the Ask screen; leaving a session shows a resume banner; ending it tells the others', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE.slice(0, 2));
  await startTogether(page, [h.ids.Alex, h.ids.Sam].sort(), { mood: 'laugh' });
  // starter leaves the deck and can come back
  await tid(page, 'session-back').click();
  await expect(tid(page, 'ask')).toBeVisible();
  await expect(tid(page, 'resume-session')).toBeVisible();
  await tid(page, 'resume-session').click();
  await expect(tid(page, 'session-deck')).toBeVisible();

  await h.actAs('Sam');
  await expect(tid(page, 'join-prompt')).toBeVisible();
  await tid(page, 'join-dismiss').click();
  await expect(tid(page, 'join-prompt')).toHaveCount(0);
  await expect(tid(page, 'join-prompt-inline')).toBeVisible();
  await tid(page, 'join-button-inline').click();
  await expect(tid(page, 'session-deck')).toBeVisible();

  // Sam ends it: Alex is told
  await tid(page, 'session-end-top').click();
  await expect(tid(page, 'end-sheet')).toBeVisible();
  await tid(page, 'end-cancel').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  await tid(page, 'session-end-top').click();
  await tid(page, 'end-confirm').click();
  await expect(tid(page, 'ask')).toBeVisible();
  await h.actAs('Alex');
  await expect(tid(page, 'ask')).toBeVisible();
  expect((await sharedState(page)).activeSession).toBeNull();
});

test('in a session: Save offers Mine / Ours, Never only hides for the person who tapped it, "More cards" extends the deck', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE.slice(0, 2));
  await startTogether(page, [h.ids.Alex, h.ids.Sam].sort(), { mood: 'laugh', time: 45 });
  const a = (await currentCardId(page))!;
  await tid(page, 'action-save').click();
  await expect(tid(page, 'save-sheet')).toBeVisible();
  await expect(tid(page, `save-option-${h.ids.Alex}`)).toBeVisible();
  await expect(tid(page, 'save-option-ours')).toBeVisible();
  await tid(page, 'save-option-ours').click();
  await expect(page.locator(`[data-testid="card"][data-item-id="${a}"]`)).toHaveCount(0);
  await openTab(page, 'watchlist');
  await tid(page, 'watchlist-tab-ours').click();
  await expect(page.locator(`[data-testid="watchlist-row"][data-item-id="${a}"]`)).toHaveCount(1);
  await openTab(page, 'tonight');
  await saveCard(page, h.ids.Alex);
  await tid(page, 'action-never').click();
  await expect(tid(page, 'never-sheet')).toBeVisible();
  const b = (await currentCardId(page))!;
  await tid(page, 'never-confirm').click();
  await settle(page);
  const s = await sharedState(page);
  expect(Object.keys(s.never[h.ids.Alex])).toContain(b);
  expect(Object.keys(s.never[h.ids.Sam])).not.toContain(b);
  // run the deck out; "More cards" is offered and either adds cards or says nothing else fits
  const seen = await pageThroughDeck(page);
  expect(seen.length).toBeGreaterThan(0);
  await expect(tid(page, 'session-deck-done')).toBeVisible();
  await tid(page, 'session-more').click();
  await expect(tid(page, 'card').or(tid(page, 'session-no-more'))).toBeVisible();
});

test('the New tab\'s who-picker offers members, pairs and Everyone, and follows the same rules as Tonight', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await openTab(page, 'new');
  await expect(tid(page, 'who-picker')).toBeVisible();
  await expect(tid(page, 'who-everyone')).toBeVisible();
  await tid(page, `who-${h.ids.Sam}`).click();
  await expect(tid(page, `who-${h.ids.Sam}`)).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'new-feed')).toBeVisible();
  // Sam never wants scary things: neither alone nor in a group does the feed list The Haunting of Hill House / Get Out
  for (const id of ['movie-419430', 'tv-72844']) await expect(page.locator(`[data-testid="new-row"][data-item-id="${id}"]`)).toHaveCount(0);
  await tid(page, `who-${h.ids.Sam}`).click(); // back to just Alex
  await expect(page.locator('[data-testid="new-row"][data-item-id="movie-419430"]')).toHaveCount(1); // control: Alex alone sees Get Out
});
