import {
  Archive,
  Pin,
  Plus,
  Search,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import type { RefObject } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

export type AppView = 'all' | 'pinned' | 'settings';

interface AppSidebarProps {
  activeView: AppView;
  allCount: number;
  onNewClip: () => void;
  onSearchTextChange: (value: string) => void;
  pinnedCount: number;
  searchText: string;
  searchRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onSearchResults: () => void;
  onFocusSearch: () => void;
  onSelectView: (view: AppView) => void;
}

export function AppSidebar({
  activeView,
  allCount,
  onNewClip,
  onSearchTextChange,
  pinnedCount,
  searchText,
  searchRef,
  disabled,
  onSearchResults,
  onFocusSearch,
  onSelectView,
}: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  return (
    <Sidebar collapsible="icon" className="app-sidebar">
      <SidebarHeader className="app-sidebar-header">
        {collapsed ? (
          <SidebarMenuButton
            aria-label="Search clips"
            tooltip="Search clips (Ctrl/Cmd+F)"
            onClick={onFocusSearch}
          >
            <Search aria-hidden="true" />
          </SidebarMenuButton>
        ) : (
          <>
            <label className="sr-only" htmlFor="clip-search">
              Search clips
            </label>
            <div className="search-field sidebar-search">
              <Search aria-hidden="true" />
              <Input
                id="clip-search"
                ref={searchRef}
                title="Search clips (Ctrl/Cmd+F)"
                onKeyDown={(event) => {
                  if (
                    event.key === 'ArrowDown' &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    onSearchResults();
                  }
                }}
                type="search"
                placeholder="Search clips..."
                value={searchText}
                onChange={(event) =>
                  onSearchTextChange(event.currentTarget.value)
                }
              />
            </div>
          </>
        )}
        <SidebarMenuButton
          type="button"
          className="sidebar-new-clip bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
          aria-label="New clip"
          tooltip="New clip"
          onClick={onNewClip}
          disabled={disabled}
        >
          <Plus aria-hidden="true" />
          {!collapsed && <span>New clip</span>}
        </SidebarMenuButton>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Clip library">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    type="button"
                    aria-label="All Clips"
                    tooltip={`All Clips (${allCount})`}
                    aria-pressed={activeView === 'all'}
                    isActive={activeView === 'all'}
                    onClick={() => onSelectView('all')}
                  >
                    <Archive aria-hidden="true" />
                    {!collapsed && <span>All Clips</span>}
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{allCount}</SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    type="button"
                    aria-label="Pinned"
                    tooltip={`Pinned (${pinnedCount})`}
                    aria-pressed={activeView === 'pinned'}
                    isActive={activeView === 'pinned'}
                    onClick={() => onSelectView('pinned')}
                  >
                    <Pin aria-hidden="true" />
                    {!collapsed && <span>Pinned</span>}
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{pinnedCount}</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {collapsed ? (
          <span
            className="sidebar-privacy-icon"
            title="Local only — no account or cloud required"
          >
            <ShieldCheck role="img" aria-label="Local only" />
          </span>
        ) : (
          <Badge variant="outline" className="sidebar-local-status">
            Local only
          </Badge>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              aria-label="Settings & About"
              tooltip="Settings & About · Local only"
              aria-pressed={activeView === 'settings'}
              isActive={activeView === 'settings'}
              onClick={() => onSelectView('settings')}
            >
              <Settings aria-hidden="true" />
              {!collapsed && <span>Settings &amp; About</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail aria-label="Toggle sidebar from edge" />
    </Sidebar>
  );
}
