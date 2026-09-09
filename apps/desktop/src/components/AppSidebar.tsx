import type { Clip } from '@ai-clip-memory/shared';
import {
  Archive,
  ChevronRight,
  Pin,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import type { RefObject } from 'react';

import { ClipList } from '@/components/ClipList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

export type AppView = 'all' | 'pinned' | 'settings';
type LibraryView = Exclude<AppView, 'settings'>;

interface AppSidebarProps {
  activeView: AppView;
  allCount: number;
  clips: Clip[];
  clipListRef: RefObject<HTMLDivElement | null>;
  expandedSection: LibraryView | null;
  hasFilters: boolean;
  isLoading: boolean;
  onClearFilters: () => void;
  onSelectClip: (id: string) => void;
  onToggleSection: (view: LibraryView) => void;
  pinnedCount: number;
  selectedId: string | null;
  onSelectView: (view: AppView) => void;
}

export function AppSidebar({
  activeView,
  allCount,
  clips,
  clipListRef,
  expandedSection,
  hasFilters,
  isLoading,
  onClearFilters,
  onSelectClip,
  onToggleSection,
  pinnedCount,
  selectedId,
  onSelectView,
}: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const sections = [
    {
      view: 'all' as const,
      label: 'All Clips',
      count: allCount,
      Icon: Archive,
    },
    { view: 'pinned' as const, label: 'Pinned', count: pinnedCount, Icon: Pin },
  ];

  return (
    <Sidebar collapsible="icon" className="app-sidebar">
      <SidebarContent className="app-sidebar-content">
        <SidebarGroup className="sidebar-library-group">
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Clip library">
              <SidebarMenu className="sidebar-navigation-menu">
                {sections.map(({ view, label, count, Icon }) => {
                  const expanded = !collapsed && expandedSection === view;
                  return (
                    <SidebarMenuItem
                      className="sidebar-section-item"
                      key={view}
                    >
                      <SidebarMenuButton
                        type="button"
                        aria-label={label}
                        aria-expanded={expanded}
                        tooltip={`${label} (${count})`}
                        aria-pressed={activeView === view}
                        isActive={activeView === view}
                        onClick={() =>
                          collapsed ? onSelectView(view) : onToggleSection(view)
                        }
                        className="sidebar-section-trigger"
                      >
                        {collapsed ? (
                          <Icon aria-hidden="true" />
                        ) : (
                          <ChevronRight
                            aria-hidden="true"
                            className="sidebar-section-chevron"
                          />
                        )}
                        {!collapsed && <span>{label}</span>}
                      </SidebarMenuButton>
                      <SidebarMenuBadge>{count}</SidebarMenuBadge>

                      {expanded && (
                        <div
                          className="sidebar-section-results"
                          role="region"
                          aria-label={`${label} results`}
                          ref={clipListRef}
                        >
                          {hasFilters && (
                            <div className="sidebar-section-tools">
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={onClearFilters}
                              >
                                Clear filters
                              </Button>
                            </div>
                          )}
                          {isLoading ? (
                            <p className="sidebar-results-message">
                              Loading clips…
                            </p>
                          ) : clips.length > 0 ? (
                            <ClipList
                              ariaLabel={`${label} clip list`}
                              clips={clips}
                              compact
                              selectedId={selectedId}
                              onSelect={onSelectClip}
                            />
                          ) : (
                            <p className="sidebar-results-message">
                              {hasFilters
                                ? 'No matching clips.'
                                : view === 'pinned'
                                  ? 'No pinned clips.'
                                  : 'No clips yet.'}
                            </p>
                          )}
                        </div>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="sidebar-privacy-icon"
                  role="img"
                  aria-label="Local only"
                  tabIndex={0}
                />
              }
            >
              <ShieldCheck aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="right">
              Local only — no account or cloud required
            </TooltipContent>
          </Tooltip>
        ) : (
          <Badge variant="outline" className="sidebar-local-status">
            Local only
          </Badge>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              aria-label="Privacy & About"
              tooltip="Privacy & About · Local only"
              aria-pressed={activeView === 'settings'}
              isActive={activeView === 'settings'}
              onClick={() => onSelectView('settings')}
            >
              <Settings aria-hidden="true" />
              {!collapsed && <span>Privacy &amp; About</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail aria-label="Toggle sidebar from edge" />
    </Sidebar>
  );
}
