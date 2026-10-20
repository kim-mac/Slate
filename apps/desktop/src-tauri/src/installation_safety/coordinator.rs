//! Local policy with an optional process gate. This module remains std-only.
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, MutexGuard},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LeaseKind {
    Editor,
    Confirmation,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SafetyError {
    UnknownWindow,
    UninitializedWindow,
    StaleGeneration,
    Busy,
    Preparing,
    InvalidLease,
    NotReady,
    TimedOut,
    Unavailable,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SafetyStatus {
    pub preparing: bool,
    pub generation: u64,
    pub available: bool,
}
#[derive(Default)]
struct WindowState {
    generation: u64,
    connected: bool,
    acknowledged: Option<u64>,
    leases: BTreeMap<u64, LeaseKind>,
    monitor_required: bool,
    monitor_ready: bool,
}
struct Policy {
    windows: BTreeMap<&'static str, WindowState>,
    launcher_unavailable: bool,
    next_id: u64,
    status: SafetyStatus,
    operations: usize,
    frozen: bool,
}
type StatusObserver = Arc<dyn Fn(SafetyStatus) + Send + Sync>;
pub(crate) trait ProcessGate: Send + Sync {
    fn available(&self) -> bool {
        true
    }
    fn prepare(&self) -> Result<(), SafetyError> {
        if self.available() {
            Ok(())
        } else {
            Err(SafetyError::Unavailable)
        }
    }
    fn admit(&self) -> Result<Box<dyn Send>, SafetyError>;
    fn maintenance(&self, deadline: std::time::Instant) -> Result<Box<dyn Send>, SafetyError>;
}
pub struct SafetyCoordinator {
    policy: Mutex<Policy>,
    observer: Mutex<Option<StatusObserver>>,
    gate: Option<Arc<dyn ProcessGate>>,
}
/// Non-cloneable accounting token. Admission and preparation use the same lock.
pub struct OperationPermit {
    safety: Arc<SafetyCoordinator>,
    process: Option<Box<dyn Send>>,
}
/// Dropping an attempt (including cancellation, timeout, or unwind) reopens admission.
pub(crate) struct PreparationAttempt {
    safety: Arc<SafetyCoordinator>,
    generation: Option<u64>,
    deadline: std::time::Instant,
    #[cfg(test)]
    deadline_after_global: Option<std::time::Instant>,
}
/// Only created after every participant acknowledged and admitted work drained.
pub(crate) struct PreparationGuard {
    safety: Arc<SafetyCoordinator>,
    generation: u64,
    process: Option<Box<dyn Send>>,
    deadline: std::time::Instant,
    executed: bool,
}
impl SafetyCoordinator {
    pub fn new() -> Arc<Self> {
        Self::create(None)
    }
    pub(crate) fn with_gate(gate: Arc<dyn ProcessGate>) -> Arc<Self> {
        Self::create(Some(gate))
    }
    fn create(gate: Option<Arc<dyn ProcessGate>>) -> Arc<Self> {
        Arc::new(Self {
            policy: Mutex::new(Policy {
                windows: BTreeMap::from([
                    ("main", WindowState::default()),
                    ("launcher", WindowState::default()),
                ]),
                launcher_unavailable: false,
                next_id: 0,
                status: SafetyStatus {
                    preparing: false,
                    generation: 0,
                    available: true,
                },
                operations: 0,
                frozen: false,
            }),
            observer: Mutex::new(None),
            gate,
        })
    }
    fn lock(&self) -> Result<MutexGuard<'_, Policy>, SafetyError> {
        self.policy.lock().map_err(|_| SafetyError::Unavailable)
    }
    pub(crate) fn observe(&self, observer: StatusObserver) -> Result<(), SafetyError> {
        *self.observer.lock().map_err(|_| SafetyError::Unavailable)? = Some(observer);
        Ok(())
    }
    fn notify(&self, status: SafetyStatus) {
        let observer = self.observer.lock().ok().and_then(|o| o.clone());
        if let Some(observer) = observer {
            // Event delivery cannot strand admission or panic while unwinding a guard.
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| observer(status)));
        }
    }
    pub fn connect(&self, label: &str) -> Result<u64, SafetyError> {
        let mut p = self.lock()?;
        let window = p.windows.get(label).ok_or(SafetyError::UnknownWindow)?;
        if !window.leases.is_empty() {
            return Err(SafetyError::Busy);
        }
        if p.status.preparing {
            return Err(SafetyError::Preparing);
        }
        if label == "launcher" && p.launcher_unavailable {
            return Err(SafetyError::Unavailable);
        }
        let generation = p.next_id.checked_add(1).ok_or(SafetyError::Unavailable)?;
        p.next_id = generation;
        let window = p.windows.get_mut(label).unwrap();
        window.generation = generation;
        window.connected = true;
        window.acknowledged = None;
        Ok(generation)
    }
    fn window<'a>(
        p: &'a mut Policy,
        label: &str,
        generation: u64,
    ) -> Result<&'a mut WindowState, SafetyError> {
        let window = p.windows.get_mut(label).ok_or(SafetyError::UnknownWindow)?;
        if !window.connected {
            return Err(SafetyError::UninitializedWindow);
        }
        if window.generation != generation {
            return Err(SafetyError::StaleGeneration);
        }
        Ok(window)
    }
    pub fn acquire(
        &self,
        label: &str,
        generation: u64,
        kind: LeaseKind,
    ) -> Result<u64, SafetyError> {
        let mut p = self.lock()?;
        Self::window(&mut p, label, generation)?;
        if p.status.preparing {
            return Err(SafetyError::Preparing);
        }
        let id = p.next_id.checked_add(1).ok_or(SafetyError::Unavailable)?;
        p.next_id = id;
        Self::window(&mut p, label, generation)?
            .leases
            .insert(id, kind);
        Ok(id)
    }
    pub fn release(&self, label: &str, generation: u64, lease: u64) -> Result<(), SafetyError> {
        let mut p = self.lock()?;
        Self::window(&mut p, label, generation)?
            .leases
            .remove(&lease)
            .ok_or(SafetyError::InvalidLease)?;
        Ok(())
    }
    pub fn acknowledge(
        &self,
        label: &str,
        window: u64,
        preparation: u64,
    ) -> Result<(), SafetyError> {
        let mut p = self.lock()?;
        if !p.status.preparing || p.status.generation != preparation {
            return Err(SafetyError::StaleGeneration);
        }
        let window = Self::window(&mut p, label, window)?;
        if !window.leases.is_empty() {
            return Err(SafetyError::Busy);
        }
        window.acknowledged = Some(preparation);
        Ok(())
    }
    pub fn status(&self) -> Result<SafetyStatus, SafetyError> {
        let mut status = self.lock()?.status;
        status.available = self.gate.as_ref().is_none_or(|gate| gate.available());
        Ok(status)
    }
    pub fn admit(self: &Arc<Self>) -> Result<OperationPermit, SafetyError> {
        let mut p = self.lock()?;
        if p.status.preparing {
            return Err(SafetyError::Preparing);
        }
        p.operations = p
            .operations
            .checked_add(1)
            .ok_or(SafetyError::Unavailable)?;
        drop(p); // Never retain local policy while waiting on another process.
        let mut permit = OperationPermit {
            safety: Arc::clone(self),
            process: None,
        };
        if let Some(gate) = &self.gate {
            permit.process = Some(gate.admit()?);
        }
        Ok(permit)
    }
    #[allow(dead_code)] // Deliberately internal: no production preparation/install IPC.
    pub(crate) fn begin_preparation(self: &Arc<Self>) -> Result<PreparationAttempt, SafetyError> {
        self.prepare(false)
    }
    /// User-initiated restart must never freeze an open editor or confirmation.
    pub(crate) fn begin_user_preparation(
        self: &Arc<Self>,
    ) -> Result<PreparationAttempt, SafetyError> {
        self.prepare(true)
    }
    fn prepare(self: &Arc<Self>, reject_leases: bool) -> Result<PreparationAttempt, SafetyError> {
        // Validate authority (and permit protected recovery) before closing policy.
        // Never wait on a process gate while holding the coordinator mutex.
        if let Some(gate) = &self.gate {
            gate.prepare()?;
        }
        let mut p = self.lock()?;
        if p.status.preparing {
            return Err(SafetyError::Busy);
        }
        if reject_leases && p.windows.values().any(|window| !window.leases.is_empty()) {
            return Err(SafetyError::Busy);
        }
        // Reserve the terminal transition's generation before closing admission.
        let generation = p
            .status
            .generation
            .checked_add(2)
            .ok_or(SafetyError::Unavailable)?
            - 1;
        p.status = SafetyStatus {
            preparing: true,
            generation,
            available: true,
        };
        for window in p.windows.values_mut() {
            window.acknowledged = None;
        }
        let status = p.status;
        drop(p);
        let attempt = PreparationAttempt {
            safety: Arc::clone(self),
            generation: Some(generation),
            deadline: std::time::Instant::now() + std::time::Duration::from_secs(15),
            #[cfg(test)]
            deadline_after_global: None,
        };
        self.notify(status);
        Ok(attempt)
    }
    pub fn disconnected(&self, label: &str) -> Result<(), SafetyError> {
        let mut p = self.lock()?;
        let window = p.windows.get_mut(label).ok_or(SafetyError::UnknownWindow)?;
        window.connected = false;
        window.acknowledged = None;
        // Preserve leases: a crashed/reloaded renderer cannot prove an editor was closed.
        Ok(())
    }
    pub(crate) fn launcher_creation_failed(&self) -> Result<(), SafetyError> {
        let mut p = self.lock()?;
        if p.status.preparing || p.windows["launcher"].generation != 0 {
            return Err(SafetyError::Busy);
        }
        p.launcher_unavailable = true;
        Ok(())
    }
    pub(crate) fn require_lifecycle_monitor(&self, label: &str) -> Result<(), SafetyError> {
        let mut p = self.lock()?;
        let w = p.windows.get_mut(label).ok_or(SafetyError::UnknownWindow)?;
        w.monitor_required = true;
        w.monitor_ready = false;
        Ok(())
    }
    pub(crate) fn lifecycle_monitor_ready(&self, label: &str) -> Result<(), SafetyError> {
        let mut p = self.lock()?;
        p.windows
            .get_mut(label)
            .ok_or(SafetyError::UnknownWindow)?
            .monitor_ready = true;
        Ok(())
    }
    fn ready(p: &Policy, generation: u64) -> bool {
        p.status.preparing
            && p.status.generation == generation
            && p.operations == 0
            && p.windows.values().all(|w| {
                w.connected
                    && w.generation != 0
                    && (!w.monitor_required || w.monitor_ready)
                    && w.leases.is_empty()
                    && w.acknowledged == Some(generation)
            })
    }
    fn finish_preparation(&self, generation: u64) {
        let Ok(mut p) = self.lock() else {
            return;
        }; // Poison stays fail closed.
        if !p.status.preparing || p.status.generation != generation {
            return;
        }
        p.status = SafetyStatus {
            preparing: false,
            generation: generation + 1,
            available: true,
        };
        p.frozen = false;
        for window in p.windows.values_mut() {
            window.acknowledged = None;
        }
        let status = p.status;
        drop(p);
        self.notify(status);
    }
}
impl OperationPermit {
    pub(crate) fn belongs_to(&self, safety: &Arc<SafetyCoordinator>) -> bool {
        Arc::ptr_eq(&self.safety, safety)
    }
}
impl Drop for OperationPermit {
    fn drop(&mut self) {
        drop(self.process.take());
        if let Ok(mut p) = self.safety.lock() {
            p.operations -= 1;
        }
    }
}
#[allow(dead_code)]
impl PreparationAttempt {
    #[cfg(test)]
    pub(crate) fn with_test_deadline_after_global(mut self, deadline: std::time::Instant) -> Self {
        self.deadline_after_global = Some(deadline);
        self
    }
    pub fn try_freeze(self) -> Result<PreparationGuard, (SafetyError, Self)> {
        self.try_freeze_at(std::time::Instant::now())
    }
    fn try_freeze_at(
        mut self,
        now: std::time::Instant,
    ) -> Result<PreparationGuard, (SafetyError, Self)> {
        let Some(generation) = self.generation else {
            return Err((SafetyError::StaleGeneration, self));
        };
        if now >= self.deadline {
            self.safety.finish_preparation(generation);
            self.generation = None;
            return Err((SafetyError::TimedOut, self));
        }
        let result = match self.safety.lock() {
            Ok(mut p) if SafetyCoordinator::ready(&p, generation) && !p.frozen => {
                p.frozen = true;
                Ok(())
            }
            Ok(_) => Err(SafetyError::NotReady),
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            return Err((error, self));
        }
        // Local admission is closed AND local operations have drained. Only now
        // wait for A/B globally; otherwise a locally counted operation waiting
        // for A could deadlock a maintenance holder waiting for that operation.
        let process = if let Some(gate) = &self.safety.gate {
            match gate.maintenance(self.deadline) {
                Ok(guard) => Some(guard),
                Err(error) => {
                    if let Ok(mut p) = self.safety.lock() {
                        p.frozen = false;
                    }
                    if error == SafetyError::TimedOut {
                        self.safety.finish_preparation(generation);
                        self.generation = None;
                    }
                    return Err((error, self));
                }
            }
        } else {
            None
        };
        #[cfg(test)]
        if let Some(deadline) = self.deadline_after_global {
            self.deadline = deadline;
        }
        // Renderer lifecycle and deadline can change during the global wait.
        let error = match self.safety.lock() {
            Ok(p) => {
                // Read the clock after acquiring policy: mutex contention or
                // descheduling must not make the deadline observation stale.
                if std::time::Instant::now() >= self.deadline {
                    Some(SafetyError::TimedOut)
                } else if p.frozen && SafetyCoordinator::ready(&p, generation) {
                    None
                } else {
                    Some(SafetyError::NotReady)
                }
            }
            Err(error) => Some(error),
        };
        if let Some(error) = error {
            drop(process);
            if let Ok(mut p) = self.safety.lock() {
                p.frozen = false;
            }
            if error == SafetyError::TimedOut {
                self.safety.finish_preparation(generation);
                self.generation = None;
            }
            return Err((error, self));
        }
        self.generation = None;
        Ok(PreparationGuard {
            safety: Arc::clone(&self.safety),
            generation,
            process,
            deadline: self.deadline,
            executed: false,
        })
    }
}
impl Drop for PreparationAttempt {
    fn drop(&mut self) {
        if let Some(generation) = self.generation {
            self.safety.finish_preparation(generation);
        }
    }
}
impl Drop for PreparationGuard {
    fn drop(&mut self) {
        drop(self.process.take());
        self.safety.finish_preparation(self.generation);
    }
}
impl PreparationGuard {
    /// Only a bounded process-creation call belongs inside this closure. Never
    /// wait for the installer or another process while holding the policy mutex.
    pub(crate) fn handoff<T>(&mut self, boundary: impl FnOnce() -> T) -> Result<T, SafetyError> {
        let p = self.safety.lock()?;
        if std::time::Instant::now() >= self.deadline {
            return Err(SafetyError::TimedOut);
        }
        if self.executed || !p.frozen || !SafetyCoordinator::ready(&p, self.generation) {
            return Err(SafetyError::NotReady);
        }
        self.executed = true;
        // Callbacks cannot recursively call this coordinator. Keeping the
        // lock through process creation serializes final readiness with lifecycle
        // invalidation. Catch before releasing it so a callback panic cannot poison
        // policy and strand admission; propagate only after the mutex is released.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(boundary));
        drop(p);
        match result {
            Ok(value) => Ok(value),
            Err(payload) => std::panic::resume_unwind(payload),
        }
    }
    #[cfg(test)]
    fn run_mock(&mut self, boundary: impl FnOnce()) -> Result<(), SafetyError> {
        self.handoff(boundary)
    }
}
#[cfg(test)]
#[path = "tests.rs"]
mod tests;
