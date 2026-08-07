"use client";

import {
  Clock3,
  Code2,
  Compass,
  Database,
  FlameIcon,
  Home,
  LayoutGrid,
  Lightbulb,
  Star,
  Terminal,
  type LucideIcon,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

interface PlaygroundData {
  id: string;
  name: string;
  icon: string;
  starred: boolean;
}

const technologyIcons: Record<string, LucideIcon> = {
  Zap,
  Lightbulb,
  Database,
  Compass,
  FlameIcon,
  Terminal,
  Code2,
};

function ProjectLink({ project, pathname }: { project: PlaygroundData; pathname: string }) {
  const Icon = technologyIcons[project.icon] || Code2;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={pathname === `/playground/${project.id}`} tooltip={project.name}>
        <Link href={`/playground/${project.id}`}>
          <Icon />
          <span className="truncate">{project.name}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function DashboardSidebar({ initialPlaygroundData }: { initialPlaygroundData: PlaygroundData[] }) {
  const pathname = usePathname();
  const starredProjects = initialPlaygroundData.filter((project) => project.starred);
  const recentProjects = initialPlaygroundData.slice(0, 6);

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b p-3">
        <Link href="/" className="flex h-9 items-center gap-2.5 px-2" aria-label="LiveIDE home">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <Code2 className="size-4" />
          </span>
          <span className="text-sm font-semibold group-data-[collapsible=icon]:hidden">LiveIDE</span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="py-2">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Home">
                <Link href="/"><Home /><span>Home</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/dashboard"} tooltip="Projects">
                <Link href="/dashboard"><LayoutGrid /><span>Projects</span></Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {starredProjects.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel><Star /> Favorites</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {starredProjects.map((project) => <ProjectLink key={project.id} project={project} pathname={pathname} />)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel><Clock3 /> Recent</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {recentProjects.length > 0 ? (
                recentProjects.map((project) => <ProjectLink key={project.id} project={project} pathname={pathname} />)
              ) : (
                <p className="px-2 py-3 text-xs leading-5 text-muted-foreground group-data-[collapsible=icon]:hidden">
                  Your recent projects will appear here.
                </p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-3">
        <p className="px-2 text-[11px] leading-4 text-muted-foreground group-data-[collapsible=icon]:hidden">
          Browser workspace
          <br />Projects persist automatically.
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
