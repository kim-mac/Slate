import type { ClipGroup, Clip } from '@ai-clip-memory/shared';
import {
  ArrowLeft,
  ExternalLink,
  Pin,
  PinOff,
  Split,
  Trash2,
} from 'lucide-react';
import type { RefObject } from 'react';
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
  backButtonRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onSetPinned: (pinned: boolean) => void;
  onUnmergeMember: (clip: Clip) => void;
  onDeleteMember: (clip: Clip) => void;
  onUnmergeGroup: () => void;
  onDeleteGroup: () => void;
  onOpenSource: (clip: Clip) => void;
}

export function MergedClipDetail({
  group,
  disabled,
  backButtonRef,
  onBack,
  onSetPinned,
  onUnmergeMember,
  onDeleteMember,
  onUnmergeGroup,
  onDeleteGroup,
  onOpenSource,
}: Props) {
  return (
    <Card className="clip-detail merged-clip-detail">
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
                <h2>{group.title}</h2>
              </CardTitle>
              <span className="merged-clip-count">
                {group.members.length} clips
              </span>
            </div>
            <div className="clip-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
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
                disabled={disabled}
                onClick={onUnmergeGroup}
              >
                <Split />
                Unmerge all clips
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={disabled}
                onClick={onDeleteGroup}
              >
                <Trash2 />
                Delete merged clip
              </Button>
            </div>
          </CardHeader>
          <CardContent className="merged-clip-members">
            {group.members.map((clip) => (
              <section
                key={clip.id}
                className="merged-clip-member"
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
                    {clip.sourceUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() => onOpenSource(clip)}
                      >
                        <ExternalLink />
                        Open source
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      aria-label={`Unmerge ${displayTitle(clip)}`}
                      onClick={() => onUnmergeMember(clip)}
                    >
                      <Split />
                      Unmerge
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={disabled}
                      aria-label={`Delete ${displayTitle(clip)}`}
                      onClick={() => onDeleteMember(clip)}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </div>
                </header>
                <pre className="clip-content">{clip.content}</pre>
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
