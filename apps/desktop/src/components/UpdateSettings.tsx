import { updateIsBusy, type UpdateControls } from '../updaterClient';
import { Button } from './ui/button';

export function UpdateSettings({ controls }: { controls: UpdateControls }) {
  const { state } = controls;
  let message = 'Connecting to the updater…';
  if (controls.connectionError)
    message = 'Update status is unavailable. Try checking again.';
  else if (state) {
    switch (state.phase) {
      case 'unconfigured':
        message = 'Update checking is not configured in this preview.';
        break;
      case 'idle':
        message = 'Check for updates when you are ready.';
        break;
      case 'checking':
        message = 'Checking for updates…';
        break;
      case 'up_to_date':
        message = 'Slate is up to date.';
        break;
      case 'available':
        message = `Slate ${state.availableVersion} is available in the sidebar.`;
        break;
      case 'downloading':
        message = 'Downloading update…';
        break;
      case 'verifying':
        message = 'Verifying update signature…';
        break;
      case 'ready':
        message = state.installationEnabled
          ? 'Update verified. Restart to update from the sidebar when you are ready.'
          : 'Update verified. Installation is disabled in this preview.';
        break;
      case 'preparing':
        message = 'Preparing to restart…';
        break;
      case 'error':
        message =
          state.error?.message ?? 'Could not check for updates. Try again.';
        break;
    }
  }
  return (
    <div className="settings-update-control">
      <Button
        size="sm"
        variant="outline"
        disabled={controls.pending || updateIsBusy(state?.phase)}
        onClick={() => void controls.check()}
      >
        Check for Updates
      </Button>
      <p role={state?.phase === 'error' ? 'alert' : 'status'}>{message}</p>
      {controls.actionError && <p role="alert">{controls.actionError}</p>}
    </div>
  );
}
