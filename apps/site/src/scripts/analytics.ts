import type { PostHog, PostHogConfig } from 'posthog-js';

export const consentKey = 'slate-site-analytics-consent';
type Consent = 'accepted' | 'declined' | 'pending';
type Sdk = Pick<
  PostHog,
  'init' | 'capture' | 'opt_out_capturing' | 'opt_in_capturing'
>;
type Browser = {
  location: Pick<Location, 'href'>;
  navigator: { doNotTrack?: string | null; globalPrivacyControl?: boolean };
  localStorage: Pick<Storage, 'getItem' | 'setItem'>;
};
const conversions = {
  download_windows_x64: 'windows_x64',
  download_windows_arm64: 'windows_arm64',
  chrome_store_click: 'chrome',
  github_click: 'github',
} as const;
const locations = new Set(['header', 'footer', 'downloads', 'support']);
const routes = new Set(['/', '/privacy/', '/support/', '/404.html']);

export function createAnalytics({
  browser,
  token,
  loadSdk,
  onChange = () => {},
}: {
  browser: Browser;
  token: string;
  loadSdk: () => Promise<Sdk>;
  onChange?: () => void;
}) {
  let consent: Consent = 'pending';
  try {
    const saved = browser.localStorage.getItem(consentKey);
    if (saved === 'accepted' || saved === 'declined') consent = saved;
  } catch {
    // Storage denial means no remembered consent, never implied consent.
  }
  let sdk: Sdk | undefined;
  let loading: Promise<void> | undefined;
  let failed = false;
  let pageviewSent = false;
  let disposed = false;
  const configured = /^phc_[A-Za-z0-9_-]+$/.test(token);
  const production = [
    'https://tryslate.tech',
    'https://www.tryslate.tech',
  ].includes(new URL(browser.location.href).origin);
  const blocked = () =>
    browser.navigator.globalPrivacyControl === true ||
    ['1', 'yes'].includes(browser.navigator.doNotTrack ?? '');
  const allowed = () =>
    !disposed &&
    configured &&
    production &&
    consent === 'accepted' &&
    !blocked();
  const safePage = () => {
    const url = new URL(browser.location.href);
    const path = routes.has(url.pathname) ? url.pathname : '/other/';
    const properties: Record<string, string | boolean> = {
      $current_url: `https://tryslate.tech${path}`,
      $pathname: path,
      $host: 'tryslate.tech',
      $ip: '0.0.0.0',
      $process_person_profile: false,
    };
    // Campaign labels only: never copy the complete query, fragment or referrer.
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
      const value = url.searchParams.get(key);
      if (value && /^[a-zA-Z0-9_-]{1,64}$/.test(value)) properties[key] = value;
    }
    return properties;
  };
  const config: Partial<PostHogConfig> = {
    api_host: 'https://us.i.posthog.com',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_heatmaps: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_conversations: true,
    disable_product_tours: true,
    disable_external_dependency_loading: true,
    advanced_disable_toolbar_metrics: true,
    person_profiles: 'never',
    persistence: 'memory',
    disable_persistence: true,
    ip: false,
    respect_dnt: true,
    request_batching: false,
    advanced_disable_flags: true,
    capture_webmcp: false,
    disable_scroll_properties: true,
    save_referrer: false,
    store_google: false,
    opt_out_capturing_by_default: true,
    before_send: (payload) => {
      if (!payload || !allowed()) return null;
      const event = payload.event;
      if (event !== '$pageview' && !Object.hasOwn(conversions, event))
        return null;
      // Rebuild properties, including SDK defaults, from an explicit allowlist.
      const properties: Record<string, unknown> = {
        ...safePage(),
        // Required ingestion routing metadata, not a URL parameter or personal key.
        token,
      };
      const id = payload.properties.distinct_id;
      if (typeof id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(id))
        properties.distinct_id = id;
      if (event !== '$pageview') {
        const location = payload.properties.button_location;
        if (typeof location !== 'string' || !locations.has(location))
          return null;
        properties.button_location = location;
        properties.platform = conversions[event as keyof typeof conversions];
      }
      return { ...payload, properties };
    },
  };
  const status = () => {
    if (!configured) return 'unconfigured';
    if (!production) return 'non-production';
    if (blocked()) return 'privacy-signal';
    if (failed) return 'unavailable';
    return consent;
  };
  const capturePageview = () => {
    if (!sdk || !allowed() || pageviewSent) return;
    pageviewSent = true;
    try {
      sdk.capture('$pageview', safePage(), { transport: 'sendBeacon' });
    } catch {
      // Analytics can never break the page or navigation.
    }
  };
  const start = async () => {
    if (!allowed() || failed) return;
    if (sdk) {
      try {
        sdk.opt_in_capturing({ captureEventName: false });
        capturePageview();
      } catch {
        failed = true;
        onChange();
      }
      return;
    }
    if (loading) return loading;
    loading = (async () => {
      try {
        const loaded = await loadSdk();
        if (!allowed()) return;
        loaded.init(token, config);
        loaded.opt_in_capturing({ captureEventName: false });
        sdk = loaded;
        capturePageview();
      } catch {
        failed = true;
      } finally {
        loading = undefined;
        onChange();
      }
    })();
    return loading;
  };
  const setConsent = async (value: 'accepted' | 'declined') => {
    consent = value;
    try {
      browser.localStorage.setItem(consentKey, value);
    } catch {
      // Explicit permission lasts only for this page if storage is unavailable.
    }
    if (value === 'declined') {
      try {
        sdk?.opt_out_capturing();
      } catch {
        // The local allowed() gate still prevents every subsequent event.
      }
    }
    onChange();
    if (value === 'accepted') await start();
  };
  const track = (event: string, location: string) => {
    if (
      !allowed() ||
      !sdk ||
      !Object.hasOwn(conversions, event) ||
      !locations.has(location)
    )
      return;
    try {
      sdk.capture(
        event,
        { ...safePage(), button_location: location },
        { transport: 'sendBeacon' },
      );
    } catch {
      // No preventDefault, no awaiting the network, and no delayed navigation.
    }
  };
  const dispose = () => {
    disposed = true;
    consent = 'declined';
    try {
      sdk?.opt_out_capturing();
    } catch {
      /* Local gate is authoritative. */
    }
    sdk = undefined;
  };
  const restoredPageview = () => {
    pageviewSent = false;
    void start();
  };
  return { start, setConsent, track, status, dispose, restoredPageview };
}

const initializedDocuments = new WeakMap<Document, () => void>();

/** A single document listener observes explicit link annotations, never text. */
export function initializeAnalytics(
  root: Document,
  browser: Window,
  token: string,
  loadSdk: () => Promise<Sdk>,
) {
  const existing = initializedDocuments.get(root);
  if (existing) return existing;
  const panel = root.querySelector<HTMLElement>('[data-analytics-consent]');
  const statusText = root.querySelector<HTMLElement>('[data-analytics-status]');
  const settings = root.querySelector<HTMLButtonElement>(
    '[data-analytics-settings]',
  );
  let settingsOpen = false;
  let dismissed = false;
  const render = () => {
    if (!panel || !settings || !statusText) return;
    const state = analytics.status();
    settings.hidden = false;
    panel.hidden = !settingsOpen && (state !== 'pending' || dismissed);
    statusText.textContent =
      state === 'privacy-signal'
        ? 'PostHog analytics is off because of your browser privacy preference.'
        : state === 'unconfigured'
          ? 'PostHog analytics is not configured on this build.'
          : state === 'non-production'
            ? 'PostHog analytics is disabled outside the production website.'
            : state === 'unavailable'
              ? 'PostHog analytics could not load. Your links still work normally.'
              : state === 'accepted'
                ? 'Optional PostHog website analytics is enabled. You can withdraw consent below.'
                : state === 'declined'
                  ? 'Optional PostHog website analytics is off.'
                  : 'Allow PostHog to measure page visits and download/store/GitHub clicks? No saved clips or clipboard data is collected.';
    root
      .querySelectorAll<HTMLButtonElement>('[data-analytics-accept]')
      .forEach((button) => {
        button.disabled = [
          'privacy-signal',
          'unconfigured',
          'non-production',
          'unavailable',
        ].includes(state);
      });
    const withdraw = root.querySelector<HTMLButtonElement>(
      '[data-analytics-withdraw]',
    );
    if (withdraw) withdraw.hidden = state !== 'accepted';
  };
  const analytics = createAnalytics({
    browser,
    token,
    loadSdk,
    onChange: render,
  });
  const click = (event: MouseEvent) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const target = event.target as Element | null;
    if (typeof target?.closest !== 'function') return;
    const button = target.closest<HTMLElement>(
      '[data-analytics-settings], [data-analytics-accept], [data-analytics-decline], [data-analytics-withdraw], [data-analytics-close]',
    );
    if (button) {
      if (button.hasAttribute('data-analytics-settings')) settingsOpen = true;
      else if (button.hasAttribute('data-analytics-close')) {
        settingsOpen = false;
        dismissed = true;
      } else {
        settingsOpen = false;
        void analytics.setConsent(
          button.hasAttribute('data-analytics-accept')
            ? 'accepted'
            : 'declined',
        );
      }
      render();
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[data-analytics-event]');
    if (!link || event.defaultPrevented) return;
    analytics.track(
      link.dataset.analyticsEvent ?? '',
      link.dataset.analyticsLocation ?? '',
    );
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== consentKey && event.key !== null) return;
    // Clearing storage or any other tab withdrawing permission stops this tab.
    if (event.newValue !== 'accepted') void analytics.setConsent('declined');
  };
  const privacyChanged = () => {
    render();
  };
  const restored = (event: PageTransitionEvent) => {
    if (event.persisted) analytics.restoredPageview();
  };
  root.addEventListener('click', click);
  root.addEventListener('auxclick', click);
  browser.addEventListener('storage', storage);
  browser.addEventListener('focus', privacyChanged);
  browser.addEventListener('pageshow', restored);
  render();
  void analytics.start();
  const dispose = () => {
    analytics.dispose();
    root.removeEventListener('click', click);
    root.removeEventListener('auxclick', click);
    browser.removeEventListener('storage', storage);
    browser.removeEventListener('focus', privacyChanged);
    browser.removeEventListener('pageshow', restored);
    initializedDocuments.delete(root);
  };
  initializedDocuments.set(root, dispose);
  return dispose;
}
