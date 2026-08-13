"use client";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Inbox,
  Send,
  Users,
  FileText,
  BarChart3,
  Globe,
  Flame,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bell,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Sparkles,
  User,
  Lock,
  Link2,
  Shield,
  CreditCard,
  Activity,
  BookOpen,
  ChevronDown,
  UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useProductTour } from "@/contexts/ProductTourContext";
import { useAlerts } from "@/hooks/useAlerts";
import { useInboxEmails } from "@/hooks/useInboxEmails";
import { usePlanGate } from "@/hooks/usePlanGate";
import { api, type SubUserPermissionsPayload } from "@/lib/api";
import { PremiumBadge } from "@/components/PremiumBadge";
import { useActivationProgress } from "@/hooks/useActivationProgress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

interface NavSubItem {
  title: string;
  path: string;
  icon?: React.ComponentType<{ className?: string }>;
  premiumLabel?: string;
  /** Sidebar numeric badge (e.g. inbox sub-routes use separate unread counts) */
  badgeKey?: string;
}

interface NavItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  badgeKey?: string;
  tourId?: string;
  premiumLabel?: string;
  /** Key into SubUserPermissions to check visibility, or "__owner_only__" to hide for sub-users */
  permKey?: string;
  children?: NavSubItem[];
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

const SIDEBAR_TOUR_ID_BY_STEP: Record<number, string> = {
  0: "sidebar-dashboard",
  1: "sidebar-get-started",
  2: "sidebar-dashboard",
  3: "sidebar-dashboard",
  4: "sidebar-dashboard",
  5: "sidebar-dashboard",
  6: "sidebar-dashboard",
  7: "sidebar-dashboard",
  8: "sidebar-campaigns",
  9: "sidebar-campaigns",
  10: "sidebar-campaigns",
  11: "sidebar-campaigns",
  12: "sidebar-campaigns",
  13: "sidebar-campaigns",
  14: "sidebar-campaigns",
  15: "sidebar-campaigns",
  16: "sidebar-campaigns",
  17: "sidebar-inbox",
  18: "sidebar-templates",
  19: "sidebar-templates",
  20: "sidebar-templates",
  21: "sidebar-templates",
  22: "sidebar-contacts",
  23: "sidebar-contacts",
  24: "sidebar-contacts",
  25: "sidebar-contacts",
  26: "sidebar-analytics",
  27: "sidebar-analytics",
  28: "sidebar-tracking",
  29: "sidebar-tracking",
  30: "sidebar-domains",
  31: "sidebar-domains",
  32: "sidebar-inboxes",
  33: "sidebar-warmup",
};

const navSections: NavSection[] = [
  {
    items: [
      { title: "Home", icon: LayoutDashboard, path: "/dashboard", tourId: "sidebar-dashboard", permKey: "dashboard" },
    ],
  },
  {
    label: "Engage",
    items: [
      {
        title: "Inbox",
        icon: Inbox,
        path: "/inbox/campaign-replies",
        badgeKey: "unreadEmails",
        tourId: "sidebar-inbox",
        permKey: "inbox",
        children: [
          { title: "Campaign replies", path: "/inbox/campaign-replies", badgeKey: "inboxCampaignUnread" },
          { title: "Mailbox", path: "/inbox/mailbox", badgeKey: "inboxMailboxUnread" },
        ],
      },
      { title: "Campaigns", icon: Send, path: "/campaigns", tourId: "sidebar-campaigns", permKey: "campaigns" },
      { title: "AI Studio", icon: Sparkles, path: "/ai-campaign-studio", tourId: "sidebar-outreach", permKey: "campaigns" },
      {
        title: "Contacts",
        icon: Users,
        path: "/contacts",
        tourId: "sidebar-contacts",
        permKey: "contacts",
        children: [
          { title: "All contacts", path: "/contacts" },
          { title: "Block / unblock", path: "/contacts/manual-block-unblock" },
          { title: "Risky email log", path: "/contacts/risky-email-history" },
          { title: "Smart Leads", path: "/contacts/smart-leads", premiumLabel: "Pro" },
        ],
      },
      {
        title: "Templates",
        icon: FileText,
        path: "/templates",
        tourId: "sidebar-templates",
        permKey: "templates",
        children: [
          { title: "All templates", path: "/templates" },
          { title: "Builder", path: "/templates/builder" },
          { title: "Library", path: "/templates/library" },
          { title: "Guide", path: "/templates/guide" },
          { title: "Examples", path: "/templates/examples" },
          { title: "Prompts", path: "/templates/prompts" },
        ],
      },
      { title: "Workflows", icon: Activity, path: "/workflows", tourId: "sidebar-workflows", permKey: "workflows" },
    ],
  },
  {
    label: "Performance",
    items: [
      { title: "Analytics", icon: BarChart3, path: "/analytics", tourId: "sidebar-analytics", permKey: "analytics" },
      { title: "Tracking", icon: Activity, path: "/tracking", tourId: "sidebar-tracking", permKey: "tracking" },
    ],
  },
  {
    label: "Deliverability",
    items: [
      { title: "Domains", icon: Globe, path: "/domains", tourId: "sidebar-domains", permKey: "domains" },
      { title: "Inbox accounts", icon: Mail, path: "/inboxes", tourId: "sidebar-inboxes", permKey: "inboxes" },
      {
        title: "Warmup",
        icon: Flame,
        path: "/warmup",
        tourId: "sidebar-warmup",
        permKey: "warmup",
        children: [
          { title: "Dashboard", path: "/warmup" },
          { title: "Email Templates", path: "/warmup/templates" },
          { title: "My Network", path: "/warmup/network" },
          { title: "Sent Emails", path: "/warmup/logs" },
          { title: "Pool Activity", path: "/warmup/alerts" },
          { title: "Guide & FAQ", path: "/warmup/learn" },
        ],
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      { title: "Alerts", icon: Bell, path: "/alerts", badgeKey: "unreadAlerts" },
      { title: "Support", icon: MessageSquare, path: "/tickets" },
      { title: "Team Members", icon: UserCog, path: "/workspace/sub-users", permKey: "__owner_only__" },
      {
        title: "Settings",
        icon: Settings,
        path: "/settings",
        permKey: "settings",
        children: [
          { title: "Account", path: "/settings?tab=account", icon: User },
          { title: "Security", path: "/settings?tab=security", icon: Lock },
          { title: "Notifications", path: "/settings?tab=notifications", icon: Bell },
          { title: "Integrations", path: "/settings?tab=integrations", icon: Link2 },
          { title: "Compliance", path: "/settings?tab=compliance", icon: Shield },
          { title: "Billing", path: "/settings?tab=billing", icon: CreditCard },
        ],
      },
    ],
  },
];

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isDesktop: boolean;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function AppSidebar({
  collapsed,
  onToggle,
  isDesktop,
  isMobileOpen = false,
  onMobileClose,
}: AppSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentSearch = searchParams?.toString() ? `?${searchParams.toString()}` : "";
  const { user, effectiveUserId, clearDemoUser, activeWorkspace } = useAuth();
  const isDemoUser = user?.id === "demo-user";
  const userId = effectiveUserId;
  const activation = useActivationProgress(userId);

  const campaignGate = usePlanGate("campaigns");
  const inboxGate = usePlanGate("inboxes");
  const warmupGate = usePlanGate("warmup");

  // Sub-user mode: driven by activeWorkspace from AuthContext (set when workspace is switched)
  const isSubUser = !!activeWorkspace;
  const subPerms = activeWorkspace?.permissions;

  const isNavItemVisible = (item: NavItem): boolean => {
    if (!isSubUser) return true;
    // Owner-only items (like Team Members) are hidden from sub-users
    if (item.permKey === "__owner_only__") return false;
    if (!subPerms || !item.permKey) return true;
    return subPerms[item.permKey as keyof SubUserPermissionsPayload] !== false;
  };

  const { tourStepIndex } = useProductTour();
  const tourActiveTourId =
    tourStepIndex != null
      ? (SIDEBAR_TOUR_ID_BY_STEP[tourStepIndex] ?? "sidebar-dashboard")
      : null;

  /** Same filter + cache key as Campaign replies page so counts show before visiting /inbox */
  const { data: emails = [], isPending: campaignEmailsPending } = useInboxEmails(userId, "replied");
  const { data: alerts = [] } = useAlerts(userId);
  const receivedAllQueryKey = ["inbox-received-all", userId];
  const {
    data: receivedThreadsPage,
    isPending: receivedMailboxPending,
  } = useQuery({
    queryKey: receivedAllQueryKey,
    queryFn: () => api.inbox.getReceivedEmails(userId, { limit: 100, unread_only: true }),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
  const receivedThreads = receivedThreadsPage?.threads ?? [];

  const campaignUnreadCount = useMemo(
    () => emails.filter((e) => (e.labels?.includes("replied") ?? false) && !e.isRead).length,
    [emails]
  );
  const receivedUnreadCount = useMemo(
    () => receivedThreads.filter((t) => !t.is_read).length,
    [receivedThreads]
  );
  const getBadgeValue = (badgeKey?: string): number | undefined => {
    if (!badgeKey) return undefined;
    if (badgeKey === "unreadEmails") {
      if (!userId) return undefined;
      if (campaignEmailsPending && receivedMailboxPending) return undefined;
      const total = campaignUnreadCount + receivedUnreadCount;
      return total > 0 ? total : undefined;
    }
    if (badgeKey === "unreadAlerts") {
      const unreadCount = alerts.filter((a) => !a.is_read).length;
      return unreadCount > 0 ? unreadCount : undefined;
    }
    return undefined;
  };

  const getSubNavBadgeValue = (badgeKey?: string): number | undefined => {
    if (!badgeKey) return undefined;
    if (badgeKey === "inboxCampaignUnread") {
      if (!userId || campaignEmailsPending) return undefined;
      return campaignUnreadCount > 0 ? campaignUnreadCount : undefined;
    }
    if (badgeKey === "inboxMailboxUnread") {
      if (!userId || receivedMailboxPending) return undefined;
      return receivedUnreadCount > 0 ? receivedUnreadCount : undefined;
    }
    return undefined;
  };

  const isCollapsed = isDesktop ? collapsed : false;

  const [navExpanded, setNavExpanded] = useState<Record<string, boolean>>({});
  const navRef = useRef<HTMLElement>(null);

  const isSubPathActive = useCallback(
    (subPath: string) => {
      const full = pathname + currentSearch;
      if (full === subPath) return true;

      // Settings children use ?tab=...; bare /settings is the Account tab (matches settings page default)
      if (pathname === "/settings" && subPath.startsWith("/settings?")) {
        const subQs = subPath.split("?")[1] ?? "";
        const subTab = new URLSearchParams(subQs).get("tab") || "account";
        const currentTab = searchParams?.get("tab") || "account";
        return subTab === currentTab;
      }

      return false;
    },
    [pathname, currentSearch, searchParams]
  );

  const hasActiveChildNav = (item: NavItem) =>
    item.children?.some((sub) => isSubPathActive(sub.path)) ?? false;

  const isNavGroupOpen = (item: NavItem) => {
    if (!item.children?.length) return false;
    const key = item.path;
    if (hasActiveChildNav(item)) return navExpanded[key] !== false;
    return navExpanded[key] === true;
  };

  const toggleNavGroup = (item: NavItem) => {
    const key = item.path;
    const open = isNavGroupOpen(item);
    setNavExpanded((prev) => ({ ...prev, [key]: !open }));
  };

  useEffect(() => {
    if (!tourActiveTourId) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${tourActiveTourId}"]`);
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      el.scrollIntoView();
    }
  }, [tourActiveTourId]);

  // Scroll sidebar so active expanded group's full sub-list is visible
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || isCollapsed) return;
    // Small delay so Framer Motion expansion animation has started
    const id = setTimeout(() => {
      const activeItem = nav.querySelector<HTMLElement>("[data-nav-active-group]");
      if (!activeItem) return;
      const navBottom = nav.getBoundingClientRect().bottom;
      const itemBottom = activeItem.getBoundingClientRect().bottom;
      if (itemBottom > navBottom) {
        nav.scrollBy({ top: itemBottom - navBottom + 16, behavior: "smooth" });
      }
    }, 120);
    return () => clearTimeout(id);
  }, [pathname, isCollapsed]);

  const renderNavItem = (item: NavItem) => {
    const hasChildren = !!item.children?.length;
    const isParentActive =
      pathname === item.path ||
      (item.path !== "/dashboard" && pathname.startsWith(`${item.path}/`)) ||
      hasActiveChildNav(item);
    const isTourRunning = tourStepIndex != null;
    const isTourActive =
      isTourRunning &&
      tourActiveTourId != null &&
      item.tourId != null &&
      tourActiveTourId === item.tourId;
    const isActive = isTourRunning && item.tourId ? isTourActive : isParentActive;

    const premiumForItem =
      item.path === "/campaigns"
        ? campaignGate
        : item.path === "/inboxes"
        ? inboxGate
        : item.path === "/warmup"
        ? warmupGate
        : null;

    const badgeCount = getBadgeValue(item.badgeKey);

    const itemCls = cn(
      "relative flex items-center gap-2.5 rounded-md transition-all duration-150 group outline-none",
      "focus-visible:ring-2 focus-visible:ring-sidebar-primary/40",
      isCollapsed
        ? "w-9 h-9 justify-center mx-auto"
        : hasChildren
          ? "h-8 px-2.5 flex-1 min-w-0"
          : "h-8 px-2.5 w-full",
      isActive
        ? "bg-gradient-to-r from-primary to-primary/70 shadow-[0_1px_8px_rgba(59,130,246,0.28)]"
        : "hover:bg-white/[0.06]"
    );

    const icon = (
      <span
        className={cn(
          "flex-shrink-0 w-[16px] h-[16px] transition-colors duration-150",
          isActive
            ? "text-white"
            : "text-sidebar-muted group-hover:text-sidebar-foreground"
        )}
      >
        <item.icon className="w-full h-full" />
      </span>
    );

    const label = !isCollapsed && (
      <span
        className={cn(
          "text-[13px] font-medium whitespace-nowrap flex-1 min-w-0 truncate leading-none",
          isActive
            ? "text-white"
            : "text-sidebar-foreground/70 group-hover:text-sidebar-foreground"
        )}
      >
        {item.title}
      </span>
    );

    const trailing = !isCollapsed && (
      <>
        {premiumForItem?.atLimit && (
          <span className="ml-auto shrink-0">
            <PremiumBadge label="Pro" />
          </span>
        )}
        {item.premiumLabel && (
          <Badge
            variant="outline"
            className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 border-amber-500/25 text-amber-400 px-1.5 py-0 h-[16px]"
          >
            {item.premiumLabel}
          </Badge>
        )}
        {badgeCount != null && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={cn(
              "ml-auto min-w-[18px] h-[18px] flex items-center justify-center text-[11px] font-semibold px-1.5 rounded-full",
              isActive
                ? "bg-white text-primary border-0"
                : "bg-primary/15 text-primary border border-primary/20"
            )}
          >
            {badgeCount}
          </motion.span>
        )}
      </>
    );

    const dot =
      isCollapsed && badgeCount != null && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-primary rounded-full ring-[1.5px] ring-sidebar" />
      );

    const subList = () => (
      <ul className="mt-0.5 ml-[15px] border-l border-white/[0.07] pb-1 pl-3">
        {item.children!.map((sub) => {
          const isSubActive = isSubPathActive(sub.path);
          const SubIcon = sub.icon;
          const subBadgeCount = getSubNavBadgeValue(sub.badgeKey);
          return (
            <li key={sub.path}>
              <Link
                href={sub.path}
                onClick={() => onMobileClose?.()}
                className={cn(
                  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-[12px] transition-all duration-150",
                  isSubActive
                    ? "bg-primary/[0.08] font-medium text-primary"
                    : "text-sidebar-foreground/45 hover:bg-white/[0.04] hover:text-sidebar-foreground/85"
                )}
              >
                {SubIcon ? (
                  <SubIcon className="h-3 w-3 shrink-0 opacity-55" />
                ) : (
                  <span
                    className={cn(
                      "h-1 w-1 flex-shrink-0 rounded-full transition-colors",
                      isSubActive ? "bg-primary" : "bg-sidebar-foreground/20"
                    )}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{sub.title}</span>
                {sub.premiumLabel && (
                  <span className="ml-auto shrink-0">
                    <PremiumBadge label={sub.premiumLabel} />
                  </span>
                )}
                {subBadgeCount != null && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className={cn(
                      "ml-auto shrink-0 min-w-[18px] h-[18px] flex items-center justify-center text-[11px] font-semibold px-1.5 rounded-full",
                      isSubActive
                        ? "bg-primary/25 text-primary border border-primary/30"
                        : "bg-primary/15 text-primary border border-primary/20"
                    )}
                  >
                    {subBadgeCount}
                  </motion.span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    );

    return (
      <li
        key={item.path}
        className={hasChildren && !isCollapsed ? "space-y-0" : undefined}
        {...(hasChildren && !isCollapsed && isNavGroupOpen(item) && hasActiveChildNav(item)
          ? { "data-nav-active-group": true }
          : {})}
      >
        {isCollapsed && hasChildren ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={itemCls}
                aria-label={`${item.title} menu`}
                {...(item.tourId ? { "data-tour": item.tourId } : {})}
              >
                {icon}
                {dot}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              sideOffset={10}
              className="min-w-[210px] rounded-xl border border-white/[0.08] bg-[#1a1d27] p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
            >
              <div className="px-3 py-1.5 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted/50 select-none">
                <span>{item.title}</span>
                {item.path === "/inbox/campaign-replies" && badgeCount != null && (
                  <span
                    className={cn(
                      "min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[11px] font-semibold px-1.5",
                      "bg-primary/15 text-primary border border-primary/20"
                    )}
                  >
                    {badgeCount}
                  </span>
                )}
              </div>
              <div className="mx-2 mb-1 h-px bg-white/[0.06]" />
              {item.children!.map((sub) => {
                const isSubActive = isSubPathActive(sub.path);
                const SubIcon = sub.icon;
                const subBadgeCount = getSubNavBadgeValue(sub.badgeKey);
                const isLearnWarmup = sub.path === "/warmup/learn";
                return (
                  <DropdownMenuItem key={sub.path} asChild>
                    <Link
                      href={sub.path}
                      className={cn(
                        "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                        isLearnWarmup && !isSubActive && "bg-primary/10 text-primary hover:bg-primary/15",
                        isSubActive
                          ? "bg-primary/15 font-medium text-primary"
                          : "text-sidebar-muted hover:bg-white/[0.05] hover:text-sidebar-foreground"
                      )}
                    >
                      {SubIcon ? (
                        <SubIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      ) : !isLearnWarmup ? (
                        <span
                          className={cn(
                            "h-1 w-1 flex-shrink-0 rounded-full",
                            isSubActive ? "bg-primary" : "bg-current opacity-25"
                          )}
                        />
                      ) : (
                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/80" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{sub.title}</span>
                      {isLearnWarmup && !isSubActive && (
                        <span className="ml-auto shrink-0 rounded-full border border-primary/25 bg-primary/15 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-primary">
                          Guide
                        </span>
                      )}
                      {sub.premiumLabel && (
                        <span className="ml-auto shrink-0">
                          <PremiumBadge label={sub.premiumLabel} />
                        </span>
                      )}
                      {subBadgeCount != null && (
                        <span
                          className={cn(
                            "ml-auto shrink-0 min-w-[18px] h-[18px] flex items-center justify-center text-[11px] font-semibold px-1.5 rounded-full",
                            isSubActive
                              ? "bg-primary/25 text-primary border border-primary/30"
                              : "bg-primary/15 text-primary border border-primary/20"
                          )}
                        >
                          {subBadgeCount}
                        </span>
                      )}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : hasChildren && !isCollapsed ? (
          <div className="flex w-full min-w-0 items-center gap-0.5">
            <Link
              href={item.path}
              onClick={(e) => {
                if (isDemoUser && item.path === "/dashboard") {
                  e.preventDefault();
                  clearDemoUser();
                  router.push("/login");
                  onMobileClose?.();
                } else {
                  onMobileClose?.();
                }
              }}
              className={itemCls}
              {...(item.tourId ? { "data-tour": item.tourId } : {})}
            >
              {icon}
              <AnimatePresence>
                <motion.span
                  key="label"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  className="contents"
                >
                  {label}
                  {trailing}
                </motion.span>
              </AnimatePresence>
              {dot}
            </Link>
            <button
              type="button"
              className={cn(
                "flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted transition-colors",
                "hover:bg-white/[0.06] hover:text-sidebar-foreground",
                isActive && "text-white/90"
              )}
              aria-expanded={isNavGroupOpen(item)}
              aria-label={isNavGroupOpen(item) ? `Collapse ${item.title}` : `Expand ${item.title}`}
              onClick={(e) => {
                e.preventDefault();
                toggleNavGroup(item);
              }}
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                  isNavGroupOpen(item) && "rotate-180"
                )}
              />
            </button>
          </div>
        ) : (
          <Link
            href={item.path}
            onClick={(e) => {
              if (isDemoUser && item.path === "/dashboard") {
                e.preventDefault();
                clearDemoUser();
                router.push("/login");
                onMobileClose?.();
              } else {
                onMobileClose?.();
              }
            }}
            className={itemCls}
            {...(item.tourId ? { "data-tour": item.tourId } : {})}
          >
            {icon}
            <AnimatePresence>
              {!isCollapsed && (
                <motion.span
                  key="label"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  className="contents"
                >
                  {label}
                  {trailing}
                </motion.span>
              )}
            </AnimatePresence>
            {dot}
          </Link>
        )}

        {hasChildren && !isCollapsed && isNavGroupOpen(item) && subList()}
      </li>
    );
  };

  return (
    <>
      {!isDesktop && isMobileOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/55 z-30 md:hidden backdrop-blur-sm"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <motion.aside
        data-sidebar-root
        initial={false}
        animate={{
          width: isDesktop ? (collapsed ? 72 : 256) : 280,
          x: isDesktop ? 0 : isMobileOpen ? 0 : -300,
        }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        className={cn(
          "h-[100dvh] max-h-[100dvh] min-h-0 flex flex-col fixed left-0 top-0 z-40",
          "bg-sidebar border-r border-sidebar-border",
          !isDesktop && !isMobileOpen ? "pointer-events-none" : "pointer-events-auto",
          "md:pointer-events-auto"
        )}
      >
        {/* Subtle top glow */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none"
        />

        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        <div className="relative h-14 flex items-center px-3 border-b border-sidebar-border flex-shrink-0">
          <Link
            href="/dashboard"
            className={cn(
              "flex items-center min-w-0 overflow-hidden w-full transition-opacity hover:opacity-75",
              isCollapsed ? "justify-center" : "gap-2.5"
            )}
          >
            {isCollapsed ? (
              <Image
                src="/pigeon-mark.png"
                alt="Pigeon"
                width={919}
                height={621}
                sizes="80px"
                className="flex-shrink-0 h-11 w-auto"
                unoptimized
              />
            ) : (
              <>
                <Image
                  src="/pigeon-mark.png"
                  alt=""
                  width={919}
                  height={621}
                  sizes="80px"
                  className="flex-shrink-0 h-12 w-auto"
                  unoptimized
                />
                <span className="text-[1.3rem] font-black tracking-[-0.035em] leading-none text-sidebar-foreground">
                  Pigeon
                </span>
              </>
            )}
          </Link>
        </div>

        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <nav
          ref={navRef}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
            "scrollbar-thin scrollbar-thumb-white/[0.07] scrollbar-track-transparent",
            isCollapsed ? "px-1.5 py-2" : "px-2.5 py-2"
          )}
        >
          {!activation.isLoading && !activation.isComplete && !isCollapsed && (
            <div className="mb-4 rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/55">
                  Setup
                </span>
                <span className="text-[10px] text-sidebar-muted">
                  {activation.completedCount}/{activation.totalSteps}
                </span>
              </div>
              <ul className="space-y-1">
                {activation.steps
                  .filter((step) => !step.completed)
                  .slice(0, 3)
                  .map((step) => (
                    <li key={step.id}>
                      <Link
                        href={step.href}
                        onClick={() => onMobileClose?.()}
                        className="flex h-7 items-center rounded-md px-2 text-[12px] text-sidebar-foreground/75 hover:bg-white/[0.05] hover:text-sidebar-foreground"
                      >
                        {step.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {navSections.map((section, sIdx) => (
            <div key={sIdx} className={sIdx > 0 ? "mt-4" : ""}>
              {/* Section label */}
              <AnimatePresence>
                {section.label && !isCollapsed ? (
                  <motion.div
                    key="label"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-2 mb-1"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/25 select-none">
                      {section.label}
                    </span>
                  </motion.div>
                ) : section.label && isCollapsed ? (
                  <div key="divider" className="flex justify-center mb-2">
                    <span className="w-4 h-px bg-white/[0.08]" />
                  </div>
                ) : null}
              </AnimatePresence>

              <ul className="space-y-[2px]">{section.items.filter(isNavItemVisible).map(renderNavItem)}</ul>
            </div>
          ))}
        </nav>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div
          className={cn(
            "hidden flex-shrink-0 flex-col gap-1 border-t border-sidebar-border md:flex",
            isCollapsed ? "px-1.5 py-2" : "px-2.5 py-2"
          )}
        >
          <Link
            href="/get-started"
            data-tour="sidebar-get-started"
            onClick={() => onMobileClose?.()}
            className={cn(
              "flex items-center gap-2.5 rounded-md transition-all duration-150",
              "text-sidebar-muted hover:bg-white/[0.06] hover:text-sidebar-foreground",
              isCollapsed ? "mx-auto h-9 w-9 justify-center" : "h-8 px-2.5"
            )}
            title="Get started"
          >
            <BookOpen className="h-4 w-4 shrink-0 opacity-80" />
            {!isCollapsed && (
              <span className="text-[12px] font-medium leading-none">Get started</span>
            )}
          </Link>
          <button
            onClick={onToggle}
            className={cn(
              "w-full flex items-center gap-2 rounded-md h-8 px-2 transition-all duration-150",
              "text-sidebar-foreground/30 hover:text-sidebar-foreground/60 hover:bg-white/[0.05]",
              isCollapsed ? "justify-center" : ""
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span className="w-[14px] h-[14px] flex-shrink-0">
              {collapsed ? (
                <ChevronRight className="w-full h-full" strokeWidth={2} />
              ) : (
                <ChevronLeft className="w-full h-full" strokeWidth={2} />
              )}
            </span>
            <AnimatePresence>
              {!isCollapsed && (
                <motion.span
                  key="collapse-label"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  className="text-[12px] font-medium"
                >
                  Collapse
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </motion.aside>
    </>
  );
}