; NSIS is a 32-bit process on both supported architectures. Rust validates the
; authority and duplicates an unlocked independent file plus all identity pins.
; Only this process acquires locks. Pins intentionally live until process exit.
!ifndef SLATE_MAINTENANCE_GATE
!define SLATE_MAINTENANCE_GATE
Var SlateGateHandle
Var SlateGateOverlap
Var SlateGateStart
Var SlateGateOffset
Var SlateGateError
Var SlateRmSession
Var SlateRmStart
Var SlateRmCount

!macro SlateMaintenanceFunctions PREFIX
Function ${PREFIX}SlateMaintenanceAbort
  Call ${PREFIX}SlateReleaseMaintenance
  SetErrorLevel 1
  DetailPrint "Maintenance could not establish exclusive access. Close Slate and Chromium browsers, then retry. No applications were closed. For a legacy installation, follow the manual library migration procedure."
  ${IfNot} ${Silent}
  ${AndIf} $PassiveMode != 1
    MessageBox MB_OK|MB_ICONSTOP "Close Slate and Chromium browsers, then retry. Maintenance timed out or could not verify exclusive access. For a legacy installation, follow the manual library migration procedure."
  ${EndIf}
  Quit
FunctionEnd

Function ${PREFIX}SlateReleaseMaintenance
  ${If} $SlateGateHandle != 0
  ${AndIf} $SlateGateHandle != ""
    System::Call 'kernel32::CloseHandle(p $SlateGateHandle)'
    StrCpy $SlateGateHandle 0
  ${EndIf}
  ${If} $SlateGateOverlap != 0
  ${AndIf} $SlateGateOverlap != ""
    System::Free $SlateGateOverlap
    StrCpy $SlateGateOverlap 0
  ${EndIf}
FunctionEnd

Function ${PREFIX}SlateAcquireMaintenance
  InitPluginsDir
  SetOutPath $PLUGINSDIR
  ; Use NSIS preprocessing inside the existing Handlebars each: no additional
  ; Handlebars helper is needed. Both installer and uninstaller embed this copy.
  !insertmacro SlateEmbedMaintenanceHost
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  nsExec::ExecToStack /TIMEOUT=30000 '"$PLUGINSDIR\slate-maintenance-host.exe" --export-maintenance-handle $0'
  Pop $0
  Pop $1
  ${If} $0 != 0
    Call ${PREFIX}SlateMaintenanceAbort
  ${EndIf}
  IntFmt $0 "%u" $1
  ${If} $0 != $1
  ${OrIf} $1 == 0
  ${OrIf} $1 == 4294967295
    Call ${PREFIX}SlateMaintenanceAbort
  ${EndIf}
  StrCpy $SlateGateHandle $1
  System::Alloc 20
  Pop $SlateGateOverlap
  ${If} $SlateGateOverlap == 0
    Call ${PREFIX}SlateMaintenanceAbort
  ${EndIf}
  System::Call 'kernel32::GetTickCount() i.s'
  Pop $SlateGateStart
  StrCpy $SlateGateOffset 0
  slate_gate_lock:
    System::Call '*$SlateGateOverlap(i 0, i 0, i $SlateGateOffset, i 0, p 0)'
    ; FAIL_IMMEDIATELY | EXCLUSIVE; only lock contention is retryable.
    System::Call 'kernel32::LockFileEx(p $SlateGateHandle, i 3, i 0, i 1, i 0, p $SlateGateOverlap) i.r0 ?e'
    Pop $SlateGateError
    ${If} $0 == 1
      ${If} $SlateGateOffset = 0
        StrCpy $SlateGateOffset 1
        Goto slate_gate_lock
      ${EndIf}
      Return
    ${EndIf}
    ${If} $SlateGateError != 33
      Call ${PREFIX}SlateMaintenanceAbort
    ${EndIf}
    System::Call 'kernel32::GetTickCount() i.r0'
    IntOp $0 $0 - $SlateGateStart
    ${If} $0 >= 30000
      Call ${PREFIX}SlateMaintenanceAbort
    ${EndIf}
    Sleep 100
    Goto slate_gate_lock
FunctionEnd

Function ${PREFIX}SlateWaitForProcesses
  ; Restart Manager queries exactly the installed desktop and native-host paths.
  ; Every API failure, including session creation/end, aborts maintenance.
  System::Call 'RSTRTMGR::RmStartSession(*i .r1, i 0, w .r2) i.r0'
  ${If} $0 != 0
    Call ${PREFIX}SlateMaintenanceAbort
  ${EndIf}
  StrCpy $SlateRmSession $1
  System::Call 'RSTRTMGR::RmRegisterResources(i $SlateRmSession, i 1, *w "$INSTDIR\${MAINBINARYNAME}.exe", i 0, p 0, i 0, p 0) i.r0'
  ${If} $0 != 0
    Goto slate_rm_error
  ${EndIf}
  System::Call 'RSTRTMGR::RmRegisterResources(i $SlateRmSession, i 1, *w "$INSTDIR\ai-clip-memory-native-host.exe", i 0, p 0, i 0, p 0) i.r0'
  ${If} $0 != 0
    Goto slate_rm_error
  ${EndIf}
  System::Call 'kernel32::GetTickCount() i.s'
  Pop $SlateRmStart
  slate_rm_poll:
    System::Call 'RSTRTMGR::RmGetList(i $SlateRmSession, *i .r1, *i 0, p 0, *i .r2) i.r0'
    StrCpy $SlateRmCount $1
    ${If} $0 == 0
    ${AndIf} $SlateRmCount = 0
      System::Call 'RSTRTMGR::RmEndSession(i $SlateRmSession) i.r0'
      ${If} $0 != 0
        Call ${PREFIX}SlateMaintenanceAbort
      ${EndIf}
      Return
    ${EndIf}
    ${If} $0 != 234
    ${AndIf} $0 != 0
      Goto slate_rm_error
    ${EndIf}
    System::Call 'kernel32::GetTickCount() i.r0'
    IntOp $0 $0 - $SlateRmStart
    ${If} $0 >= 30000
      Goto slate_rm_error
    ${EndIf}
    Sleep 100
    Goto slate_rm_poll
  slate_rm_error:
    System::Call 'RSTRTMGR::RmEndSession(i $SlateRmSession)'
    Call ${PREFIX}SlateMaintenanceAbort
FunctionEnd
!macroend
!insertmacro SlateMaintenanceFunctions ""
!insertmacro SlateMaintenanceFunctions "un."
!endif
