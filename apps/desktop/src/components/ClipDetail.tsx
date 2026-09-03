import type { Clip } from '@ai-clip-memory/shared';
import { Copy, ExternalLink, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';

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
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onOpenSource: () => void;
  onSetPinned: (isPinned: boolean) => void;
}

export function ClipDetail({
  clip,
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
                <h2>{clip.title ?? 'Untitled clip'}</h2>
              </CardTitle>
            </div>
            <div className="clip-actions">
              <ActionButton label="Copy" icon={<Copy />} onClick={onCopy} />
              <ActionButton
                label={clip.isPinned ? 'Unpin' : 'Pin'}
                icon={clip.isPinned ? <PinOff /> : <Pin />}
                onClick={() => onSetPinned(!clip.isPinned)}
              />
              <ActionButton label="Edit" icon={<Pencil />} onClick={onEdit} />
              <ActionButton
                label="Delete"
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
              <Button variant="outline" type="button" onClick={onOpenSource}>
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
  destructive?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function ActionButton({
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
          />
        }
      >
        {icon}
        {label}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
