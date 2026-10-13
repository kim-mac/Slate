import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const moduleUrl = new URL('../src/scripts/analytics.ts', import.meta.url);

test('consent-first analytics controller exists', () => {
  assert.ok(existsSync(moduleUrl), 'The consent-first controller must exist');
});

test('documented environment template contains only an inactive public-token placeholder', async () => {
  const example = readFileSync(
    new URL('../.env.example', import.meta.url),
    'utf8',
  );
  const assignments = example
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'));
  assert.deepEqual(assignments, [
    'PUBLIC_POSTHOG_KEY=YOUR_PUBLIC_POSTHOG_PROJECT_TOKEN',
  ]);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(
    readme.includes('Copy `apps/site/.env.example` to `apps/site/.env`'),
  );
  const { h, analytics } = await start({
    token: 'YOUR_PUBLIC_POSTHOG_PROJECT_TOKEN',
    preference: 'accepted',
  });
  analytics.track('github_click', 'header');
  assert.equal(h.loads, 0);
  assert.deepEqual(h.records, []);
});

async function functions() {
  return import(moduleUrl.href);
}

function harness({
  preference = null,
  dnt = null,
  gpc = false,
  token = 'phc_test',
  storageFails = false,
} = {}) {
  const records = [];
  let loads = 0;
  let config;
  let stored = preference;
  const browser = {
    location: {
      href: 'https://tryslate.tech/?email=private@example.com&utm_source=launch&utm_medium=social#secret',
    },
    navigator: { doNotTrack: dnt, globalPrivacyControl: gpc },
    localStorage: {
      getItem: () => {
        if (storageFails) throw new Error('Denied');
        return stored;
      },
      setItem: (_key, value) => {
        if (storageFails) throw new Error('Denied');
        stored = value;
      },
    },
  };
  const sdk = {
    init: (_key, options) => {
      config = options;
    },
    capture: (event, properties, options) => {
      const sent = config.before_send({
        event,
        properties: {
          ...properties,
          distinct_id: 'ephemeral-id',
          token: 'phc_test',
          $current_url: browser.location.href,
          $referrer: 'https://private.example/?token=secret',
          $device_id: 'persistent-id',
          email: 'private@example.com',
        },
      });
      if (sent) records.push({ ...sent, options });
    },
    opt_out_capturing: () => {},
    opt_in_capturing: () => {},
  };
  return {
    browser,
    records,
    token,
    loadSdk: async () => {
      loads++;
      return sdk;
    },
    get loads() {
      return loads;
    },
    get config() {
      return config;
    },
    get stored() {
      return stored;
    },
  };
}

async function start(options) {
  const { createAnalytics } = await functions();
  const h = harness(options);
  const analytics = createAnalytics({
    browser: h.browser,
    token: h.token,
    loadSdk: h.loadSdk,
  });
  await analytics.start();
  return { h, analytics };
}

test('pending and declined consent load no SDK and send no events', async () => {
  for (const preference of [null, 'declined']) {
    const { h, analytics } = await start({ preference });
    analytics.track('download_windows_x64', 'downloads');
    assert.equal(h.loads, 0);
    assert.deepEqual(h.records, []);
  }
});

test('acceptance persists consent and sends exactly one sanitized pageview', async () => {
  const { h, analytics } = await start();
  await analytics.setConsent('accepted');
  await analytics.start();
  await analytics.setConsent('accepted');
  assert.equal(h.stored, 'accepted');
  assert.equal(h.loads, 1);
  assert.deepEqual(
    h.records.map((r) => r.event),
    ['$pageview'],
  );
  assert.equal(h.records[0].properties.$current_url, 'https://tryslate.tech/');
  assert.equal(h.records[0].properties.utm_source, 'launch');
  assert.equal(h.records[0].properties.$referrer, undefined);
  assert.equal(h.records[0].properties.$device_id, undefined);
  assert.equal(h.records[0].properties.email, undefined);
  assert.equal(h.records[0].properties.$ip, '0.0.0.0');
});

test('saved consent loads a fresh page once, not twice', async () => {
  const { h, analytics } = await start({ preference: 'accepted' });
  await analytics.start();
  assert.equal(h.loads, 1);
  assert.equal(h.records.length, 1);
});

test('re-consent reuses the initialized SDK instead of initializing it twice', async () => {
  const { h, analytics } = await start({ preference: 'accepted' });
  await analytics.setConsent('declined');
  await analytics.setConsent('accepted');
  analytics.track('github_click', 'header');
  assert.equal(h.loads, 1);
  assert.equal(h.records.length, 2);
});

test('DNT and GPC override saved consent and acceptance', async () => {
  for (const signals of [{ dnt: '1' }, { dnt: 'yes' }, { gpc: true }]) {
    const { h, analytics } = await start({
      preference: 'accepted',
      ...signals,
    });
    await analytics.setConsent('accepted');
    analytics.track('github_click', 'header');
    assert.equal(h.loads, 0);
    assert.equal(h.records.length, 0);
    assert.equal(analytics.status(), 'privacy-signal');
  }
});

test('withdrawal suppresses later captures and queued SDK payloads immediately', async () => {
  const { h, analytics } = await start({ preference: 'accepted' });
  await analytics.setConsent('declined');
  analytics.track('chrome_store_click', 'downloads');
  assert.equal(h.stored, 'declined');
  assert.equal(h.records.length, 1);
  assert.equal(
    h.config.before_send({ event: '$pageview', properties: {} }),
    null,
  );
});

test('all four conversion events carry bounded location/platform and use non-blocking delivery', async () => {
  const { h, analytics } = await start({ preference: 'accepted' });
  for (const event of [
    'download_windows_x64',
    'download_windows_arm64',
    'chrome_store_click',
    'github_click',
  ]) {
    assert.equal(analytics.track(event, 'downloads'), undefined);
  }
  assert.equal(h.records.length, 5);
  assert.equal(h.records[1].properties.platform, 'windows_x64');
  assert.equal(h.records[2].properties.platform, 'windows_arm64');
  assert.equal(h.records[3].properties.platform, 'chrome');
  assert.equal(h.records[4].properties.platform, 'github');
  for (const record of h.records.slice(1)) {
    assert.equal(record.properties.button_location, 'downloads');
    assert.deepEqual(record.options, { transport: 'sendBeacon' });
  }
});

test('unapproved events, locations, URL paths and campaign values are rejected or stripped', async () => {
  const { h, analytics } = await start({ preference: 'accepted' });
  analytics.track('capture_text', 'downloads');
  analytics.track('github_click', 'private content');
  assert.equal(h.records.length, 1);
  h.browser.location.href =
    'https://tryslate.tech/private-user-name?utm_campaign=private@example.com&utm_term=secret&token=secret';
  analytics.track('github_click', 'footer');
  const props = h.records.at(-1).properties;
  assert.equal(props.$current_url, 'https://tryslate.tech/other/');
  assert.equal(props.utm_campaign, undefined);
  assert.equal(props.utm_term, undefined);
  assert.equal(props.token, 'phc_test');
  assert.equal(
    h.config.before_send({ event: '$autocapture', properties: {} }),
    null,
  );
});

test('missing token, storage denial and SDK failures degrade safely', async () => {
  const missing = await start({ token: '' });
  await missing.analytics.setConsent('accepted');
  assert.equal(missing.h.loads, 0);
  const denied = await start({ storageFails: true });
  assert.equal(denied.h.loads, 0);
  await denied.analytics.setConsent('accepted');
  assert.equal(denied.h.records.length, 1);
  const { createAnalytics } = await functions();
  const h = harness({ preference: 'accepted' });
  const broken = createAnalytics({
    browser: h.browser,
    token: h.token,
    loadSdk: async () => {
      throw new Error('Blocked');
    },
  });
  await broken.start();
  assert.doesNotThrow(() => broken.track('github_click', 'header'));
  assert.equal(broken.status(), 'unavailable');
});

test('withdrawal while the SDK loads prevents initialization and sending', async () => {
  const { createAnalytics } = await functions();
  const h = harness();
  let resolve;
  const sdk = {
    init: () => assert.fail('Must not initialize'),
    capture: () => assert.fail('Must not send'),
    opt_out_capturing: () => {},
    opt_in_capturing: () => {},
  };
  const analytics = createAnalytics({
    browser: h.browser,
    token: h.token,
    loadSdk: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = analytics.setConsent('accepted');
  await analytics.setConsent('declined');
  resolve(sdk);
  await pending;
  assert.equal(analytics.status(), 'declined');
});

test('SDK config disables optional collectors and persistent identity', async () => {
  const { h } = await start({ preference: 'accepted' });
  for (const option of [
    'autocapture',
    'capture_pageview',
    'capture_pageleave',
    'capture_heatmaps',
    'capture_performance',
    'capture_dead_clicks',
    'capture_exceptions',
  ])
    assert.equal(h.config[option], false, option);
  assert.equal(h.config.disable_session_recording, true);
  assert.equal(h.config.disable_surveys, true);
  assert.equal(h.config.person_profiles, 'never');
  assert.equal(h.config.persistence, 'memory');
  assert.equal(h.config.disable_persistence, true);
  assert.equal(h.config.ip, false);
  assert.equal(h.config.respect_dnt, true);
  assert.equal(h.config.api_host, 'https://us.i.posthog.com');
});

test('consent can be granted again after withdrawal without duplicate pageviews', async () => {
  const { createAnalytics } = await functions();
  const h = harness();
  let enabled = false;
  let sent = 0;
  const sdk = {
    init: () => {},
    capture: () => {
      if (enabled) sent++;
    },
    opt_in_capturing: (options) => {
      assert.equal(options.captureEventName, false);
      enabled = true;
    },
    opt_out_capturing: () => {
      enabled = false;
    },
  };
  const analytics = createAnalytics({
    browser: h.browser,
    token: h.token,
    loadSdk: async () => sdk,
  });
  await analytics.setConsent('accepted');
  assert.equal(sent, 1);
  await analytics.setConsent('declined');
  await analytics.setConsent('accepted');
  analytics.track('github_click', 'header');
  assert.equal(sent, 2);
});

test('local and preview builds never initialize PostHog even with a token and consent', async () => {
  const { createAnalytics } = await functions();
  for (const href of [
    'http://127.0.0.1:4321/',
    'https://preview.slate.pages.dev/',
  ]) {
    const h = harness({ preference: 'accepted' });
    h.browser.location.href = href;
    const analytics = createAnalytics({
      browser: h.browser,
      token: h.token,
      loadSdk: h.loadSdk,
    });
    await analytics.start();
    assert.equal(h.loads, 0);
    assert.equal(analytics.status(), 'non-production');
  }
});

test('privacy signals changing during SDK load prevent initialization', async () => {
  const { createAnalytics } = await functions();
  const h = harness({ preference: 'accepted' });
  let resolve;
  const analytics = createAnalytics({
    browser: h.browser,
    token: h.token,
    loadSdk: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = analytics.start();
  h.browser.navigator.globalPrivacyControl = true;
  resolve({
    init: () => assert.fail('Must not initialize'),
    capture: () => assert.fail('Must not send'),
    opt_out_capturing: () => {},
    opt_in_capturing: () => {},
  });
  await pending;
  assert.equal(h.records.length, 0);
});

test('Accept, withdraw, then Accept during a pending SDK load uses the latest consent', async () => {
  const { createAnalytics } = await functions();
  const h = harness();
  let resolve;
  let initialized = 0;
  let sent = 0;
  const sdk = {
    init: () => {
      initialized++;
    },
    opt_in_capturing: () => {},
    opt_out_capturing: () => {},
    capture: () => {
      sent++;
    },
  };
  const analytics = createAnalytics({
    browser: h.browser,
    token: h.token,
    loadSdk: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const first = analytics.setConsent('accepted');
  await analytics.setConsent('declined');
  const latest = analytics.setConsent('accepted');
  resolve(sdk);
  await Promise.all([first, latest]);
  assert.equal(initialized, 1);
  assert.equal(sent, 1);
});

function uiHarness(options) {
  const h = harness(options);
  const root = new EventTarget();
  const browser = Object.assign(new EventTarget(), h.browser);
  const panel = { hidden: true };
  const settings = { hidden: true };
  const status = { textContent: '' };
  const accept = { disabled: false };
  const withdraw = { hidden: true };
  root.querySelector = (selector) =>
    ({
      '[data-analytics-consent]': panel,
      '[data-analytics-settings]': settings,
      '[data-analytics-status]': status,
      '[data-analytics-withdraw]': withdraw,
    })[selector];
  root.querySelectorAll = () => [accept];
  const click = (attribute, data = {}) => {
    const event = new Event('click', { cancelable: true });
    const control = {
      hasAttribute: (name) => name === attribute,
      dataset: data,
    };
    const target = {
      closest: (selector) => (selector.includes(attribute) ? control : null),
    };
    Object.defineProperty(event, 'target', { value: target });
    root.dispatchEvent(event);
    return event;
  };
  return { h, root, browser, panel, settings, status, accept, withdraw, click };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('real consent controls support Accept, Decline, settings reopening, and withdrawal', async () => {
  const { initializeAnalytics } = await functions();
  const ui = uiHarness();
  const cleanup = initializeAnalytics(
    ui.root,
    ui.browser,
    ui.h.token,
    ui.h.loadSdk,
  );
  assert.equal(ui.panel.hidden, false);
  assert.equal(ui.settings.hidden, false);
  ui.click('data-analytics-decline');
  assert.equal(ui.panel.hidden, true);
  assert.equal(ui.h.loads, 0);
  ui.click('data-analytics-settings');
  assert.equal(ui.panel.hidden, false);
  ui.click('data-analytics-accept');
  await settle();
  assert.equal(ui.h.records.length, 1);
  assert.equal(ui.panel.hidden, true);
  ui.click('data-analytics-settings');
  assert.equal(ui.withdraw.hidden, false);
  ui.click('data-analytics-withdraw');
  assert.equal(ui.h.stored, 'declined');
  ui.click('data-analytics-event', {
    analyticsEvent: 'github_click',
    analyticsLocation: 'header',
  });
  assert.equal(ui.h.records.length, 1);
  cleanup();
});

test('conversion observation never prevents default navigation and is removed on cleanup', async () => {
  const { initializeAnalytics } = await functions();
  const ui = uiHarness({ preference: 'accepted' });
  const cleanup = initializeAnalytics(
    ui.root,
    ui.browser,
    ui.h.token,
    ui.h.loadSdk,
  );
  await settle();
  const event = ui.click('data-analytics-event', {
    analyticsEvent: 'download_windows_x64',
    analyticsLocation: 'downloads',
  });
  assert.equal(event.defaultPrevented, false);
  assert.equal(ui.h.records.at(-1).event, 'download_windows_x64');
  const count = ui.h.records.length;
  cleanup();
  ui.click('data-analytics-event', {
    analyticsEvent: 'download_windows_x64',
    analyticsLocation: 'downloads',
  });
  assert.equal(ui.h.records.length, count);
});

test('duplicate setup is idempotent and browser back/forward restoration records one new pageview', async () => {
  const { initializeAnalytics } = await functions();
  const ui = uiHarness({ preference: 'accepted' });
  const cleanup = initializeAnalytics(
    ui.root,
    ui.browser,
    ui.h.token,
    ui.h.loadSdk,
  );
  const duplicate = initializeAnalytics(
    ui.root,
    ui.browser,
    ui.h.token,
    ui.h.loadSdk,
  );
  await settle();
  assert.equal(duplicate, cleanup);
  assert.equal(ui.h.records.length, 1);
  const restore = new Event('pageshow');
  Object.assign(restore, { persisted: true });
  ui.browser.dispatchEvent(restore);
  await settle();
  assert.deepEqual(
    ui.h.records.map((record) => record.event),
    ['$pageview', '$pageview'],
  );
  cleanup();
});

test('cross-tab withdrawal immediately stops this tab', async () => {
  const { initializeAnalytics, consentKey } = await functions();
  const ui = uiHarness({ preference: 'accepted' });
  const cleanup = initializeAnalytics(
    ui.root,
    ui.browser,
    ui.h.token,
    ui.h.loadSdk,
  );
  await settle();
  const event = new Event('storage');
  Object.assign(event, { key: consentKey, newValue: 'declined' });
  ui.browser.dispatchEvent(event);
  ui.click('data-analytics-event', {
    analyticsEvent: 'github_click',
    analyticsLocation: 'footer',
  });
  assert.equal(ui.h.records.length, 1);
  cleanup();
});

test('privacy preference disables Accept and closing the prompt never grants consent', async () => {
  const { initializeAnalytics } = await functions();
  const ui = uiHarness({ gpc: true });
  const cleanup = initializeAnalytics(
    ui.root,
    ui.browser,
    ui.h.token,
    ui.h.loadSdk,
  );
  ui.click('data-analytics-settings');
  assert.equal(ui.accept.disabled, true);
  assert.match(ui.status.textContent, /privacy preference/);
  ui.click('data-analytics-close');
  assert.equal(ui.panel.hidden, true);
  assert.equal(ui.h.loads, 0);
  cleanup();
});

test('built pages preserve destinations and expose consent-first controls without a remote SDK script', () => {
  for (const path of [
    'index.html',
    'support/index.html',
    'privacy/index.html',
  ]) {
    const html = readFileSync(
      new URL('../dist/' + path, import.meta.url),
      'utf8',
    );
    assert.match(html, /data-slate-analytics/);
    assert.match(html, /data-analytics-consent[^>]*hidden/);
    for (const action of ['settings', 'accept', 'decline', 'withdraw'])
      assert.ok(html.includes('data-analytics-' + action));
    assert.doesNotMatch(html, /<script[^>]*src="https?:\/\/[^>]*posthog/);
  }
  const home = readFileSync(
    new URL('../dist/index.html', import.meta.url),
    'utf8',
  );
  assert.match(home, /data-analytics-event="download_windows_x64"/);
  assert.match(home, /data-analytics-event="download_windows_arm64"/);
  assert.match(home, /data-analytics-event="chrome_store_click"/);
  assert.match(home, /data-analytics-event="github_click"/);
});
