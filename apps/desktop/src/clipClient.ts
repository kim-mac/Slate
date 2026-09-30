import type {
  Clip,
  ClipGroup,
  ClipInput,
  LibraryItem,
  LibraryItemRef,
} from '@ai-clip-memory/shared';
import { invoke } from '@tauri-apps/api/core';

export interface ClipClient {
  list(): Promise<LibraryItem[]>;
  create(input: ClipInput): Promise<Clip>;
  update(id: string, input: ClipInput): Promise<Clip>;
  delete(id: string): Promise<void>;
  setPinned(id: string, isPinned: boolean): Promise<Clip>;
  copyContent(id: string): Promise<void>;
  openSource(id: string): Promise<void>;
  merge(selected: LibraryItemRef[]): Promise<ClipGroup>;
  unmergeMember(groupId: string, clipId: string): Promise<void>;
  unmergeGroup(groupId: string): Promise<void>;
  deleteGroupMember(groupId: string, clipId: string): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
  setGroupPinned(groupId: string, isPinned: boolean): Promise<ClipGroup>;
}

export const tauriClipClient: ClipClient = {
  list: () => invoke<LibraryItem[]>('list_clips'),
  create: (input) => invoke<Clip>('create_clip', { input }),
  update: (id, input) => invoke<Clip>('update_clip', { id, input }),
  delete: (id) => invoke<void>('delete_clip', { id }),
  setPinned: (id, isPinned) =>
    invoke<Clip>('set_clip_pinned', { id, isPinned }),
  copyContent: (id) => invoke<void>('copy_clip_content', { id }),
  openSource: (id) => invoke<void>('open_clip_source', { id }),
  merge: (selected) => invoke<ClipGroup>('merge_clips', { selected }),
  unmergeMember: (groupId, clipId) =>
    invoke<void>('unmerge_group_member', { groupId, clipId }),
  unmergeGroup: (groupId) => invoke<void>('unmerge_group', { groupId }),
  deleteGroupMember: (groupId, clipId) =>
    invoke<void>('delete_group_member', { groupId, clipId }),
  deleteGroup: (groupId) => invoke<void>('delete_group', { groupId }),
  setGroupPinned: (groupId, isPinned) =>
    invoke<ClipGroup>('set_group_pinned', { groupId, isPinned }),
};
