import { BookOpen, LayoutGrid, Network, Settings, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LogoMark } from "@/components/logo";
import { NavLink } from "@/components/nav-link";
import { ThemeToggle } from "@/components/theme";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMenu } from "@/components/user-menu";
import { getOrg, listProjects, listUserOrgs } from "@/lib/data";
import { requireUser } from "@/lib/session";

export default function OrgLayout({
  children,
  params,
}: LayoutProps<"/app/[org]">) {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Suspense fallback={<Skeleton className="h-10 w-full" />}>
            <OrgHeader params={params} />
          </Suspense>
        </SidebarHeader>
        <SidebarContent>
          <Suspense
            fallback={
              <SidebarGroup className="gap-2">
                <Skeleton className="h-7 w-4/5" />
                <Skeleton className="h-7 w-3/5" />
              </SidebarGroup>
            }
          >
            <ProjectNav params={params} />
          </Suspense>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link href="/#how-it-works" />}>
                <BookOpen />
                <span>How it works</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Suspense fallback={<Skeleton className="h-12 w-full" />}>
                <AccountMenu params={params} />
              </Suspense>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>
        <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

async function AccountMenu({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const user = await requireUser();
  const orgs = await listUserOrgs(user.id);
  return (
    <UserMenu
      user={{ name: user.name, email: user.email }}
      currentOrg={slug}
      orgs={orgs.map((o) => ({ slug: o.slug, name: o.name, role: o.role }))}
    />
  );
}

async function OrgHeader({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const user = await requireUser();
  const org = await getOrg(user.id, slug);
  if (!org) notFound();
  return (
    <Link
      href={`/app/${org.slug}`}
      className="flex items-center gap-2 rounded-md p-1.5 hover:bg-sidebar-accent"
    >
      <LogoMark className="size-7 shrink-0" />
      <div className="grid leading-tight group-data-[collapsible=icon]:hidden">
        <span className="text-sm font-semibold">ToolGrade</span>
        <span className="text-xs text-muted-foreground">{org.name}</span>
      </div>
    </Link>
  );
}

async function ProjectNav({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const user = await requireUser();
  const org = await getOrg(user.id, slug);
  if (!org) return null;
  const list = await listProjects(org.id);
  const base = `/app/${org.slug}`;
  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <NavLink href={base} exact>
              <LayoutGrid />
              <span>Overview</span>
            </NavLink>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <NavLink href={`${base}/members`} exact>
              <Users />
              <span>Members</span>
            </NavLink>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <NavLink href={`${base}/settings`} exact>
              <Settings />
              <span>Settings</span>
            </NavLink>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {list.map((p) => (
              <SidebarMenuItem key={p.id}>
                <NavLink href={`${base}/${p.slug}`} exact>
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      background: p.latest
                        ? p.latest.gatePassed
                          ? "var(--status-good)"
                          : "var(--status-critical)"
                        : "var(--border)",
                    }}
                    aria-hidden
                  />
                  <span className="truncate">{p.name}</span>
                </NavLink>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <NavLink sub href={`${base}/${p.slug}/runs`}>
                      Run history
                    </NavLink>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <NavLink sub href={`${base}/${p.slug}/compare`}>
                      Compare runs
                    </NavLink>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <NavLink sub href={`${base}/${p.slug}/model-matrix`}>
                      Model matrix
                    </NavLink>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <NavLink sub href={`${base}/${p.slug}/tool-graph`}>
                      <Network />
                      Tool graph
                    </NavLink>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <NavLink sub href={`${base}/${p.slug}/settings`}>
                      Settings & CI
                    </NavLink>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
