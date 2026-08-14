"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Mail,
  Users,
  Globe,
  Inbox,
  FileText,
  BarChart3,
  Bell,
  Zap,
  Settings,
  LogOut,
  Menu,
  X,
  AlertTriangle,
  Server,
  MessageSquare,
  Ticket,
  ShieldCheck,
  BookOpen,
  FileJson,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Banknote,
  ArrowLeftRight,
  KeyRound,
  Webhook,
  Network,
} from "lucide-react";

type AdminLayoutProps = {
  children: React.ReactNode;
};

const navigationItems = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Users", href: "/admin/users", icon: Users },
  { name: "Billing", href: "/admin/billing", icon: CreditCard },
  { name: "Campaigns", href: "/admin/campaigns", icon: Mail },
  { name: "Contacts", href: "/admin/contacts", icon: Users },
  { name: "Contact submissions", href: "/admin/contact-submissions", icon: MessageSquare },
  { name: "Tickets", href: "/admin/tickets", icon: Ticket },
  { name: "Domains", href: "/admin/domains", icon: Globe },
  { name: "Inboxes", href: "/admin/inboxes", icon: Inbox },
  { name: "Templates", href: "/admin/templates", icon: FileText },
  { name: "Blogs", href: "/admin/blogs", icon: BookOpen },
  { name: "Bulk blog upload", href: "/admin/blogs/bulk-upload", icon: FileJson },
  { name: "Emails", href: "/admin/emails", icon: Mail },
  { name: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { name: "Alerts", href: "/admin/alerts", icon: Bell },
];

const automationItems = [
  { name: "Rules", href: "/admin/automation/rules", icon: Zap },
  { name: "Jobs", href: "/admin/automation/jobs", icon: Zap },
];

const warmupItems = [
  { name: "Overview & history", href: "/admin/warmup/overview", icon: BarChart3 },
  { name: "Send History", href: "/admin/warmup/logs", icon: FileText },
  { name: "Close network", href: "/admin/warmup/close-network", icon: Network },
  { name: "Receiver accounts", href: "/admin/warmup/receiver-accounts", icon: Inbox },
];

/** Rent Your Network (RYN) — separate portal; admin API: /api/admin/ryn/… */
const rynItems = [
  { name: "Overview", href: "/admin/ryn", icon: LayoutDashboard, activeMatch: "exact" as const },
  { name: "Users", href: "/admin/ryn/users", icon: Users, activeMatch: "prefix" as const },
  { name: "Listings", href: "/admin/ryn/listings", icon: Mail, activeMatch: "prefix" as const },
  { name: "Transactions", href: "/admin/ryn/transactions", icon: ArrowLeftRight, activeMatch: "exact" as const },
  { name: "Withdrawals", href: "/admin/ryn/withdrawals", icon: Banknote, activeMatch: "exact" as const },
  { name: "OTPs", href: "/admin/ryn/otps", icon: KeyRound, activeMatch: "exact" as const },
];

const systemItems = [
  { name: "Admin management", href: "/admin/admins", icon: ShieldCheck },
  { name: "Plans", href: "/admin/plans", icon: Settings },
  { name: "Config", href: "/admin/system/config", icon: Settings },
  { name: "Infrastructure", href: "/admin/system/infrastructure", icon: Server },
  { name: "Email IP Tracking", href: "/admin/system/email-ip-tracking", icon: BarChart3 },
  { name: "Feature Flags", href: "/admin/system/flags", icon: Settings },
  { name: "Error Logs", href: "/admin/error-logs", icon: AlertTriangle },
  { name: "Billing webhooks", href: "/admin/billing-webhooks", icon: Webhook },
  { name: "Audit Logs", href: "/admin/audit-logs", icon: FileText },
];

function navItemIsActive(pathname: string, href: string, activeMatch?: "exact" | "prefix") {
  if (activeMatch === "prefix") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href;
}

function NavLink({
  href,
  icon: Icon,
  children,
  active,
  onClick,
}: {
  href: string;
  icon: React.ElementType;
  children: React.ReactNode;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? "bg-primary/10 text-primary border-l-2 border-primary ml-0 pl-3 -ml-px"
          : "text-muted-foreground hover:bg-muted hover:text-foreground border-l-2 border-transparent"
      }`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0 opacity-80" />
      <span className="truncate">{children}</span>
    </Link>
  );
}

function NavSection({
  title,
  items,
  pathname,
  isSuperAdmin,
  open,
  onToggle,
}: {
  title: string;
  items: { name: string; href: string; icon: React.ElementType; activeMatch?: "exact" | "prefix" }[];
  pathname: string;
  isSuperAdmin?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const filtered = items.filter((item) => item.href !== "/admin/admins" || isSuperAdmin);
  if (filtered.length === 0) return null;
  const hasActive = filtered.some((item) => navItemIsActive(pathname, item.href, item.activeMatch));
  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span>{title}</span>
        {hasActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 pl-1">
          {filtered.map((item) => (
            <NavLink
              key={item.name}
              href={item.href}
              icon={item.icon}
              active={navItemIsActive(pathname, item.href, item.activeMatch)}
            >
              {item.name}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(true);
  const [warmupOpen, setWarmupOpen] = useState(true);
  const [rynOpen, setRynOpen] = useState(true);
  const [systemOpen, setSystemOpen] = useState(true);

  useEffect(() => {
    // Skip authentication check on login page
    if (pathname === "/admin/login") {
      setLoading(false);
      return;
    }

    // Only run auth check on client (avoid SSR redirect when cookie is not yet available)
    if (typeof window === "undefined") {
      setLoading(false);
      return;
    }

    // Verify admin via cookie (credentials: include)
    const timer = setTimeout(() => {
      async function verifyAdmin() {
        try {
          const res = await adminApi.get<{ email?: string; is_super_admin?: boolean }>("/admin/auth/me");
          setAdminEmail(res.data.email ?? null);
          setIsSuperAdmin(res.data.is_super_admin ?? false);
        } catch (err) {
          console.error("Failed to verify admin", getErrorMessage(err));
          if (!window.location.pathname.startsWith("/admin/login")) {
            router.replace("/admin/login");
          }
        } finally {
          setLoading(false);
        }
      }

      verifyAdmin();
    }, 0);

    return () => clearTimeout(timer);
  }, [pathname, router]);

  const handleLogout = async () => {
    try {
      await adminApi.post("/admin/auth/logout");
    } catch {
      // Cookie may already be cleared or expired
    }
    router.replace("/admin/login");
  };

  const isActive = (href: string) => pathname === href;

  // Breadcrumb: /admin -> "Dashboard", /admin/tickets -> "Tickets"
  const pathSegments = pathname.replace(/^\/admin\/?/, "").split("/").filter(Boolean);
  const breadcrumbLabel = pathSegments.length === 0
    ? "Dashboard"
    : pathSegments.map((s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ")).join(" / ");

  // Auto-expand section when current page is inside it
  useEffect(() => {
    if (pathname.startsWith("/admin/automation")) setAutomationOpen(true);
    if (pathname.startsWith("/admin/warmup")) setWarmupOpen(true);
    if (pathname.startsWith("/admin/ryn")) setRynOpen(true);
    if (pathname.startsWith("/admin/system") || pathname.startsWith("/admin/admins") || pathname.startsWith("/admin/plans") || pathname.startsWith("/admin/error-logs") || pathname.startsWith("/admin/billing-webhooks") || pathname.startsWith("/admin/audit-logs")) setSystemOpen(true);
  }, [pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (pathname === "/admin/login") {
    return <div className="min-h-screen bg-muted/30">{children}</div>;
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[260px] flex flex-col border-r border-border bg-card shadow-sm transition-transform duration-200 ease-out md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <Link
            href="/admin"
            className="flex items-center gap-2.5 min-w-0"
            onClick={() => setSidebarOpen(false)}
          >
            <div className="h-9 w-9 shrink-0 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">ER</span>
            </div>
            <span className="font-semibold text-foreground truncate">Pigeon Admin</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <div className="space-y-0.5">
            {navigationItems.map((item) => (
              <NavLink
                key={item.name}
                href={item.href}
                icon={item.icon}
                active={isActive(item.href)}
                onClick={() => setSidebarOpen(false)}
              >
                {item.name}
              </NavLink>
            ))}
          </div>

          <NavSection
            title="Automation"
            items={automationItems}
            pathname={pathname}
            open={automationOpen}
            onToggle={() => setAutomationOpen((o) => !o)}
          />
          <NavSection
            title="Warmup"
            items={warmupItems}
            pathname={pathname}
            open={warmupOpen}
            onToggle={() => setWarmupOpen((o) => !o)}
          />
          <NavSection
            title="Rent Your Network"
            items={rynItems}
            pathname={pathname}
            open={rynOpen}
            onToggle={() => setRynOpen((o) => !o)}
          />
          <NavSection
            title="System"
            items={systemItems}
            pathname={pathname}
            isSuperAdmin={isSuperAdmin}
            open={systemOpen}
            onToggle={() => setSystemOpen((o) => !o)}
          />
        </nav>
      </aside>

      <div className="flex flex-1 flex-col min-w-0 md:ml-[260px]">
        <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden shrink-0"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <p className="text-sm font-medium text-foreground truncate">{breadcrumbLabel}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {adminEmail && (
                <span className="hidden max-w-[180px] truncate text-sm text-muted-foreground sm:inline">
                  {adminEmail}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

