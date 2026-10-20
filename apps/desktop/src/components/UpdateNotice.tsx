import { Download } from 'lucide-react';
import type { UpdateControls } from '../updaterClient';
import { Button } from './ui/button';

interface Props {
  controls: UpdateControls;
  blocked?: boolean;
  collapsed?: boolean;
  onExpand?: () => void;
}

export function UpdateNotice({
  controls,
  blocked = false,
  collapsed = false,
  onExpand,
}: Props) {
  const { state, pending } = controls;
  if (
    !state ||
    state.dismissed ||
    ['unconfigured', 'idle', 'up_to_date'].includes(state.phase)
  )
    return null;
  if (state.phase === 'checking' && !state.availableVersion) return null;
  if (collapsed) {
    return (
      <div className="sidebar-update-collapsed">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Show update details"
          title="Slate update"
          onClick={onExpand}
        >
          <Download aria-hidden="true" />
        </Button>
      </div>
    );
  }
  const downloading = state.phase === 'downloading';
  const verifying = state.phase === 'verifying';
  const preparing = state.phase === 'preparing';
  const active =
    downloading || verifying || preparing || state.phase === 'checking';
  const failure = state.phase === 'error';
  const ready = state.phase === 'ready';
  return (
    <section className="sidebar-update-card" aria-label="Slate update">
      <p className="sidebar-update-title">
        <Download aria-hidden="true" />
        <span>
          {state.availableVersion
            ? `Slate ${state.availableVersion} available`
            : 'Slate updates'}
        </span>
      </p>
      {active && (
        <>
          <p role="status">
            {preparing
              ? 'Preparing to restart…'
              : downloading
                ? 'Downloading update…'
                : verifying
                  ? 'Verifying update signature…'
                  : 'Checking for updates…'}
          </p>
          {downloading && (
            <progress
              aria-label="Update download"
              max={
                state.totalBytes && state.totalBytes > 0
                  ? state.totalBytes
                  : undefined
              }
              value={
                state.totalBytes && state.totalBytes > 0
                  ? Math.min(state.downloadedBytes, state.totalBytes)
                  : undefined
              }
            />
          )}
          {!preparing && (
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => void controls.cancel()}
            >
              Cancel
            </Button>
          )}
        </>
      )}
      {failure && (
        <p role="alert">
          {state.error?.message ?? 'Could not complete the update. Try again.'}
        </p>
      )}
      {controls.actionError && <p role="alert">{controls.actionError}</p>}
      {ready && (
        <>
          <p role="status">Update verified and ready.</p>
          {state.error && <p role="alert">{state.error.message}</p>}
          {!state.installationEnabled && (
            <p>Installation is disabled in this preview.</p>
          )}
        </>
      )}
      {!active && (
        <div className="sidebar-update-actions">
          {ready ? (
            <Button
              size="xs"
              disabled={
                pending ||
                blocked ||
                !state.installationEnabled ||
                !controls.restart
              }
              onClick={() => void controls.restart?.()}
            >
              Restart to update
            </Button>
          ) : (
            <Button
              size="xs"
              disabled={pending || (Boolean(state.availableVersion) && blocked)}
              onClick={() =>
                void (state.availableVersion
                  ? controls.download()
                  : controls.check())
              }
            >
              {failure || controls.actionError ? 'Retry' : 'Update Now'}
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => void controls.dismiss()}
          >
            Later
          </Button>
        </div>
      )}
      {blocked && !active && state.availableVersion && (
        <p>Finish your current edit or operation first.</p>
      )}
    </section>
  );
}
