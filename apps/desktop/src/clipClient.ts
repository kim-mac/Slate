import type { Clip, ClipInput } from '@ai-clip-memory/shared';
import { invoke } from '@tauri-apps/api/core';

export interface ClipClient {
  list(): Promise<Clip[]>;
  create(input: ClipInput): Promise<Clip>;
  update(id: string, input: ClipInput): Promise<Clip>;
  delete(id: string): Promise<void>;
  setPinned(id: string, isPinned: boolean): Promise<Clip>;
  copyContent(id: string): Promise<void>;
  openSource(id: string): Promise<void>;
}

export const tauriClipClient: ClipClient = {
  list: () => invoke<Clip[]>('list_clips'),
  create: (input) => invoke<Clip>('create_clip', { input }),
  update: (id, input) => invoke<Clip>('update_clip', { id, input }),
  delete: (id) => invoke<void>('delete_clip', { id }),
  setPinned: (id, isPinned) =>
    invoke<Clip>('set_clip_pinned', { id, isPinned }),
  copyContent: (id) => invoke<void>('copy_clip_content', { id }),
  openSource: (id) => invoke<void>('open_clip_source', { id }),
};
