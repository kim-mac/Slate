import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(site, '../..');
const read = (path) => readFileSync(resolve(repository, path), 'utf8');
const normalize = (text) => text.replace(/\s+/g, ' ');
const readme = normalize(read('README.md'));
const security = normalize(read('SECURITY.md'));
const supportHtml = read('apps/site/dist/support/index.html');
const support = normalize(supportHtml.replace(/<[^>]*>/g, ' '));

test('README identifies published components and stable official installation links', () => {
  assert.match(readme, /Desktop\s*\|\s*0\.3\.2/);
  assert.match(readme, /Chrome extension\s*\|\s*0\.1\.1/);
  assert.match(readme, /https:\/\/tryslate\.tech\/download\/windows\//);
  assert.match(
    readme,
    /https:\/\/github\.com\/kim-mac\/Slate\/releases\/latest/,
  );
  assert.match(readme, /Windows 11 x64[\s\S]*ARM64/);
  assert.doesNotMatch(
    readme,
    /automatic updating is under development|Desktop\s*\|\s*0\.1\.0/i,
  );
});

test('README describes actual capture scope, desktop dependency and current updates', () => {
  assert.match(readme, /Save selection/);
  assert.match(readme, /Save this page[\s\S]*title and URL/);
  assert.match(readme, /supported ChatGPT, Claude, and Gemini/);
  assert.match(readme, /native host[\s\S]*desktop GUI does not need to relay/);
  assert.match(readme, /Update Now[\s\S]*Restart to update/);
  assert.match(readme, /support@tryslate\.tech/);
  assert.doesNotMatch(readme, /captures? (?:an entire|full) webpage/i);
});

test('security guidance separates published component versions and two signing mechanisms', () => {
  assert.match(security, /Desktop\s*\|\s*0\.3\.2/);
  assert.match(security, /Chrome extension\s*\|\s*0\.1\.1/);
  assert.match(security, /not Authenticode-signed/);
  assert.match(security, /Tauri updater signatures/);
  assert.match(security, /signed-version/);
  assert.match(security, /SHA-256[\s\S]*SHA256SUMS\.txt/);
  assert.match(security, /checksum alone does not authenticate the publisher/);
  assert.doesNotMatch(security, /0\.1\.x\s*\|\s*Yes/);
});

test('security contact stays private without unsupported availability promises', () => {
  assert.match(security, /private vulnerability/);
  assert.match(security, /mailto:support@tryslate\.tech/);
  assert.match(security, /Do not post vulnerability details in public issues/);
  assert.match(security, /synthetic/);
  assert.doesNotMatch(
    security,
    /guaranteed (?:response|availability)|24[- ]hour response|within \d+ hours/i,
  );
});

test('Support provides plain mailto and safe synthetic reporting with focused public issue navigation', () => {
  assert.match(supportHtml, /href="mailto:support@tryslate\.tech"/);
  assert.match(
    supportHtml,
    /href="https:\/\/github\.com\/kim-mac\/Slate\/issues"/,
  );
  assert.doesNotMatch(supportHtml, /mailto:[^"]*\?|<form|onclick=/);
  assert.match(support, /synthetic example/);
  assert.match(support, /GitHub issues for a public report/);
  assert.match(support, /browser and extension versions/);
  assert.match(support, /Do not send private clip content/);
});

test('Support explains view refresh, native host, tray and safe failure recovery', () => {
  assert.match(support, /All Clips[\s\S]*Refresh/);
  assert.match(
    support,
    /native host[\s\S]*without the desktop window relaying/,
  );
  assert.match(support, /Quit[\s\S]*tray/);
  assert.match(support, /Do not delete your library or choose Delete app data/);
  assert.match(support, /Do not disable signature verification/);
  assert.doesNotMatch(support, /v0\.1\.2|Get Slate Desktop|Retry\/Cancel/);
});

test('Support explains official installer trust without bypassing Windows protection', () => {
  assert.match(support, /not Authenticode-signed/);
  assert.match(support, /SHA-256[\s\S]*SHA256SUMS\.txt/);
  assert.match(support, /malware detections or organizational restrictions/);
  assert.match(supportHtml, /href="\/download\/windows\/"/);
  assert.match(
    supportHtml,
    /href="https:\/\/chromewebstore\.google\.com\/detail\/slate\/hgbfaclkpmcecikjepoejgjccddjbekh"/,
  );
});

test('developer guidance labels source lines and original release instructions honestly', () => {
  const development = normalize(read('docs/DEVELOPMENT.md'));
  const checklist = normalize(read('docs/RELEASE_CHECKLIST.md'));
  const index = normalize(read('docs/00_READ_ME_FIRST.md'));
  assert.match(development, /production website/);
  assert.match(development, /release tag/);
  assert.match(
    development,
    /Chrome profile alone does not isolate Native Messaging/,
  );
  assert.match(development, /dist\/release\/v<desktop-version>/);
  assert.doesNotMatch(
    development,
    /Windows\/root release version is `0\.1\.0`/,
  );
  assert.match(checklist, /Historical first-release checklist/);
  assert.match(index, /0\.3\.1/);
  assert.match(index, /schema 3/);
});
