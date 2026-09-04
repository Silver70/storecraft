import * as React from "react";
import {
  Link,
  useNavigate,
  useRouteContext,
  useRouterState,
} from "@tanstack/react-router";
import {
  LayoutDashboardIcon,
  ChartColumnIcon,
  PackageIcon,
  FolderTreeIcon,
  BoxesIcon,
  ShoppingCartIcon,
  UsersIcon,
  UsersRoundIcon,
  PercentIcon,
  TagsIcon,
  MegaphoneIcon,
  TruckIcon,
  SettingsIcon,
  ChevronsUpDownIcon,
  UserIcon,
  BellIcon,
  LogOutIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "~/components/ui/sidebar";

type NavItem = {
  title: string;
  url: string;
  icon: React.ElementType;
};

const primaryNav: NavItem[] = [
  { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboardIcon },
  { title: "Analytics", url: "/admin/analytics", icon: ChartColumnIcon },
  { title: "Products", url: "/admin/products", icon: PackageIcon },
  { title: "Categories", url: "/admin/categories", icon: FolderTreeIcon },
  { title: "Inventory", url: "/admin/inventory", icon: BoxesIcon },
  { title: "Orders", url: "/admin/orders", icon: ShoppingCartIcon },
  { title: "Customers", url: "/admin/customers", icon: UsersIcon },
  {
    title: "Customer Groups",
    url: "/admin/customer-groups",
    icon: UsersRoundIcon,
  },
  { title: "Discounts", url: "/admin/discounts", icon: PercentIcon },
  { title: "Price Lists", url: "/admin/price-lists", icon: TagsIcon },
];

// Campaigns are managed objects with full CRUD, like Discounts — not another
// tab on the read-only Analytics page — so Marketing is its own section.
const marketingNav: NavItem[] = [
  { title: "Campaigns", url: "/admin/campaigns", icon: MegaphoneIcon },
];

const secondaryNav: NavItem[] = [
  { title: "Shipping", url: "/admin/shipping", icon: TruckIcon },
  { title: "Settings", url: "/admin/settings", icon: SettingsIcon },
];

function NavLink({ item }: { item: NavItem }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = pathname === item.url || pathname.startsWith(item.url + "/");

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={item.title}
        isActive={isActive}
        size="lg"
        className="[&>svg]:size-5"
      >
        <Link to={item.url}>
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  product_manager: "Product Manager",
  support_agent: "Support Agent",
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  // Session comes from the /admin route's beforeLoad — the sidebar only renders
  // inside that layout, so it is always present.
  const { session } = useRouteContext({ from: "/admin" });
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  const avatarInitial = session.email?.[0]?.toUpperCase() ?? "U";
  const displayEmail = session.email ?? "Account";
  const displayRole = session.role
    ? (ROLE_LABELS[session.role] ?? session.role)
    : "Admin";

  function handleLogout() {
    setIsLoggingOut(true);
    // /auth/signout revokes the refresh token, clears cookies, then redirects.
    void navigate({ to: "/auth/signout" });
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-16 border-b p-0">
        <div className="flex h-full w-full items-center group-data-[collapsible=icon]:justify-center">
          <Link
            to="/admin/dashboard"
            className="flex items-center gap-2.5 px-4 group-data-[collapsible=icon]:px-0"
          >
            <img
              src="/logo-commerceos.svg"
              alt="Commerce OS"
              className="h-8 w-8 shrink-0"
            />
            <span className="group-data-[collapsible=icon]:hidden font-bold text-sm  overflow-hidden whitespace-nowrap">
              COMMERCE OS
            </span>
          </Link>
        </div>
      </SidebarHeader>

      <SidebarContent className="pt-2">
        {/* Primary: Dashboard → Discounts */}
        <SidebarGroup>
          <SidebarMenu className="group-data-[collapsible=icon]:gap-1.5">
            {primaryNav.map((item) => (
              <NavLink key={item.title} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Marketing: Campaigns */}
        <SidebarGroup>
          <SidebarGroupLabel>Marketing</SidebarGroupLabel>
          <SidebarMenu className="group-data-[collapsible=icon]:gap-1.5">
            {marketingNav.map((item) => (
              <NavLink key={item.title} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Secondary: Shipping, Settings */}
        <SidebarGroup>
          <SidebarMenu className="group-data-[collapsible=icon]:gap-1.5">
            {secondaryNav.map((item) => (
              <NavLink key={item.title} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-sm font-medium">
                      {avatarInitial}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="font-medium truncate">{displayEmail}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {displayRole}
                    </span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto h-4 w-4 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56"
                side="top"
                align="start"
                sideOffset={8}
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium truncate">
                      {displayEmail}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {displayRole}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    <UserIcon className="mr-2 h-4 w-4" />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <BellIcon className="mr-2 h-4 w-4" />
                    Notifications
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={handleLogout}
                  disabled={isLoggingOut}
                >
                  <LogOutIcon className="mr-2 h-4 w-4" />
                  {isLoggingOut ? "Signing out…" : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Rail: click the edge to collapse/expand on desktop */}
      <SidebarRail />
    </Sidebar>
  );
}
