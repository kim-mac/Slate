import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const supported = process.platform === 'win32';
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(predicate, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out: ${description}`);
    await pause(20);
  }
}
let fixture;
function prepare() {
  if (fixture) return fixture;
  const base = join(root, 'dist/test/w2-nsis');
  mkdirSync(base, { recursive: true });
  const project = mkdtempSync(join(base, 'run-'));
  const manifestDirectory = join(project, 'apps/desktop/src-tauri');
  mkdirSync(manifestDirectory, { recursive: true });
  mkdirSync(join(project, 'dist/test'), { recursive: true });
  const modulePath = (name) =>
    JSON.stringify(
      join(
        root,
        `apps/desktop/src-tauri/src/installation_safety/${name}.rs`,
      ).replaceAll('\\', '/'),
    );
  const cargo = readFileSync(
    join(root, 'apps/desktop/src-tauri/Cargo.toml'),
    'utf8',
  );
  const windowsDependency = cargo.match(
    /windows = \{ version = [\s\S]*?\] \}/,
  )?.[0];
  assert.ok(windowsDependency);
  writeFileSync(
    join(manifestDirectory, 'Cargo.toml'),
    `[package]\nname="w2-maintenance-fixture"\nversion="0.0.0"\nedition="2021"\n[dependencies]\nwinreg="0.55"\n${windowsDependency}\n[[bin]]\nname="maintenance-fixture"\npath="main.rs"\n`,
  );
  // This wrapper exists only in ignored output. Its authority is the production
  // cfg(test) bounded fixture constructor, never the real user's profile.
  writeFileSync(
    join(manifestDirectory, 'main.rs'),
    `#![windows_subsystem = "windows"]
#[path=${modulePath('gate')}] mod gate;
#[path=${modulePath('maintenance')}] mod maintenance;
use std::{io::{self, Write},path::PathBuf};
fn state() -> PathBuf { PathBuf::from(std::fs::read_to_string(${JSON.stringify(join(project, 'current-state').replaceAll('\\', '/'))}).unwrap()) }
fn main() {
 let args: Vec<_> = std::env::args_os().skip(1).collect();
 let mode = args.first().and_then(|s|s.to_str()).unwrap_or("");
 let state = state();
 if mode == "--create-install" { gate::InstallationGate::create_test_profile(&state.join("install")).unwrap(); return; }
 if mode == "--live" {
  std::fs::write(state.join("live-pid"), std::process::id().to_string()).unwrap();
  let end=std::time::Instant::now()+std::time::Duration::from_secs(30);
  while !state.join("release-live").exists() && std::time::Instant::now()<end { std::thread::sleep(std::time::Duration::from_millis(10)); }
  return;
 }
 if mode == "--release-live" {
  std::fs::write(state.join("release-live"), b"release").unwrap();
  if let Ok(pid) = std::fs::read_to_string(state.join("live-pid")) {
   use windows::Win32::{System::Threading::{OpenProcess,WaitForSingleObject,PROCESS_SYNCHRONIZE},Foundation::{CloseHandle,WAIT_OBJECT_0}};
   if let Ok(h) = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid.parse().unwrap()) } {
    let result = unsafe { WaitForSingleObject(h, 5000) };
    unsafe { let _ = CloseHandle(h); }
    if result != WAIT_OBJECT_0 { std::process::exit(40); }
   }
  }
  return;
 }
 let profile = PathBuf::from(${JSON.stringify(join(project, 'dist/test/profile'))});
 if !profile.exists() { gate::InstallationGate::create_test_profile(&profile).unwrap(); }
 let gate = gate::InstallationGate::for_test_root(&profile).unwrap();
 if mode == "--admit-once" { std::process::exit(if gate.admit().is_ok(){0}else{11}); }
 if mode == "--hold-activity" || mode == "--hold-admission" {
  let _permit = if mode == "--hold-activity" { gate.admit().unwrap() } else { gate.hold_admission().unwrap() };
  std::fs::write(state.join("operation-ready"),b"ready").unwrap();
  let (send,receive)=std::sync::mpsc::channel();
  std::thread::spawn(move || { let mut line=String::new(); let _=io::stdin().read_line(&mut line); let _=send.send(()); });
  let _=receive.recv_timeout(std::time::Duration::from_secs(60)); return;
 }
 if mode == "--export-maintenance-handle" {
  let result=gate.export_maintenance_handle_with(args[1].to_str().unwrap().parse().unwrap(), |h| { let mut out=io::stdout().lock(); write!(out,"{h}")?; out.flush() });
  std::process::exit(if result.is_ok(){0}else{1});
 }
 let request=match maintenance::parse_request(&args) { Ok(r)=>r, Err(e)=>std::process::exit(e.exit_code()) };
 let mut result=request.execute(&gate).exit_code();
 if mode == "--check-maintenance-processes" && result == 0 {
  // Inject helper outcomes only after the real authority/target/process check.
  // This drives recovery UI tests without creating unsafe production controls.
  if let Ok(codes)=std::fs::read_to_string(state.join("codes")) {
   let mut lines=codes.lines();
   if let Some(code)=lines.next() { result=code.parse().unwrap(); std::fs::write(state.join("codes"),lines.collect::<Vec<_>>().join("\\n")).unwrap(); }
  }
 }
 std::process::exit(result);
}
`,
  );
  run('cargo', [
    'generate-lockfile',
    '--offline',
    '--manifest-path',
    join(manifestDirectory, 'Cargo.toml'),
  ]);
  const target = join(root, 'dist/test/w2-nsis-target');
  run('cargo', [
    'rustc',
    '--offline',
    '--locked',
    '--manifest-path',
    join(manifestDirectory, 'Cargo.toml'),
    '--target-dir',
    target,
    '--bin',
    'maintenance-fixture',
    '--',
    '--cfg',
    'test',
    '-Awarnings',
  ]);
  const helper = join(target, 'debug/maintenance-fixture.exe');
  const compiler = join(
    process.env.LOCALAPPDATA,
    'tauri/NSIS/Bin/makensis.exe',
  );
  assert.ok(existsSync(compiler), 'The established NSIS compiler is required');
  const source = readFileSync(
    join(root, 'apps/desktop/src-tauri/windows/maintenance-gate.nsh'),
    'utf8',
  );
  const prompts = source.match(/System::Call 'user32::MessageBoxW[^\r\n]+/g);
  assert.equal(
    prompts?.length,
    3,
    'Only the user decision boundary is substituted',
  );
  const include = join(project, 'maintenance-fixture.nsh');
  writeFileSync(
    include,
    source.replace(
      /System::Call 'user32::MessageBoxW[^\r\n]+/g,
      'Call ${PREFIX}FixturePrompt',
    ),
  );
  fixture = { project, helper, compiler, include };
  return fixture;
}

async function scenario({
  codes = [],
  cancel = false,
  live = false,
  passive = false,
  silent = false,
  update = false,
  uninstall = false,
  hold = null,
  repairVersion = null,
  deferOperationRelease = false,
} = {}) {
  const PREFIX = '${PREFIX}';
  const If = '${If}';
  const EndIf = '${EndIf}';
  const f = prepare();
  const directory = mkdtempSync(join(f.project, 'dist/test/case-'));
  const install = join(directory, 'install');
  writeFileSync(join(f.project, 'current-state'), directory);
  run(f.helper, ['--create-install']);
  writeFileSync(join(directory, 'codes'), codes.join('\n'));
  let child;
  let result;
  try {
    if (live) {
      const image = join(install, 'ai-clip-memory-desktop.exe');
      copyFileSync(f.helper, image);
      child = spawn(image, ['--live'], { windowsHide: true, stdio: 'ignore' });
      await until(
        () => existsSync(join(directory, 'live-pid')),
        'synthetic desktop readiness',
      );
    }
    if (hold) {
      child = spawn(f.helper, [`--hold-${hold}`], {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      await until(
        () => existsSync(join(directory, 'operation-ready')),
        'synthetic activity readiness',
      );
    }
    const nsi = String.raw`Unicode true
RequestExecutionLevel user
Name "W2 disposable maintenance fixture"
OutFile "fixture.exe"
!include LogicLib.nsh
!define MAINBINARYNAME "ai-clip-memory-desktop"
Var PassiveMode
Var UpdateMode
Var Log
Var Prompts
Var Count
Var WixMode
!macro SlateEmbedMaintenanceHost
 File /oname=slate-maintenance-host.exe "${f.helper}"
!macroend
!include "${f.include}"
${
  repairVersion === null
    ? ''
    : readFileSync(
        join(root, 'apps/desktop/src-tauri/windows/installer.nsi'),
        'utf8',
      )
        .split('Function PageLeaveReinstall')[1]
        .split('FunctionEnd')[0]
        .replace('${NSD_GetState} $R2 $R1', 'StrCpy $R1 0')
        .replaceAll(/\$\([^)]+\)/g, 'unsupported legacy transition')
        .replace(/^/, 'Function PageLeaveReinstall')
        .concat('FunctionEnd')
}
!macro FixtureFunctions PREFIX
Function ${PREFIX}FixturePrompt
 IntOp $Prompts $Prompts + 1
 System::Call 'kernel32::GetProcessHandleCount(p -1, *i .R0) i.r0'
 FileOpen $Log "${directory}\events" a
 FileSeek $Log 0 END
 FileWrite $Log "prompt=$Prompts kind=$SlateMaintenanceKind code=$SlateMaintenanceCode handle=$SlateGateHandle count=$R0$\r$\n"
 nsExec::ExecToStack '"$PLUGINSDIR\slate-maintenance-host.exe" --admit-once'
 Pop $0
 Pop $1
 FileWrite $Log "recovery-admission=$0$\r$\n"
 FileClose $Log
 nsExec::ExecToStack '"$PLUGINSDIR\slate-maintenance-host.exe" --release-live'
 Pop $0
 Pop $1
 ${cancel ? 'StrCpy $0 2' : 'StrCpy $0 4'}
 ${If} $Prompts > 8
  StrCpy $0 2
 ${EndIf}
FunctionEnd
!macroend
!insertmacro FixtureFunctions ""
!insertmacro FixtureFunctions "un."
!macro RunFixture PREFIX
 StrCpy $INSTDIR "${install}"
 StrCpy $PassiveMode ${passive ? 1 : 0}
 StrCpy $UpdateMode ${update ? 1 : 0}
 Call ${PREFIX}SlateWaitForProcesses
 ${repairVersion === null ? '' : '!if "${PREFIX}" == ""\n StrCpy $PassiveMode 1\n StrCpy $UpdateMode 0\n StrCpy $R0 ' + repairVersion + '\n Call PageLeaveReinstall\n !endif'}
 ; Validate again while locked. Closing helper duplicates must not unlock NSIS.
 Call ${PREFIX}SlateWaitForProcesses
 FileOpen $Log "${directory}\events" a
 FileSeek $Log 0 END
 nsExec::ExecToStack '"$PLUGINSDIR\slate-maintenance-host.exe" --admit-once'
 Pop $0
 Pop $1
 FileWrite $Log "exclusive-admission=$0$\r$\n"
 Call ${PREFIX}SlateReleaseMaintenance
 nsExec::ExecToStack '"$PLUGINSDIR\slate-maintenance-host.exe" --admit-once'
 Pop $0
 Pop $1
 FileWrite $Log "released-admission=$0$\r$\n"
 FileClose $Log
 SetErrorLevel 0
 Quit
!macroend
Function .onInit
 ${uninstall ? 'WriteUninstaller "' + join(directory, 'fixture-uninstall.exe') + '"\n SetErrorLevel 0\n Quit' : '!insertmacro RunFixture ""'}
FunctionEnd
Function un.onInit
 !insertmacro RunFixture "un."
FunctionEnd
Section
SectionEnd
Section Uninstall
SectionEnd
`;
    // String.raw preserves NSIS escapes; remove only JS escapes on macro tokens.
    writeFileSync(join(directory, 'fixture.nsi'), nsi.replaceAll('\\${', '${'));
    run(f.compiler, ['/V2', join(directory, 'fixture.nsi')], {
      cwd: directory,
    });
    if (uninstall) run(join(directory, 'fixture.exe'), []);
    const executable = join(
      directory,
      uninstall ? 'fixture-uninstall.exe' : 'fixture.exe',
    );
    result = spawn(executable, silent ? ['/S'] : [], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const exit = new Promise((done, reject) => {
      result.once('error', reject);
      result.once('exit', done);
    });
    if (hold) {
      // Release the owned fixture operation naturally. NSIS is waiting, not killing it.
      if (deferOperationRelease) {
        await until(
          () =>
            existsSync(join(directory, 'events')) &&
            readFileSync(join(directory, 'events'), 'utf8').includes(
              'recovery-admission=0',
            ),
          'partial admission released before recovery',
          45_000,
        );
      } else {
        await pause(250);
      }
      child.stdin.end('finish\n');
    }
    let timer;
    let code;
    try {
      code = await Promise.race([
        exit,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('Disposable NSIS fixture exceeded 45 seconds')),
            45_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (child) {
      // Also release a live fixture for passive/cancel cases without touching Slate.
      writeFileSync(join(directory, 'release-live'), 'release');
      await until(
        () => child.exitCode !== null,
        'fixture process natural exit',
      );
    }
    const events = existsSync(join(directory, 'events'))
      ? readFileSync(join(directory, 'events'), 'utf8')
      : '';
    const admission = spawnSync(f.helper, ['--admit-once'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(
      admission.status,
      0,
      'No byte ownership remains after process exit',
    );
    return { code, events, directory };
  } finally {
    // These are exclusively this scenario's generated fixture processes.
    writeFileSync(join(directory, 'release-live'), 'release');
    child?.stdin?.end();
    if (child)
      await until(
        () => child.exitCode !== null || child.signalCode !== null,
        'fixture cleanup',
      );
    if (result && result.exitCode === null && result.signalCode === null) {
      result.kill(); // Timeout cleanup of fixture.exe only, never Slate.
      await until(
        () => result.exitCode !== null || result.signalCode !== null,
        'NSIS fixture cleanup',
      );
    }
  }
}

test(
  'actual NSIS retries desktop/busy/API failures with drafts able to save and no repeated exports',
  { skip: !supported },
  async () => {
    const { code, events } = await scenario({ codes: [10, 11, 32, 0] });
    assert.equal(code, 0);
    assert.match(events, /kind=1 code=M-PROCESS-DESKTOP/);
    assert.match(events, /kind=2 code=M-PROCESS-NATIVE-HOST/);
    assert.match(events, /kind=3 code=M-RM-LIST/);
    assert.equal((events.match(/recovery-admission=0/g) ?? []).length, 3);
    const handles = [...events.matchAll(/handle=(\d+)/g)].map((m) => m[1]);
    assert.equal(
      new Set(handles).size,
      1,
      'Retry retains the original gate/pins',
    );
    const counts = [...events.matchAll(/count=(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, events);
    assert.match(events, /exclusive-admission=11/);
    assert.match(events, /released-admission=0/);
  },
);

test(
  'actual NSIS recognizes a live native desktop fixture and retries after its natural exit',
  { skip: !supported },
  async () => {
    const { code, events } = await scenario({ live: true });
    assert.equal(code, 0);
    assert.match(events, /kind=1 code=M-PROCESS-DESKTOP/);
    assert.match(events, /recovery-admission=0/);
  },
);

test('Cancel exits without residual locks', { skip: !supported }, async () => {
  const { code, events } = await scenario({ codes: [10], cancel: true });
  assert.equal(code, 1);
  assert.match(events, /recovery-admission=0/);
  assert.doesNotMatch(events, /exclusive-admission/);
});

test(
  'passive and updater modes fail closed without showing recovery UI',
  { skip: !supported },
  async () => {
    for (const options of [
      { passive: true },
      { update: true },
      { silent: true },
    ]) {
      const { code, events } = await scenario({ codes: [32], ...options });
      assert.equal(code, 1);
      assert.doesNotMatch(events, /prompt=/);
    }
  },
);

test(
  'admitted native capture activity drains before maintenance acquires exclusivity',
  { skip: !supported },
  async () => {
    const { code, events } = await scenario({ hold: 'activity' });
    assert.equal(code, 0);
    assert.match(events, /exclusive-admission=11/);
    assert.match(events, /released-admission=0/);
  },
);

test(
  'the generated disposable uninstaller uses the same retry and release behavior',
  { skip: !supported },
  async () => {
    const { events, directory } = await scenario({
      codes: [10, 0],
      uninstall: true,
    });
    await until(
      () =>
        existsSync(join(directory, 'events')) &&
        readFileSync(join(directory, 'events'), 'utf8').includes(
          'released-admission=0',
        ),
      'uninstaller completion',
    );
    assert.match(
      readFileSync(join(directory, 'events'), 'utf8'),
      /recovery-admission=0/,
    );
    assert.ok(
      events.includes('prompt=') || existsSync(join(directory, 'events')),
    );
  },
);

test(
  'actual passive same-version repair and upgrade skip absent radio controls',
  { skip: !supported },
  async () => {
    for (const repairVersion of [0, 1]) {
      const { code, events } = await scenario({ repairVersion });
      assert.equal(code, 0);
      assert.match(events, /exclusive-admission=11/);
      assert.match(events, /released-admission=0/);
    }
  },
);

test(
  'activity timeout releases partial admission before recovery, then reacquires it',
  { skip: !supported },
  async () => {
    const { code, events } = await scenario({
      hold: 'activity',
      deferOperationRelease: true,
    });
    assert.equal(code, 0);
    assert.match(events, /kind=2 code=M-ACTIVITY-BUSY/);
    assert.match(events, /recovery-admission=0/);
    assert.match(events, /exclusive-admission=11/);
    assert.match(events, /released-admission=0/);
  },
);
