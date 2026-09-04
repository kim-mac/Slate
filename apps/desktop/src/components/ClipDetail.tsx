import type { Clip } from '@ai-clip-memory/shared';
import { Copy, ExternalLink, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { displayTitle } from '@/lib/clipRetrieval';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ClipDetailProps {
  clip: Clip;
  disabled: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onOpenSource: () => void;
  onSetPinned: (isPinned: boolean) => void;
}

export function ClipDetail({
  clip,
  disabled,
  onCopy,
  onDelete,
  onEdit,
  onOpenSource,
  onSetPinned,
}: ClipDetailProps) {
  return (
    <Card className="clip-detail">
      <ScrollArea className="clip-detail-scroll">
        <article>
          <CardHeader className="clip-detail-header">
            <div className="clip-heading">
              <Badge variant="secondary">{clip.contentType}</Badge>
              <CardTitle>
                <h2>{displayTitle(clip)}</h2>
              </CardTitle>
            </div>
            <div className="clip-actions">
              <ActionButton
                disabled={disabled}
                label="Copy"
                icon={<Copy />}
                onClick={onCopy}
              />
              <ActionButton
                label={clip.isPinned ? 'Unpin' : 'Pin'}
                disabled={disabled}
                icon={clip.isPinned ? <PinOff /> : <Pin />}
                onClick={() => onSetPinned(!clip.isPinned)}
              />
              <ActionButton
                disabled={disabled}
                label="Edit"
                icon={<Pencil />}
                onClick={onEdit}
              />
              <ActionButton
                label="Delete"
                disabled={disabled}
                icon={<Trash2 />}
                onClick={onDelete}
                destructive
              />
            </div>
          </CardHeader>

          <CardContent>
            <pre className="clip-content">{clip.content}</pre>
            <Separator />
            <dl className="clip-metadata">
              {clip.sourceApp && (
                <div>
                  <dt>Source</dt>
                  <dd>{clip.sourceApp}</dd>
                </div>
              )}
              {clip.sourcePageTitle && (
                <div>
                  <dt>Page</dt>
                  <dd>{clip.sourcePageTitle}</dd>
                </div>
              )}
              <div>
                <dt>Created</dt>
                <dd>{new Date(clip.createdAt).toLocaleString()}</dd>
              </div>
            </dl>

            {clip.sourceUrl && (
              <Button
                variant="outline"
                type="button"
                onClick={onOpenSource}
                disabled={disabled}
              >
                <ExternalLink aria-hidden="true" />
                Open source
              </Button>
            )}
          </CardContent>
        </article>
      </ScrollArea>
    </Card>
  );
}

interface ActionButtonProps {
  disabled: boolean;
  destructive?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function ActionButton({
  disabled,
  destructive = false,
  icon,
  label,
  onClick,
}: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={destructive ? 'destructive' : 'outline'}
            size="sm"
            type="button"
            onClick={onClick}
            disabled={disabled}
          />
        }
      >
        {icon}
        {label}
      </TooltipTrigger>
      <TooltipContent>
        {label === 'Copy' ? 'Copy (Ctrl/Cmd+Shift+C)' : label}
      </TooltipContent>
    </Tooltip>
  );
}
