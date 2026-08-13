"use client";

import { useState } from "react";
import { Bell, ChevronDown, Search, User, LogOut, Settings, LifeBuoy, Menu, Building2, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useAlerts } from "@/hooks/useAlerts";
import { GlobalSearch } from "@/components/GlobalSearch";
import { SystemStatusDropdown } from "@/components/SystemStatusDropdown";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

interface TopBarProps {
  onSidebarToggle: () => void;
}

export function TopBar({ onSidebarToggle }: TopBarProps) {
  const router = useRouter();
  const { logout, user, effectiveUserId, availableWorkspaces, activeWorkspace, switchWorkspace } = useAuth();
  const userId = effectiveUserId;

  const { data: alerts = [] } = useAlerts(userId);
  const hasUnreadAlerts = alerts.some((a) => !a.is_read);

  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  return (
    <>
      <GlobalSearch open={globalSearchOpen} onOpenChange={setGlobalSearchOpen} />
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-background/90 px-4 shadow-sm backdrop-blur-md sm:px-5 z-30">
        {/* Mobile menu toggle */}
        <div className="flex items-center md:hidden shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onSidebarToggle}
            aria-label="Open menu"
            className="h-8 w-8 text-muted-foreground hover:text-white hover:bg-primary transition-colors"
          >
            <Menu className="w-4 h-4" />
          </Button>
        </div>

        {/* Search bar — desktop */}
        <div className="flex items-center gap-4 flex-1 hidden lg:flex">
          <button
            type="button"
            onClick={() => setGlobalSearchOpen(true)}
            className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-sm text-muted-foreground transition-all hover:bg-primary hover:border-primary hover:text-white focus:outline-none focus:ring-2 focus:ring-ring/50"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left text-xs">Search campaigns, contacts, emails…</span>
            <kbd className="pointer-events-none hidden rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-block">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1 sm:gap-2 flex-1 justify-end">

          {/* Workspace switcher — shown when user is a sub-user of at least one workspace */}
          {availableWorkspaces.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 rounded-lg hover:bg-primary hover:text-white transition-colors text-xs"
                >
                  <Building2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:block max-w-[110px] truncate font-medium">
                    {activeWorkspace
                      ? (activeWorkspace.owner_company || activeWorkspace.owner_name)
                      : "My Workspace"}
                  </span>
                  {activeWorkspace && (
                    <Badge
                      variant="outline"
                      className="hidden sm:inline-flex ml-0.5 h-4 px-1 text-[9px] font-bold uppercase bg-primary/10 border-primary/20 text-primary"
                    >
                      Guest
                    </Badge>
                  )}
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                  Switch workspace
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {/* Own workspace */}
                <DropdownMenuItem
                  className="gap-2 text-sm"
                  onClick={() => switchWorkspace(null)}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-3 w-3 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">My Workspace</p>
                    <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                  </div>
                  {!activeWorkspace && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {availableWorkspaces.map((ws) => (
                  <DropdownMenuItem
                    key={ws.owner_id}
                    className="gap-2 text-sm"
                    onClick={() => switchWorkspace(ws.owner_id)}
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Building2 className="h-3 w-3 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {ws.owner_company || ws.owner_name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{ws.owner_email}</p>
                    </div>
                    {activeWorkspace?.owner_id === ws.owner_id && (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <ThemeToggle />
          <SystemStatusDropdown />

          {/* Notifications */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 relative text-muted-foreground hover:text-white hover:bg-primary transition-colors"
                onClick={() => router.push("/alerts")}
                aria-label="View Alerts"
              >
                <Bell className="w-4 h-4" />
                {hasUnreadAlerts && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary rounded-full ring-2 ring-background" aria-hidden />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Notifications</TooltipContent>
          </Tooltip>

          {/* Support */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-white hover:bg-primary transition-colors"
                onClick={() => router.push("/tickets")}
                aria-label="Support tickets"
              >
                <LifeBuoy className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Support</TooltipContent>
          </Tooltip>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 gap-1.5 px-1.5 group rounded-lg hover:bg-primary hover:text-white transition-colors"
              >
                <div className="w-6 h-6 rounded-full gradient-primary flex items-center justify-center shrink-0">
                  <User className="w-3 h-3 text-primary-foreground" />
                </div>
                <span className="hidden sm:block text-xs font-medium max-w-[80px] truncate">
                  {user?.first_name
                    ? user.first_name.charAt(0).toUpperCase() + user.first_name.slice(1)
                    : user?.email?.split("@")[0] || "User"}
                </span>
                <ChevronDown className="w-3 h-3 text-muted-foreground group-hover:text-white transition-transform group-data-[state=open]:rotate-180" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-sm">
                    {user?.first_name
                      ? user.first_name.charAt(0).toUpperCase() + user.first_name.slice(1)
                      : user?.email?.split("@")[0] || "User"}
                  </span>
                  <span className="text-xs text-muted-foreground font-normal truncate">{user?.email || "user@example.com"}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")} className="gap-2 text-sm">
                <Settings className="w-3.5 h-3.5" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="gap-2 text-sm text-destructive focus:text-destructive">
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  );
}