import { Archive, Pin, Plus, Search, Settings } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
} from '@/components/ui/sidebar';

export type AppView = 'all' | 'pinned' | 'settings';

interface AppSidebarProps {
  activeView: AppView;
  allCount: number;
  onNewClip: () => void;
  onSearchTextChange: (value: string) => void;
  pinnedCount: number;
  searchText: string;
  onSelectView: (view: AppView) => void;
}

export function AppSidebar({
  activeView,
  allCount,
  onNewClip,
  onSearchTextChange,
  pinnedCount,
  searchText,
  onSelectView,
}: AppSidebarProps) {
  return (
    <Sidebar collapsible="none" className="app-sidebar border-r">
      <SidebarHeader className="app-sidebar-header">
        <label className="sr-only" htmlFor="clip-search">
          Search clips
        </label>
        <div className="search-field sidebar-search">
          <Search aria-hidden="true" />
          <Input
            id="clip-search"
            type="search"
            placeholder="Search clips..."
            value={searchText}
            onChange={(event) => onSearchTextChange(event.currentTarget.value)}
          />
        </div>
        <Button type="button" className="sidebar-new-clip" onClick={onNewClip}>
          <Plus aria-hidden="true" />
          New clip
        </Button>
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
                    aria-pressed={activeView === 'all'}
                    isActive={activeView === 'all'}
                    onClick={() => onSelectView('all')}
                  >
                    <Archive aria-hidden="true" />
                    <span>All Clips</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{allCount}</SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    type="button"
                    aria-pressed={activeView === 'pinned'}
                    isActive={activeView === 'pinned'}
                    onClick={() => onSelectView('pinned')}
                  >
                    <Pin aria-hidden="true" />
                    <span>Pinned</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{pinnedCount}</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Badge variant="outline" className="sidebar-local-status">
          Local only
        </Badge>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              aria-pressed={activeView === 'settings'}
              isActive={activeView === 'settings'}
              onClick={() => onSelectView('settings')}
            >
              <Settings aria-hidden="true" />
              <span>Settings &amp; About</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
