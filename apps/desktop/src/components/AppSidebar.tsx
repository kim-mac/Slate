import type { LibraryItem } from '@ai-clip-memory/shared';
import './sidebarDiscovery.css';
import {
  Archive,
  ChevronRight,
  Pin,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { useRef, type RefObject } from 'react';

import { ClipList } from '@/components/ClipList';
import { UpdateNotice } from '@/components/UpdateNotice';
import { ExtensionNotice } from '@/components/ExtensionNotice';
import type { UpdateControls } from '@/updaterClient';
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
  onOpenExtension: () => Promise<void>;
  updater?: UpdateControls;
  updateBlocked?: boolean;
  activeView: AppView;
  allCount: number;
  clips: LibraryItem[];
  clipListRef: RefObject<HTMLDivElement | null>;
  expandedSection: LibraryView | null;
  hasFilters: boolean;
  isLoading: boolean;
  onSelectClip: (id: string) => void;
  onToggleSection: (view: LibraryView) => void;
  pinnedCount: number;
  selectedId: string | null;
  selectionMode?: boolean;
  selectedClipIds?: ReadonlySet<string>;
  onToggleSelection?: (id: string) => void;
  onSelectView: (view: AppView) => void;
}

export function AppSidebar({
  onOpenExtension,
  updater,
  updateBlocked = false,
  activeView,
  allCount,
  clips,
  clipListRef,
  expandedSection,
  hasFilters,
  isLoading,
  onSelectClip,
  onToggleSection,
  pinnedCount,
  selectedId,
  selectionMode = false,
  selectedClipIds,
  onToggleSelection,
  onSelectView,
}: AppSidebarProps) {
  const { state, setOpen } = useSidebar();
  const collapsed = state === 'collapsed';
  const footer = useRef<HTMLDivElement>(null);
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
                          {isLoading ? (
                            <p className="sidebar-results-message">
                              Loading clips…
                            </p>
                          ) : clips.length > 0 ? (
                            <ClipList
                              ariaLabel={`${label} clip list`}
                              clips={clips}
                              compact
                              itemIdPrefix="sidebar-clip"
                              selectedId={selectedId}
                              onSelect={onSelectClip}
                              selectionMode={selectionMode}
                              selectedClipIds={selectedClipIds}
                              onToggleSelection={onToggleSelection}
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
      <div
        className="sidebar-notifications"
        role="region"
        aria-label="Sidebar notifications"
        tabIndex={0}
      >
        {updater && (
          <UpdateNotice
            controls={updater}
            blocked={updateBlocked}
            collapsed={collapsed}
            onExpand={() => setOpen(true)}
          />
        )}
        <ExtensionNotice
          onOpen={onOpenExtension}
          collapsed={collapsed}
          onExpand={() => setOpen(true)}
          onDismissFocus={() =>
            footer.current
              ?.querySelector<HTMLButtonElement>(
                'button[aria-label="Settings"]',
              )
              ?.focus({ preventScroll: true })
          }
        />
      </div>
      <SidebarFooter ref={footer} className="sidebar-settings-footer">
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
        ) : null}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              aria-label="Settings"
              tooltip="Settings · Local only"
              aria-pressed={activeView === 'settings'}
              isActive={activeView === 'settings'}
              onClick={() => onSelectView('settings')}
            >
              <Settings aria-hidden="true" />
              {!collapsed && <span>Settings</span>}
            </SidebarMenuButton>
            {!collapsed && (
              <span className="sidebar-settings-status">Local only</span>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail aria-label="Toggle sidebar from edge" />
    </Sidebar>
  );
}
