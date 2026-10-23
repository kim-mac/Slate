import type { ClipGroup, Clip } from '@ai-clip-memory/shared';
import {
  ArrowLeft,
  ExternalLink,
  Pin,
  PinOff,
  Pencil,
  Split,
  Trash2,
  Ellipsis,
  Copy,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { InlineTitleEditor } from './InlineTitleEditor';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import {
  ClipContentEditor,
  type InlineContentEditor,
} from './ClipContentEditor';
import { displayTitle, formatContentType } from '@/lib/clipRetrieval';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Props {
  group: ClipGroup;
  disabled: boolean;
  pending?: boolean;
  backButtonRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onSetPinned: (pinned: boolean) => void;
  onUnmergeMember: (clip: Clip) => void;
  onDeleteMember: (clip: Clip) => void;
  onUnmergeGroup: () => void;
  onDeleteGroup: () => void;
  onOpenSource: (clip: Clip) => void;
  onEditMember: (clip: Clip) => void;
  onCopyMember: (clip: Clip) => void;
  onCopyAll: () => void;
  inline?: InlineContentEditor & {
    clip: Clip | null;
    onBeginMember: (clip: Clip) => void;
  };
  groupAvailable?: boolean;
  inlineTitle?: InlineContentEditor;
  onRequestMemberMenu?: (clip: Clip, open: () => void) => void;
}

export function MergedClipDetail({
  group,
  disabled,
  pending = false,
  backButtonRef,
  onBack,
  onSetPinned,
  onUnmergeMember,
  onDeleteMember,
  onUnmergeGroup,
  onDeleteGroup,
  onOpenSource,
  onEditMember,
  onCopyMember,
  onCopyAll,
  inline,
  groupAvailable = true,
  inlineTitle,
  onRequestMemberMenu,
}: Props) {
  const detached =
    inline?.clip && !group.members.some((clip) => clip.id === inline.clip?.id)
      ? inline.clip
      : null;
  const members = detached ? [...group.members, detached] : group.members;
  const root = useRef<HTMLDivElement>(null);
  const focusedMember = useRef<{ id: string; index: number } | null>(null);
  const pendingFocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    const previous = focusedMember.current;
    if (previous && !members.some((member) => member.id === previous.id)) {
      pendingFocus.current = previous.index;
      focusedMember.current = null;
    }
    if (pendingFocus.current === null || disabled || !groupAvailable) return;
    // Only repair focus lost with a removed member. Never steal focus from a
    // surviving control, another editor, or an open confirmation dialog.
    if (document.activeElement === document.body) {
      const sections =
        root.current?.querySelectorAll<HTMLElement>('[data-member-id]');
      const next =
        sections?.[Math.min(pendingFocus.current, members.length - 1)];
      next
        ?.querySelector<HTMLButtonElement>('[data-copy-clip]')
        ?.focus({ preventScroll: true });
      pendingFocus.current = null;
    } else if (
      !document.activeElement?.closest('[role="alertdialog"], [role="menu"]')
    ) {
      pendingFocus.current = null;
    }
  });
  return (
    <Card
      ref={root}
      className="clip-detail merged-clip-detail"
      onFocusCapture={(event) => {
        const section = (event.target as HTMLElement).closest<HTMLElement>(
          '[data-member-id]',
        );
        if (section) {
          const index = members.findIndex(
            (member) => member.id === section.dataset.memberId,
          );
          if (index !== -1)
            focusedMember.current = { id: members[index]!.id, index };
        } else {
          focusedMember.current = null;
        }
      }}
    >
      <ScrollArea className="clip-detail-scroll">
        <article>
          <CardHeader className="clip-detail-header">
            <div className="clip-heading">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      ref={backButtonRef}
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Back to calendar"
                      onClick={onBack}
                    />
                  }
                >
                  <ArrowLeft aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>Back to calendar</TooltipContent>
              </Tooltip>
              <Badge variant="secondary">Merged</Badge>
              <CardTitle>
                <InlineTitleEditor
                  title={group.title}
                  label="Group title"
                  disabled={disabled || !groupAvailable}
                  pending={pending && groupAvailable}
                  inline={inlineTitle}
                />
              </CardTitle>
              <span className="merged-clip-count">
                {group.members.length} clips
              </span>
            </div>
            <div className="clip-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || !groupAvailable}
                pending={pending && groupAvailable}
                aria-label="Copy all clips"
                onClick={onCopyAll}
              >
                <Copy aria-hidden="true" />
                Copy All
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || !groupAvailable}
                pending={pending && groupAvailable}
                aria-label={
                  group.isPinned ? 'Unpin merged clip' : 'Pin merged clip'
                }
                onClick={() => onSetPinned(!group.isPinned)}
              >
                {group.isPinned ? <PinOff /> : <Pin />}
                {group.isPinned ? 'Unpin' : 'Pin'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || !groupAvailable}
                pending={pending && groupAvailable}
                onClick={onUnmergeGroup}
              >
                <Split />
                Unmerge all clips
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={disabled || !groupAvailable}
                pending={pending && groupAvailable}
                onClick={onDeleteGroup}
              >
                <Trash2 />
                Delete merged clip
              </Button>
            </div>
          </CardHeader>
          <CardContent className="merged-clip-members">
            {!groupAvailable && (
              <p role="status">
                This group is no longer available. Your active draft is retained
                until you save or cancel.
              </p>
            )}
            {members.map((clip) => (
              <section
                key={clip.id}
                className="merged-clip-member"
                data-member-id={clip.id}
                aria-label={displayTitle(clip)}
              >
                <header className="merged-clip-member-header">
                  <div>
                    <h3>{displayTitle(clip)}</h3>
                    <span>
                      {formatContentType(clip.contentType)} ·{' '}
                      {new Date(clip.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="merged-clip-member-actions">
                    <MemberMenu
                      clip={clip}
                      pending={
                        pending && groupAvailable && detached?.id !== clip.id
                      }
                      disabled={
                        disabled ||
                        !groupAvailable ||
                        Boolean(detached?.id === clip.id)
                      }
                      onRequestOpen={(open) =>
                        onRequestMemberMenu
                          ? onRequestMemberMenu(clip, open)
                          : open()
                      }
                      onEdit={() => onEditMember(clip)}
                      onSource={() => onOpenSource(clip)}
                      onUnmerge={() => onUnmergeMember(clip)}
                      onDelete={() => onDeleteMember(clip)}
                    />
                  </div>
                </header>
                {detached?.id === clip.id && (
                  <p role="status">
                    This clip is no longer in this group. Your draft is
                    retained; saving will not remerge it.
                  </p>
                )}
                <ClipContentEditor
                  clip={clip}
                  disabled={disabled}
                  pending={pending}
                  labelSuffix={`: ${displayTitle(clip)}`}
                  onCopy={
                    groupAvailable && detached?.id !== clip.id
                      ? () => onCopyMember(clip)
                      : undefined
                  }
                  inline={
                    inline
                      ? {
                          ...inline,
                          draft:
                            inline.clip?.id === clip.id ? inline.draft : null,
                          onBegin: () => inline.onBeginMember(clip),
                        }
                      : undefined
                  }
                />
                {(clip.sourceApp || clip.sourcePageTitle) && (
                  <p className="merged-clip-member-source">
                    {[clip.sourceApp, clip.sourcePageTitle]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </section>
            ))}
          </CardContent>
        </article>
      </ScrollArea>
    </Card>
  );
}

function MemberMenu({
  clip,
  disabled,
  pending = false,
  onRequestOpen,
  onEdit,
  onSource,
  onUnmerge,
  onDelete,
}: {
  clip: Clip;
  disabled: boolean;
  pending?: boolean;
  onRequestOpen: (open: () => void) => void;
  onEdit: () => void;
  onSource: () => void;
  onUnmerge: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = useRef(true);
  const request = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <DropdownMenu
      open={open && !disabled}
      onOpenChange={(next) => {
        if (!next) {
          request.current++;
          setOpen(false);
          return;
        }
        const generation = request.current;
        onRequestOpen(() => {
          if (active.current && request.current === generation) setOpen(true);
        });
      }}
    >
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${displayTitle(clip)}`}
            pending={pending}
            onKeyDown={(event) => {
              if (event.key === 'Escape') request.current++;
            }}
          />
        }
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={onEdit}>
          <Pencil aria-hidden="true" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!clip.sourceUrl} onClick={onSource}>
          <ExternalLink aria-hidden="true" />
          Open source
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onUnmerge}>
          <Split aria-hidden="true" />
          Unmerge
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
