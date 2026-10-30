; NSIS owns A (admission) and B (activity). Rust validates the same retained
; per-user authority and process identities; it never owns our maintenance locks.
!ifndef SLATE_MAINTENANCE_GATE
!define SLATE_MAINTENANCE_GATE
Var SlateGateHandle
Var SlateGateOverlap
Var SlateGateStart
Var SlateGateOffset
Var SlateGateError
Var SlateGateAdmission
Var SlateGateActivity
Var SlateMaintenanceKind
Var SlateMaintenanceCode

!macro SlateMaintenanceFunctions PREFIX
Function ${PREFIX}SlateMaintenanceAbort
  DetailPrint "Slate maintenance: $SlateMaintenanceCode"
  Call ${PREFIX}SlateReleaseMaintenance
  SetErrorLevel 1
  Quit
FunctionEnd

Function ${PREFIX}SlateReleaseMaintenance
  ; Closing the owned file releases all its byte locks, including on failure.
  ${If} $SlateGateHandle != 0
  ${AndIf} $SlateGateHandle != ""
    System::Call 'kernel32::CloseHandle(p $SlateGateHandle)'
    StrCpy $SlateGateHandle 0
  ${EndIf}
  StrCpy $SlateGateAdmission 0
  StrCpy $SlateGateActivity 0
  ${If} $SlateGateOverlap != 0
  ${AndIf} $SlateGateOverlap != ""
    System::Free $SlateGateOverlap
    StrCpy $SlateGateOverlap 0
  ${EndIf}
FunctionEnd

Function ${PREFIX}SlateUnlockMaintenance
  ; Keep the validated file and fixed directory pins, but NO byte ownership,
  ; while the user saves/cancels drafts. Retrying never exports another pin set.
  ${If} $SlateGateActivity = 1
    System::Call '*$SlateGateOverlap(i 0, i 0, i 1, i 0, p 0)'
    System::Call 'kernel32::UnlockFileEx(p $SlateGateHandle, i 0, i 1, i 0, p $SlateGateOverlap) i.r0'
    ${If} $0 != 1
      StrCpy $SlateMaintenanceCode "M-UNLOCK-ACTIVITY"
      Call ${PREFIX}SlateMaintenanceAbort
    ${EndIf}
    StrCpy $SlateGateActivity 0
  ${EndIf}
  ${If} $SlateGateAdmission = 1
    System::Call '*$SlateGateOverlap(i 0, i 0, i 0, i 0, p 0)'
    System::Call 'kernel32::UnlockFileEx(p $SlateGateHandle, i 0, i 1, i 0, p $SlateGateOverlap) i.r0'
    ${If} $0 != 1
      StrCpy $SlateMaintenanceCode "M-UNLOCK-ADMISSION"
      Call ${PREFIX}SlateMaintenanceAbort
    ${EndIf}
    StrCpy $SlateGateAdmission 0
  ${EndIf}
FunctionEnd

Function ${PREFIX}SlateMaintenanceRecover
  Call ${PREFIX}SlateUnlockMaintenance
  DetailPrint "Slate maintenance: $SlateMaintenanceCode"
  ; Unattended updater handoff must never wait for a user dialog.
  ${If} ${Silent}
  ${OrIf} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    Call ${PREFIX}SlateMaintenanceAbort
  ${EndIf}
  ; MB_RETRYCANCEL | MB_ICONWARNING | MB_DEFBUTTON2: Cancel is the default.
  ${If} $SlateMaintenanceKind = 1
    System::Call 'user32::MessageBoxW(p $HWNDPARENT, w "Please right-click the Slate icon in your system tray and select Quit Slate. Then click Retry.", w "Slate is still running", i 0x135) i.r0'
  ${ElseIf} $SlateMaintenanceKind = 2
    System::Call 'user32::MessageBoxW(p $HWNDPARENT, w "Slate is finishing an operation. Please wait a moment, then try again.", w "Slate is busy", i 0x135) i.r0'
  ${Else}
    System::Call 'user32::MessageBoxW(p $HWNDPARENT, w "Slate couldn't confirm that it's safe to continue. Please try again after quitting Slate. If the problem persists, restart Windows and try again.", w "Unable to continue safely", i 0x135) i.r0'
  ${EndIf}
  ${If} $0 != 4
    Call ${PREFIX}SlateMaintenanceAbort
  ${EndIf}
FunctionEnd

Function ${PREFIX}SlateAcquireMaintenance
  slate_gate_retry:
  StrCpy $SlateMaintenanceKind 3
  ${If} $SlateGateHandle == 0
  ${OrIf} $SlateGateHandle == ""
    InitPluginsDir
    SetOutPath $PLUGINSDIR
    !insertmacro SlateEmbedMaintenanceHost
    System::Call 'kernel32::GetCurrentProcessId() i.r0'
    nsExec::ExecToStack /TIMEOUT=30000 '"$PLUGINSDIR\slate-maintenance-host.exe" --export-maintenance-handle $0'
    Pop $0
    Pop $1
    ${If} $0 == "error"
    ${OrIf} $0 == "timeout"
      ; A killed/unreachable exporter cannot prove rollback of remote handles.
      StrCpy $SlateMaintenanceCode "M-EXPORT-TRANSPORT"
      Call ${PREFIX}SlateMaintenanceAbort
    ${EndIf}
    ${If} $0 != 0
      ; The transactional exporter rolls back all remote duplicates on error.
      StrCpy $SlateMaintenanceCode "M-AUTHORITY-EXPORT"
      Call ${PREFIX}SlateMaintenanceRecover
      Goto slate_gate_retry
    ${EndIf}
    IntFmt $0 "%u" $1
    ${If} $0 != $1
    ${OrIf} $1 == 0
    ${OrIf} $1 == 4294967295
      StrCpy $SlateMaintenanceCode "M-EXPORT-PROTOCOL"
      Call ${PREFIX}SlateMaintenanceAbort
    ${EndIf}
    StrCpy $SlateGateHandle $1
    System::Alloc 20
    Pop $SlateGateOverlap
    ${If} $SlateGateOverlap == 0
      StrCpy $SlateMaintenanceCode "M-LOCK-ALLOCATION"
      Call ${PREFIX}SlateMaintenanceAbort
    ${EndIf}
  ${EndIf}
  ; Revalidate retained identity/security even if this call already owns A/B.
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  nsExec::ExecToStack /TIMEOUT=30000 '"$PLUGINSDIR\slate-maintenance-host.exe" --validate-maintenance-handle $0 $SlateGateHandle'
  Pop $0
  Pop $1
  ${If} $0 != 0
  ${OrIf} $1 != ""
    StrCpy $SlateMaintenanceCode "M-AUTHORITY-VALIDATE"
    Call ${PREFIX}SlateMaintenanceRecover
    Goto slate_gate_retry
  ${EndIf}
  ${If} $SlateGateAdmission = 1
  ${AndIf} $SlateGateActivity = 1
    Return
  ${EndIf}
  System::Call 'kernel32::GetTickCount() i.s'
  Pop $SlateGateStart
  StrCpy $SlateGateOffset 0
  slate_gate_lock:
    System::Call '*$SlateGateOverlap(i 0, i 0, i $SlateGateOffset, i 0, p 0)'
    System::Call 'kernel32::LockFileEx(p $SlateGateHandle, i 3, i 0, i 1, i 0, p $SlateGateOverlap) i.r0 ?e'
    Pop $SlateGateError
    ${If} $0 == 1
      ${If} $SlateGateOffset = 0
        StrCpy $SlateGateAdmission 1
        StrCpy $SlateGateOffset 1
        Goto slate_gate_lock
      ${EndIf}
      StrCpy $SlateGateActivity 1
      Return
    ${EndIf}
    ${If} $SlateGateError != 33
      StrCpy $SlateMaintenanceCode "M-LOCK-API"
      Call ${PREFIX}SlateMaintenanceRecover
      Goto slate_gate_retry
    ${EndIf}
    System::Call 'kernel32::GetTickCount() i.r0'
    IntOp $0 $0 - $SlateGateStart
    ${If} $0 >= 30000
      StrCpy $SlateMaintenanceKind 2
      ${If} $SlateGateOffset = 0
        StrCpy $SlateMaintenanceCode "M-ADMISSION-BUSY"
      ${Else}
        StrCpy $SlateMaintenanceCode "M-ACTIVITY-BUSY"
      ${EndIf}
      Call ${PREFIX}SlateMaintenanceRecover
      Goto slate_gate_retry
    ${EndIf}
    Sleep 100
    Goto slate_gate_lock
FunctionEnd

Function ${PREFIX}SlateWaitForProcesses
  slate_process_retry:
  ; Every retry starts over: authority, A/B, target ownership, process lifetime.
  Call ${PREFIX}SlateAcquireMaintenance
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  nsExec::ExecToStack /TIMEOUT=30000 '"$PLUGINSDIR\slate-maintenance-host.exe" --check-maintenance-processes $0 $SlateGateHandle "$INSTDIR"'
  Pop $0
  Pop $1
  StrCpy $SlateMaintenanceKind 3
  ${If} $1 != ""
    StrCpy $SlateMaintenanceCode "M-CHECK-PROTOCOL"
  ${ElseIf} $0 == 0
    Return
  ${ElseIf} $0 == 10
    StrCpy $SlateMaintenanceKind 1
    StrCpy $SlateMaintenanceCode "M-PROCESS-DESKTOP"
  ${ElseIf} $0 == 11
    StrCpy $SlateMaintenanceKind 2
    StrCpy $SlateMaintenanceCode "M-PROCESS-NATIVE-HOST"
  ${ElseIf} $0 == 20
    StrCpy $SlateMaintenanceCode "M-AUTHORITY-CHECK"
  ${ElseIf} $0 == 21
    StrCpy $SlateMaintenanceCode "M-TARGET-OWNERSHIP"
  ${ElseIf} $0 == 30
    StrCpy $SlateMaintenanceCode "M-RM-START"
  ${ElseIf} $0 == 31
    StrCpy $SlateMaintenanceCode "M-RM-REGISTER"
  ${ElseIf} $0 == 32
    StrCpy $SlateMaintenanceCode "M-RM-LIST"
  ${ElseIf} $0 == 33
    StrCpy $SlateMaintenanceCode "M-RM-END"
  ${ElseIf} $0 == 34
    StrCpy $SlateMaintenanceCode "M-RM-BOUNDS"
  ${ElseIf} $0 == 35
    StrCpy $SlateMaintenanceCode "M-PROCESS-IDENTITY"
  ${ElseIf} $0 == 36
    StrCpy $SlateMaintenanceCode "M-PROCESS-OTHER"
  ${ElseIf} $0 == 40
    StrCpy $SlateMaintenanceCode "M-CHECK-ARGUMENTS"
  ${Else}
    StrCpy $SlateMaintenanceCode "M-CHECK-TRANSPORT"
  ${EndIf}
  Call ${PREFIX}SlateMaintenanceRecover
  Goto slate_process_retry
FunctionEnd
!macroend
!insertmacro SlateMaintenanceFunctions ""
!insertmacro SlateMaintenanceFunctions "un."
!endif
