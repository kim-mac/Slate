import type { Clip } from '@ai-clip-memory/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipClient } from '../clipClient';
import { recentClips } from '../lib/clipRetrieval';

export function useClipLibrary(client: Pick<ClipClient, 'list'>) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const loaded = await client.list();
      if (request === generation.current) setClips(recentClips(loaded));
    } catch {
      if (request === generation.current)
        setLoadError('Could not load local clips. Try again.');
    } finally {
      if (request === generation.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [client]);
  const invalidate = useCallback(() => {
    generation.current += 1;
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);
  return {
    clips,
    setClips,
    isLoading,
    isRefreshing,
    loadError,
    refresh,
    invalidate,
  };
}
