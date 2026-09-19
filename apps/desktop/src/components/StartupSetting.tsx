import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { tauriStartupClient, type StartupClient } from '@/startupClient';

type StartupState =
  | { type: 'loading' }
  | { type: 'ready'; enabled: boolean }
  | { type: 'unavailable' };

interface StartupSettingProps {
  client?: StartupClient;
}

export function StartupSetting({
  client = tauriStartupClient,
}: StartupSettingProps) {
  const [state, setState] = useState<StartupState>({ type: 'loading' });
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const requestId = useRef(0);

  const readActualState = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setState({ type: 'loading' });
    try {
      const enabled = await client.getEnabled();
      if (requestId.current === currentRequest) {
        setState({ type: 'ready', enabled });
      }
    } catch {
      if (requestId.current === currentRequest) {
        setState({ type: 'unavailable' });
      }
    }
  }, [client]);

  useEffect(() => {
    void readActualState();
    return () => {
      requestId.current += 1;
    };
  }, [readActualState]);

  async function update(enabled: boolean) {
    if (isUpdating) return;
    setIsUpdating(true);
    setUpdateError(null);
    try {
      await client.setEnabled(enabled);
    } catch {
      setUpdateError('Windows startup could not be updated. Try again.');
    } finally {
      await readActualState();
      setIsUpdating(false);
    }
  }

  return (
    <Card className="startup-setting">
      <CardContent className="startup-setting-content">
        <div className="startup-setting-copy">
          <h3>Start Slate when I sign in to Windows</h3>
          <p>Keep Slate ready for quick capture after you sign in.</p>
        </div>

        {state.type === 'ready' ? (
          <button
            type="button"
            className="startup-switch"
            role="switch"
            aria-checked={state.enabled}
            aria-label="Start Slate when I sign in to Windows"
            disabled={isUpdating}
            onClick={() => void update(!state.enabled)}
          >
            <span aria-hidden="true" />
          </button>
        ) : state.type === 'loading' ? (
          <span className="startup-setting-status" role="status">
            Checking…
          </span>
        ) : (
          <div className="startup-setting-unavailable">
            <span className="startup-setting-status" role="alert">
              Windows startup status is unavailable.
            </span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void readActualState()}
            >
              Retry
            </Button>
          </div>
        )}

        {updateError && (
          <p className="startup-setting-error" role="alert">
            {updateError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
