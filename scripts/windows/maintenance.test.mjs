import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const gate = read('apps/desktop/src-tauri/windows/maintenance-gate.nsh');
const installer = read('apps/desktop/src-tauri/windows/installer.nsi');
const body = (source, name) =>
  source.split(`Function ${name}\n`)[1]?.split('FunctionEnd')[0];

test('maintenance recovery releases byte locks before the recovery dialog', () => {
  const recovery = body(
    gate.replaceAll('\r\n', '\n'),
    '${PREFIX}SlateMaintenanceRecover',
  );
  assert.ok(recovery, 'shared installer/uninstaller recovery is required');
  assert.ok(
    recovery.indexOf('SlateUnlockMaintenance') <
      recovery.indexOf('MessageBoxW'),
  );
  assert.match(recovery, /\$PassiveMode/);
  assert.match(recovery, /\$UpdateMode/);
  assert.match(recovery, /\$\{Silent\}/);
  for (const text of [
    'Slate is still running',
    'Please right-click the Slate icon in your system tray and select Quit Slate. Then click Retry.',
    'Slate is busy',
    'Slate is finishing an operation. Please wait a moment, then try again.',
    'Unable to continue safely',
    "Slate couldn't confirm that it's safe to continue.",
  ])
    assert.ok(recovery.includes(text), text);
  assert.doesNotMatch(
    recovery,
    /Chromium|legacy|migration|database corruption/,
  );
});

test('retry revalidates one retained gate rather than exporting more identity pins', () => {
  const acquire = body(
    gate.replaceAll('\r\n', '\n'),
    '${PREFIX}SlateAcquireMaintenance',
  );
  assert.match(acquire, /--validate-maintenance-handle/);
  assert.equal(gate.split('--export-maintenance-handle').length - 1, 1);
  assert.match(gate, /SlateGateAdmission/);
  assert.match(gate, /SlateGateActivity/);
  const wait = body(
    gate.replaceAll('\r\n', '\n'),
    '${PREFIX}SlateWaitForProcesses',
  );
  assert.match(wait, /SlateAcquireMaintenance/);
  assert.match(wait, /--check-maintenance-processes/);
  assert.doesNotMatch(wait, /RmGetList/);
});

test('same-version repair does not advertise unsupported nested uninstall', () => {
  const same = installer
    .split('; Reinstalling the same version')[1]
    ?.split('; Upgrading')[0];
  assert.ok(same);
  assert.doesNotMatch(same, /\$\(uninstallApp\)/);
  assert.match(same, /\$\(cancelInstallation\)/);
  const leave = body(installer.replaceAll('\r\n', '\n'), 'PageLeaveReinstall');
  assert.match(leave, /User chose to cancel/);
});

test('supported manual upgrades offer in-place installation and Cancel', () => {
  const upgrade = installer
    .split('  ; Upgrading')[1]
    ?.split('  ; Downgrading')[0];
  assert.ok(upgrade);
  assert.match(upgrade, /\$\(inPlaceUpdate\)/);
  assert.match(upgrade, /\$\(cancelInstallation\)/);
  assert.doesNotMatch(upgrade, /\$\(uninstallBeforeInstalling\)/);
});

test('passive repair never reads nonexistent radio controls or selects Cancel', () => {
  const leave = body(installer.replaceAll('\r\n', '\n'), 'PageLeaveReinstall');
  assert.match(leave, /\$PassiveMode = 1/);
  assert.ok(
    leave.indexOf('$PassiveMode = 1') < leave.indexOf('${NSD_GetState}'),
  );
});

test('NSIS never forces other processes or adds an external shutdown channel', () => {
  assert.doesNotMatch(
    gate,
    /RmShutdown|taskkill|TerminateProcess|WM_CLOSE|nsProcess/,
  );
  assert.doesNotMatch(gate, /https?:|named.pipe|ConnectNamedPipe/);
  assert.match(installer, /RequestExecutionLevel user/);
  const uninstallInit = body(installer.replaceAll('\r\n', '\n'), 'un.onInit');
  assert.ok(
    uninstallInit.indexOf('"/UPDATE"') <
      uninstallInit.indexOf('SlateAcquireMaintenance'),
  );
});
