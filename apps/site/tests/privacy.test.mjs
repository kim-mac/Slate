import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(site, 'dist/privacy/index.html'), 'utf8');
const policies = {
  website: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '),
  repository: readFileSync(resolve(site, '../../PRIVACY.md'), 'utf8').replace(
    /\s+/g,
    ' ',
  ),
};

for (const [name, policy] of Object.entries(policies)) {
  test(`${name} policy distinguishes automatic update checks from user-requested downloads`, () => {
    assert.match(policy, /at startup and when you request a check/);
    assert.match(
      policy,
      /https:\/\/tryslate\.tech\/updates\/windows\/latest\.json/,
    );
    assert.match(policy, /choose to download[\s\S]*GitHub/);
    assert.match(policy, /Installation remains user-confirmed/);
    assert.match(policy, /do not include your clip contents/);
    assert.match(policy, /updater user-agent/);
    assert.match(
      policy,
      /does not claim whether providers retain request logs/,
    );
    assert.doesNotMatch(
      policy,
      /Slate never (?:connects|makes network requests)/i,
    );
  });

  test(`${name} policy clearly gates session-status disclosure to the upcoming extension`, () => {
    assert.match(policy, /Upcoming extension v0\.1\.2: recent save status/);
    assert.match(policy, /not in the published extension v0\.1\.1/);
    assert.match(policy, /Chrome session storage/);
    assert.match(policy, /capture outcome and timestamp/);
    assert.match(policy, /connection recovery and last-save feedback/);
    assert.match(policy, /service-worker restarts within the browser session/);
    assert.match(policy, /not permanent storage/);
    assert.match(policy, /not a live connection check/);
  });

  test(`${name} policy scopes exclusions to the recovery record and describes expiration truthfully`, () => {
    assert.match(
      policy,
      /This recovery-status record does not contain clip content, selected text, page URLs, page titles, or raw error messages/,
    );
    assert.match(policy, /ten minutes old or older are treated as unknown/);
    assert.match(policy, /not[\s\S]*physically deleted at exactly ten minutes/);
    assert.match(policy, /no connection polling or automatic capture retry/);
    assert.doesNotMatch(
      policy,
      /(?:erase|delete)[sd]? (?:automatically )?after ten minutes/i,
    );
  });

  test(`${name} policy retains local persistence and explains Native Messaging as local communication`, () => {
    assert.match(policy, /local plaintext SQLite database/);
    assert.match(policy, /Native Messaging/);
    assert.match(policy, /local process communication, not a cloud upload/);
    assert.match(policy, /support@tryslate\.tech/);
    assert.doesNotMatch(
      policy,
      /(?:guaranteed support|guaranteed response|24[- ]hour response)/i,
    );
  });
}

test('privacy support email uses a plain, keyboard-accessible mailto without automatic data', () => {
  assert.match(
    html,
    /<a\b[^>]*href="mailto:support@tryslate\.tech"[^>]*>\s*support@tryslate\.tech\s*<\/a>/,
  );
  assert.doesNotMatch(html, /mailto:[^"]*\?/);
  assert.doesNotMatch(html, /<form|onclick=|tabindex="-1"[^>]*href="mailto:/);
  assert.match(html, /Do not send private clip content/);
});
