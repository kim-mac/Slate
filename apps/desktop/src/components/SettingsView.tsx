import { APP_NAME } from '@ai-clip-memory/shared';
import { getVersion } from '@tauri-apps/api/app';
import { BookOpen, Info, Keyboard, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { StartupClient } from '../startupClient';
import { StartupSetting } from './StartupSetting';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';

interface SettingsViewProps {
  startupClient: StartupClient;
  readVersion?: () => Promise<string>;
}

interface ShortcutDefinition {
  label: string;
  keys: string[];
}

const SHORTCUT_GROUPS: Array<{
  label: string;
  shortcuts: ShortcutDefinition[];
}> = [
  {
    label: 'Global',
    shortcuts: [
      { label: 'Open Quick Search', keys: ['Ctrl', 'Shift', 'Space'] },
      {
        label: 'Save selected text from the active app',
        keys: ['Ctrl', 'Alt', 'Shift', 'C'],
      },
    ],
  },
  {
    label: 'Quick Search',
    shortcuts: [
      { label: 'Move through results', keys: ['↑', '↓'] },
      { label: 'Copy selected clip', keys: ['Enter'] },
      {
        label: 'Save Quick Capture / Quick Edit',
        keys: ['Ctrl', 'Enter'],
      },
      { label: 'Go back / close', keys: ['Esc'] },
      { label: 'Copy selected preview text', keys: ['Ctrl', 'C'] },
    ],
  },
  {
    label: 'Desktop Library',
    shortcuts: [
      { label: 'Focus search', keys: ['Ctrl', 'F'] },
      { label: 'Copy open clip', keys: ['Ctrl', 'Shift', 'C'] },
      { label: 'Show / hide sidebar', keys: ['Ctrl', 'B'] },
    ],
  },
];

function SettingsSectionTitle({
  icon: Icon,
  id,
  children,
}: {
  icon: typeof Keyboard;
  id: string;
  children: string;
}) {
  return (
    <div className="settings-section-title">
      <Icon aria-hidden="true" />
      <h2 id={id}>{children}</h2>
    </div>
  );
}

export function SettingsView({
  startupClient,
  readVersion = getVersion,
}: SettingsViewProps) {
  const [version, setVersion] = useState<string | null>(null);
  const [versionUnavailable, setVersionUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void readVersion()
      .then((value) => {
        if (!active) return;
        if (value.trim()) setVersion(value);
        else setVersionUnavailable(true);
      })
      .catch(() => {
        if (active) setVersionUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [readVersion]);

  return (
    <section className="settings-view" aria-labelledby="settings-heading">
      <ScrollArea className="settings-scroll-area">
        <div className="settings-view-content">
          <header className="section-header">
            <h1 id="settings-heading">Settings</h1>
            <p>Shortcuts, startup, privacy, and information about Slate.</p>
          </header>

          <section
            className="settings-section"
            aria-labelledby="keyboard-shortcuts-heading"
          >
            <SettingsSectionTitle
              icon={Keyboard}
              id="keyboard-shortcuts-heading"
            >
              Keyboard Shortcuts
            </SettingsSectionTitle>
            <Card>
              <CardContent>
                <div
                  className="shortcut-groups"
                  aria-label="Keyboard shortcuts"
                >
                  {SHORTCUT_GROUPS.map((group) => (
                    <section className="shortcut-group" key={group.label}>
                      <h3>{group.label}</h3>
                      <dl>
                        {group.shortcuts.map((shortcut) => (
                          <div className="shortcut-row" key={shortcut.label}>
                            <dt>{shortcut.label}</dt>
                            <dd>
                              {shortcut.keys.map((key) => (
                                <kbd key={key}>{key}</kbd>
                              ))}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="settings-section" aria-labelledby="usage-heading">
            <SettingsSectionTitle icon={BookOpen} id="usage-heading">
              How to Use Slate
            </SettingsSectionTitle>
            <Card>
              <CardContent className="usage-grid">
                <div>
                  <h3>Save from your browser</h3>
                  <p>
                    Highlight text, right-click, and choose{' '}
                    <strong>Save selection</strong>, or right-click and choose{' '}
                    <strong>Save this page</strong>. ChatGPT, Claude, and Gemini
                    also show a floating Save control for selected page text.
                  </p>
                </div>
                <div>
                  <h3>Capture from a Windows app</h3>
                  <p>
                    Select text in the active application and press
                    Ctrl+Alt+Shift+C. Slate saves the selected text locally.
                  </p>
                </div>
                <div>
                  <h3>Quick Capture</h3>
                  <p>
                    Ctrl+Shift+Space opens Quick Search while Slate is running.
                    Choose New to save text or a URL without opening the full
                    desktop window.
                  </p>
                </div>
                <div>
                  <h3>Find and reuse</h3>
                  <p>
                    Search or browse in the desktop library or Quick Search. In
                    Quick Search, use the arrow keys to move and Enter to copy.
                  </p>
                </div>
                <div>
                  <h3>Edit and delete</h3>
                  <p>
                    Edit or delete clips from Quick Search or the desktop
                    library. Slate asks for confirmation before deletion.
                  </p>
                </div>
                <div>
                  <h3>Calendar</h3>
                  <p>Browse clips by the local date they were saved.</p>
                </div>
                <div>
                  <h3>Runs in the background</h3>
                  <p>
                    Closing the main Slate window keeps Slate running in the
                    background. Use the tray menu to reopen Slate or quit
                    completely.
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>

          <section
            className="settings-section"
            aria-labelledby="startup-heading"
          >
            <SettingsSectionTitle icon={Info} id="startup-heading">
              Background &amp; Startup
            </SettingsSectionTitle>
            <p className="settings-section-description">
              Closing the main window keeps Slate running in the background so
              global shortcuts remain available. Use the tray menu to reopen or
              quit Slate.
            </p>
            <StartupSetting client={startupClient} />
          </section>

          <section
            className="settings-section"
            aria-labelledby="privacy-heading"
          >
            <SettingsSectionTitle icon={ShieldCheck} id="privacy-heading">
              Privacy &amp; Data
            </SettingsSectionTitle>
            <Card className="privacy-note">
              <CardContent className="settings-prose">
                <p>
                  Your clips and source information are stored locally on this
                  device in the Windows app data folder. Slate requires no
                  account or cloud sync and does not upload your clips or usage
                  analytics.
                </p>
                <Separator />
                <p>
                  The local SQLite database is plaintext and is not encrypted by
                  Slate. Protect access to your Windows account and device.
                </p>
              </CardContent>
            </Card>
          </section>

          <section className="settings-section" aria-labelledby="about-heading">
            <SettingsSectionTitle icon={Info} id="about-heading">
              About
            </SettingsSectionTitle>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h3>{APP_NAME}</h3>
                </CardTitle>
              </CardHeader>
              <CardContent className="settings-prose">
                <p>Local-first capture for things you want to find again.</p>
                <p className="settings-version">
                  {version
                    ? `Version ${version}`
                    : versionUnavailable
                      ? 'Version unavailable'
                      : 'Checking version…'}
                </p>
              </CardContent>
            </Card>
          </section>
        </div>
      </ScrollArea>
    </section>
  );
}
