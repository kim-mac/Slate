import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
function page(path = 'index.html') {
  const file = resolve(output, path);
  assert.ok(existsSync(file), `Built page must exist: ${path}`);
  return readFileSync(file, 'utf8');
}

test('built homepage keeps the approved compact hierarchy', () => {
  const html = page();
  for (const id of [
    'main',
    'product',
    'capture',
    'quick-search',
    'desktop-capture',
    'download',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const headline = html.match(
    /<h1\b[^>]*id="hero-title"[^>]*>([\s\S]*?)<\/h1>/,
  )?.[1];
  assert.ok(headline);
  assert.equal(
    headline
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    'Save what matters. Without breaking your flow.',
  );
  assert.match(
    headline,
    /Save what matters\.\s*<br\s*\/?>(?:\s*)Without breaking your flow\./,
  );
  const supportingCopy = html.match(
    /<p class="hero-description">([\s\S]*?)<\/p>/,
  )?.[1];
  assert.equal(
    supportingCopy?.replace(/\s+/g, ' ').trim(),
    'Save useful information from ChatGPT, Claude, the web, and your desktop directly to your private local library without having to copy and paste.',
  );
  assert.equal((html.match(/<section(?:\s|>)/g) ?? []).length, 3);
  assert.doesNotMatch(html, /id="(?:local-first|workflows)"/);
});

test('hero trust line is plain secondary copy between the description and CTA buttons', () => {
  const hero = page().match(
    /<section class="hero shell"[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(hero);
  const trust = hero.match(/<p class="hero-trust">([^<]+)<\/p>/);
  assert.ok(
    trust,
    'Trust copy must be a plain paragraph, not badges or controls',
  );
  assert.equal(
    trust[1]
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    'No account required · Local-first · Your data stays on your device',
  );
  assert.ok(hero.indexOf('hero-description') < hero.indexOf('hero-trust'));
  assert.ok(hero.indexOf('hero-trust') < hero.indexOf('download-actions'));
});

test('page copy and tab metadata contain no em dashes', () => {
  for (const path of ['index.html', 'privacy/index.html']) {
    const html = page(path);
    assert.doesNotMatch(html, /\u2014|&mdash;|&#8212;|&#x2014;/i);
    assert.match(html, /<title>[^<]*Slate[^<]*<\/title>/);
  }
});

test('product preview follows the actual sidebar and full Calendar layout', () => {
  const html = page();
  const preview = html.match(
    /<figure\b[^>]*id="product"[\s\S]*?<\/figure>/,
  )?.[0];
  assert.ok(preview);
  assert.doesNotMatch(preview, /Illustrative product view|Sample content/);
  assert.match(
    preview,
    /Illustration of Slate's library and Calendar with sample clips/,
  );
  assert.match(preview, /aria-hidden="true"/);
  assert.doesNotMatch(preview, /<(?:button|input|a)\b|selected-clip/);
  assert.match(preview, /class="sidebar-results"/);
  assert.match(preview, /Local only/);
  assert.match(preview, /Search clips/);
  assert.match(preview, /New clip/);
  assert.match(preview, /class="demo-header-actions"/);
  assert.match(preview, /class="demo-calendar-panel"/);
  const weekdays = [...preview.matchAll(/class="calendar-weekday">([^<]+)</g)];
  assert.deepEqual(
    weekdays.map((match) => match[1]),
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  );
  const dates = [
    ...preview.matchAll(/class="calendar-cell[^"]*"[^>]*data-date="([^"]+)"/g),
  ];
  assert.equal(dates.length, 42);
  assert.equal(dates[0][1], '2026-09-27');
  assert.equal(dates[41][1], '2026-11-07');
  assert.match(preview, /data-date="2026-10-02"/);
  assert.match(preview, /class="calendar-clip-actions"/);
});

test('navigation highlights GitHub without inventing a star count', () => {
  const html = page();
  const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0];
  assert.ok(header);
  assert.match(header, /href="https:\/\/github\.com\/kim-mac\/Slate"/);
  assert.match(header, /GitHub/);
  assert.match(header, /Star/);
  assert.doesNotMatch(header, /Local-first|>Product</);
  assert.doesNotMatch(header, /\d[\d,.]*\s*(?:stars|Stars)/);
  assert.match(html, /Star on GitHub/);
});

test('hero keeps Windows primary and presents macOS as an unavailable secondary button', () => {
  const html = page();
  const actions = html.match(
    /<div class="download-actions">[\s\S]*?<\/div>/,
  )?.[0];
  assert.ok(actions);
  assert.match(
    actions,
    /<a class="button primary" href="#download">[\s\S]*Download for Windows/,
  );
  const macOS = actions.match(
    /<button\b([^>]*)>\s*Coming soon for macOS\s*<\/button>/,
  );
  assert.ok(macOS, 'macOS must be informational, not a link');
  assert.match(macOS[1], /class="button secondary"/);
  assert.match(macOS[1], /type="button"/);
  assert.match(macOS[1], /\bdisabled(?:\s|$)/);
  assert.doesNotMatch(macOS[1], /href=|onclick=|tabindex=/);
  assert.doesNotMatch(
    actions,
    /Star on GitHub|Download for macOS|<a[^>]*github/,
  );
});

test('navbar GitHub action has the full visible label and retains its safe destination', () => {
  const header = page().match(/<header\b[\s\S]*?<\/header>/)?.[0];
  assert.ok(header);
  const github = header.match(
    /<a\b([^>]*class="github-link"[^>]*)>([\s\S]*?)<\/a>/,
  );
  assert.ok(github);
  assert.equal(github[2].replace(/<[^>]*>/g, '').trim(), 'Star on GitHub');
  assert.match(github[2], /class="github-mark"/);
  assert.match(github[1], /href="https:\/\/github\.com\/kim-mac\/Slate"/);
  assert.match(github[1], /target="_blank"/);
  assert.match(github[1], /rel="noopener noreferrer"/);
});

test('navbar GitHub and Download corners match without reordering controls', () => {
  const html = page();
  const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0];
  assert.ok(header);
  assert.match(header, /class="github-mark"/);
  assert.ok(header.indexOf('github-link') < header.indexOf('nav-download'));
  assert.ok(header.indexOf('nav-download') < header.indexOf('theme-toggle'));
  const css = readFileSync(resolve(root, 'src/styles/global.css'), 'utf8');
  assert.ok(
    /\.github-link\s*\{[^}]*border-radius:\s*8px/.test(css),
    'GitHub corners must match Download',
  );
  assert.match(css, /\.nav-download\s*\{[^}]*border-radius:\s*8px/);
  assert.match(css, /\.theme-toggle\s*\{[^}]*border-radius:\s*50%/);
});

test('every GitHub link opens a safe new tab', () => {
  for (const path of ['index.html', 'privacy/index.html']) {
    const links = [...page(path).matchAll(/<a\b([^>]*)>/g)].filter((link) =>
      link[1].includes('href="https://github.com/kim-mac/Slate"'),
    );
    assert.equal(links.length, 2);
    for (const [, attributes] of links) {
      assert.match(attributes, /target="_blank"/);
      assert.match(attributes, /rel="noopener noreferrer"/);
    }
  }
});

test('navbar controls use compact 40px sizing and tighter spacing', () => {
  const css = readFileSync(resolve(root, 'src/styles/global.css'), 'utf8');
  assert.ok(
    /\.site-header nav\s*\{[^}]*gap:\s*12px/.test(css),
    'Navbar spacing must be 12px',
  );
  assert.match(css, /\.site-header nav a\s*\{[^}]*min-height:\s*40px/);
  assert.match(
    css,
    /\.theme-toggle\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px/,
  );
});

test('both pages have one h1, language, landmarks and a skip link', () => {
  for (const path of ['index.html', 'privacy/index.html']) {
    const html = page(path);
    assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1);
    assert.match(html, /<html[^>]*lang="en"/);
    assert.match(html, /href="#main"/);
    assert.match(html, /<main[^>]*id="main"/);
    assert.match(html, /<nav/);
    assert.match(html, /<footer/);
  }
});

test('local navigation and asset destinations resolve in static output', () => {
  for (const path of ['index.html', 'privacy/index.html']) {
    const html = page(path);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
    for (const [, url] of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
      assert.ok(url.length > 0, 'No empty links or assets');
      if (url.startsWith('#')) {
        assert.ok(ids.includes(url.slice(1)), `Missing anchor ${url}`);
      } else if (url.startsWith('/')) {
        const pathname = url.split('#')[0].split('?')[0];
        const target = pathname.endsWith('/')
          ? `${pathname}index.html`
          : pathname;
        assert.ok(
          existsSync(resolve(output, `.${target}`)),
          `Missing local destination ${url}`,
        );
      }
    }
  }
});

test('published Windows assets are linked without exposing the CWS upload ZIP or store', () => {
  const html = page();
  const installers = [...html.matchAll(/href="([^"]+\.exe)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(installers.sort(), [
    'https://github.com/kim-mac/Slate/releases/download/v0.1.0/Slate-0.1.0-Windows-ARM64.exe',
    'https://github.com/kim-mac/Slate/releases/download/v0.1.0/Slate-0.1.0-Windows-x64.exe',
  ]);
  assert.doesNotMatch(html, /href="[^"]*(?:\.zip|chromewebstore\.google\.com)/);
  assert.match(
    html,
    /<button[^>]*disabled[^>]*title="Store listing not available yet"[^>]*>[\s\S]*?Add to Chrome/,
  );
  assert.doesNotMatch(html, /Public download links are not live yet/);
  assert.doesNotMatch(html, /Download for macOS|Apple Silicon/);
});

test('launch copy keeps only the platform label and a secondary SmartScreen disclosure', () => {
  const html = page();
  assert.match(html, /<p class="availability">\s*Windows 11\s*<\/p>/);
  assert.doesNotMatch(
    html,
    /Public downloads coming soon|public download links are not live yet\./i,
  );
  assert.match(
    html,
    /Slate for Windows and the Chrome extension work together\. Browser capture\s+requires the desktop app\./,
  );
  assert.match(
    html,
    /<p class="small-note download-safety">\s*Unsigned Windows installers may trigger Microsoft Defender SmartScreen\.\s*<\/p>/,
  );
});

test('public pages use the production apex for canonical and sharing metadata', () => {
  const routes = [
    {
      file: 'index.html',
      path: '/',
      title: 'Slate | Save what matters. Without breaking your flow.',
      description:
        'Save useful information from ChatGPT, Claude, the web, and your desktop directly to your private local library without having to copy and paste.',
    },
    {
      file: 'privacy/index.html',
      path: '/privacy/',
      title: 'Privacy &amp; local-first | Slate',
      description:
        'How Slate Desktop and its browser extension process captures locally, store your library on your computer, and handle privacy.',
    },
    {
      file: 'support/index.html',
      path: '/support/',
      title: 'Slate Support | Slate',
      description:
        'Help with Slate for Windows, browser capture, Quick Search, and Merge.',
    },
  ];
  for (const { file, path, title, description } of routes) {
    const html = page(file);
    const canonical = 'https://tryslate.tech' + path;
    const image = 'https://tryslate.tech/brand/social-preview.png';
    assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1);
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`));
    assert.ok(html.includes(`<title>${title}</title>`));
    for (const [attribute, name, content] of [
      ['name', 'description', description],
      ['property', 'og:url', canonical],
      ['property', 'og:title', title],
      ['property', 'og:description', description],
      ['property', 'og:image', image],
      ['name', 'twitter:title', title],
      ['name', 'twitter:description', description],
      ['name', 'twitter:image', image],
    ]) {
      assert.ok(
        html.includes(`<meta ${attribute}="${name}" content="${content}"`),
        `${file} must have the expected ${name}`,
      );
    }
    assert.doesNotMatch(html, /name="robots" content="noindex/);
    assert.doesNotMatch(html, /https?:\/\/localhost|pages\.dev|slate\.example/);
    assert.match(html, /href="\/privacy\/"/);
    assert.match(html, /href="\/support\/"/);
  }
  const notFound = page('404.html');
  assert.match(notFound, /name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(notFound, /rel="canonical"|property="og:url"/);
});

test('production robots and sitemap expose only the three public apex routes', () => {
  assert.equal(
    page('robots.txt'),
    'User-agent: *\nAllow: /\nSitemap: https://tryslate.tech/sitemap.xml\n',
  );
  const xml = page('sitemap.xml');
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.deepEqual(
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
    [
      'https://tryslate.tech/',
      'https://tryslate.tech/privacy/',
      'https://tryslate.tech/support/',
    ],
  );
  assert.doesNotMatch(xml, /404|localhost|pages\.dev|www\.tryslate/);
});

test('explicitly unconfigured domain helpers still fail closed', async () => {
  const { canonicalUrl, sitemapXml, robotsText } =
    await import('../src/data/site.ts');
  assert.equal(canonicalUrl('/', null), null);
  assert.equal(sitemapXml(null), null);
  assert.equal(robotsText(null), 'User-agent: *\nDisallow: /\n');
});

test('preview omits the caption and feature cards prioritize capture without breaking flow', () => {
  const html = page();
  assert.doesNotMatch(html, /Illustrative product view|Sample content/);
  const cards = [
    ...html.matchAll(/<article id="([^"]+)"[^>]*>[\s\S]*?<\/article>/g),
  ];
  assert.deepEqual(
    cards.map((card) => card[1]),
    ['capture', 'desktop-capture', 'quick-search'],
  );
  assert.match(cards[0][0], /ChatGPT|Claude/);
  assert.match(cards[0][0], /copy-pasting/);
  assert.match(
    cards[1][0],
    /<kbd>Ctrl<\/kbd>[\s\S]*<kbd>Alt<\/kbd>[\s\S]*<kbd>Shift<\/kbd>[\s\S]*<kbd>C<\/kbd>/,
  );
  assert.equal(
    (html.match(/class="[^"]*\bdemo-placeholder\b[^"]*"/g) ?? []).length,
    0,
  );
  assert.doesNotMatch(html, /Video coming soon/);
  assert.match(cards[0][0], /Save selection/);
  assert.match(cards[0][0], /Saved locally/);
  assert.match(cards[1][0], /Saved to Slate/);
  assert.match(
    cards[2][0],
    /<kbd>Ctrl<\/kbd>[\s\S]*<kbd>Shift<\/kbd>[\s\S]*<kbd>Space<\/kbd>/,
  );
  assert.equal(
    (html.match(/<div\b[^>]*\sdata-feature-demo(?:\s|>)/g) ?? []).length,
    3,
  );
  assert.doesNotMatch(html, /<video|id="merge"|>Merge<|Unmerge/);
  assert.doesNotMatch(
    html,
    /Semantic Smart Merge|Slate Connectors|MCP server|Muse integration|encrypted database/,
  );
});

test('site ships no hydrated app, remote scripts, forms or trackers', () => {
  for (const path of ['index.html', 'privacy/index.html']) {
    const html = page(path);
    assert.doesNotMatch(html, /astro-island|<iframe|<form/);
    const scripts = [
      ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
    ];
    assert.equal(scripts.length, path === 'index.html' ? 3 : 1);
    assert.match(scripts[0][1], /data-slate-theme/);
    assert.doesNotMatch(scripts[0][1], /\bsrc=/);
    if (path === 'index.html') {
      for (const [index, script] of scripts.slice(1).entries()) {
        assert.match(script[1], /type="module"/);
        const localScript = script[1].match(/src="([^"]+)"/)?.[1];
        if (localScript) {
          assert.ok(localScript.startsWith('/_astro/'));
          assert.ok(existsSync(resolve(output, `.${localScript}`)));
        } else if (index === 0) {
          assert.match(script[2], /IntersectionObserver/);
          assert.match(script[2], /prefers-reduced-motion/);
          assert.doesNotMatch(
            script[2],
            /requestAnimationFrame|setInterval|fetch\(/,
          );
        } else {
          assert.match(script[2], /getHighEntropyValues/);
          assert.match(script[2], /clipboard\.writeText/);
        }
      }
    }
    assert.doesNotMatch(
      html,
      /googletagmanager|google-analytics|plausible\.io|segment\.com/,
    );
  }
});

test('both pages expose an accessible compact theme toggle and dark surfaces', () => {
  for (const path of ['index.html', 'privacy/index.html']) {
    const html = page(path);
    assert.match(html, /<button[^>]*data-theme-toggle/);
    assert.match(html, /aria-label="Switch to dark mode"/);
    assert.match(html, /class="theme-sun"/);
    assert.match(html, /class="theme-moon"/);
    assert.ok(html.indexOf('data-slate-theme') < html.indexOf('<body'));
  }
  const tokens = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8');
  assert.match(tokens, /:root\[data-theme='dark'\]/);
  assert.match(tokens, /color-scheme:\s*dark/);
});

function themeHarness({
  stored = null,
  systemDark = false,
  blocked = false,
} = {}) {
  const html = page();
  const source = html.match(
    /<script[^>]*data-slate-theme[^>]*>([\s\S]*?)<\/script>/,
  )?.[1];
  assert.ok(source, 'Theme initialization must ship in the built page');
  const callbacks = {};
  const button = {
    attributes: {},
    addEventListener: (name, fn) => {
      callbacks[name] = fn;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const rootElement = { dataset: {} };
  const meta = {
    setAttribute: (name, value) => {
      assert.equal(name, 'content');
      callbacks.meta = value;
    },
  };
  let value = stored;
  const document = {
    documentElement: rootElement,
    querySelector: (selector) =>
      selector === '[data-theme-toggle]' ? button : meta,
    addEventListener: (name, fn) => {
      callbacks[name] = fn;
    },
  };
  const window = {
    localStorage: {
      getItem: () => {
        if (blocked) throw new Error('Storage unavailable');
        return value;
      },
      setItem: (key, next) => {
        assert.equal(key, 'slate-site-theme');
        if (blocked) throw new Error('Storage unavailable');
        value = next;
      },
    },
    matchMedia: () => ({ matches: systemDark }),
    addEventListener: (name, fn) => {
      callbacks[name] = fn;
    },
  };
  runInNewContext(source, { document, window });
  callbacks.DOMContentLoaded();
  return { rootElement, button, callbacks, stored: () => value };
}

test('theme starts from saved choice before paint, then toggles and persists', () => {
  const state = themeHarness({ stored: 'dark' });
  assert.equal(state.rootElement.dataset.theme, 'dark');
  assert.equal(state.button.attributes['aria-label'], 'Switch to light mode');
  assert.equal(state.callbacks.meta, '#171717');
  state.callbacks.click();
  assert.equal(state.rootElement.dataset.theme, 'light');
  assert.equal(state.stored(), 'light');
  assert.equal(state.button.attributes['aria-label'], 'Switch to dark mode');
  state.callbacks.click();
  assert.equal(state.rootElement.dataset.theme, 'dark');
  assert.equal(state.stored(), 'dark');
});

test('theme falls back to system preference and still works without storage', () => {
  for (const blocked of [false, true]) {
    const state = themeHarness({
      stored: 'invalid',
      systemDark: true,
      blocked,
    });
    assert.equal(state.rootElement.dataset.theme, 'dark');
    state.callbacks.click();
    assert.equal(state.rootElement.dataset.theme, 'light');
  }
  assert.equal(themeHarness().rootElement.dataset.theme, 'light');
  assert.equal(
    themeHarness({ stored: 'light', systemDark: true }).rootElement.dataset
      .theme,
    'light',
  );
});

test('built CSS loads only present local font assets and ships their license', () => {
  const directory = resolve(output, '_astro');
  const styles = readdirSync(directory).filter((name) => name.endsWith('.css'));
  assert.ok(styles.length > 0);
  let fontCount = 0;
  for (const name of styles) {
    const css = readFileSync(resolve(directory, name), 'utf8');
    for (const [, raw] of css.matchAll(/url\(([^)]+)\)/g)) {
      const url = raw.replace(/^["']|["']$/g, '');
      assert.doesNotMatch(url, /^https?:/);
      if (url.startsWith('data:')) continue;
      const asset = url.startsWith('/')
        ? resolve(output, `.${url}`)
        : resolve(directory, url);
      assert.ok(existsSync(asset), 'Missing CSS asset ' + url);
      if (url.endsWith('.woff2')) fontCount++;
    }
  }
  assert.equal(
    fontCount,
    1,
    'Load one variable Latin font, not every weight/subset',
  );
  assert.match(page('fonts/OFL.txt'), /SIL OPEN FONT LICENSE/);
});

test('motion is nonessential and focus styling is explicit', () => {
  const css = readFileSync(resolve(root, 'src/styles/global.css'), 'utf8');
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:\s*none\s*!important/);
  assert.match(css, /scroll-behavior:\s*auto\s*!important/);
});

test('privacy heading keeps a single inherited text color', () => {
  const directory = resolve(output, '_astro');
  for (const name of readdirSync(directory).filter((name) =>
    name.endsWith('.css'),
  )) {
    const css = readFileSync(resolve(directory, name), 'utf8');
    assert.ok(
      !/\.privacy-page h1 span\s*\{[^}]*\bcolor\s*:/.test(css),
      'Privacy heading must not override its second line with a separate color',
    );
  }
});

test('brand copies are byte-for-byte approved extension assets', () => {
  const repository = resolve(root, '../..');
  for (const [copy, source] of [
    ['brand/slate-icon.png', 'icon-128.png'],
    ['favicon.png', 'icon-32.png'],
  ]) {
    const hash = (file) =>
      createHash('sha256').update(readFileSync(file)).digest('hex');
    assert.equal(
      hash(resolve(root, 'public', copy)),
      hash(resolve(repository, 'apps/extension/public/icons', source)),
    );
  }
});
