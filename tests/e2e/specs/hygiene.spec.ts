import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The private app this one grew out of must not leak into the tests: no references to it (its site, its Firebase project,
 * its repository) and none of the couple's initials. The patterns are assembled from pieces so this file does not match itself.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const FORBIDDEN: [string, RegExp][] = [
  ['the private app\'s name', new RegExp('what' + '-to-' + 'watch', 'i')],
  ['the private Firebase project', new RegExp('90' + 'a38')],
  ['the old initials', new RegExp('\\b(?:H' + 'G|B' + 'G)\\b')],
  ['the old fixed-person ids', new RegExp("['\"`](?:H" + "G|B" + "G)['\"`]")],
  ['the old destroy call', new RegExp('destroy' + 'Household')],
  ['the old pairing code UI', new RegExp('pairing' + '-code|show-' + 'pairing')],
  ['the old two-person Together id', new RegExp("who-Toge" + "ther|ask-" + "who-")],
];

test('nothing in tests/e2e mentions the private app or the old couple', async () => {
  const root = join(process.cwd(), 'tests', 'e2e');
  const found: string[] = [];
  for (const f of files(root)) {
    if (!/\.(ts|mjs|json|md)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const [what, re] of FORBIDDEN) if (re.test(text)) found.push(`${f.slice(root.length + 1)}: ${what}`);
  }
  expect(found).toEqual([]);
});
