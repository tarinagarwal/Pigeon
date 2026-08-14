"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Mail,
  Activity,
  Coins,
  Lock,
  LogOut,
  BookOpen,
  Banknote,
  ExternalLink,
} from "lucide-react";
import { useRYN } from "@/contexts/RYNContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/rent/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/rent/emails", label: "My Emails", icon: Mail },
  { href: "/rent/activity", label: "Activity", icon: Activity },
  { href: "/rent/credits", label: "Credits & Guide", icon: BookOpen },
  { href: "/rent/withdraw", label: "Withdrawals", icon: Banknote },
];

/** Cross-link back to the main product — rendered below a divider. */
const externalNav = [{ href: "/", label: "Pigeon", icon: ExternalLink }];

export default function RYNShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useRYN();
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[hsl(var(--sb-cream))] flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r-[3px] border-foreground bg-card flex flex-col">
        {/* Logo */}
        <div className="h-[72px] flex items-center gap-2.5 px-5 border-b-[3px] border-foreground">
          <Image
            src="/rent-mark.png"
            alt=""
            width={1129}
            height={957}
            sizes="64px"
            className="h-10 w-auto shrink-0"
          />
          <span className="font-black text-[0.98rem] leading-none tracking-[-0.03em]">
            Rent&nbsp;&amp;&nbsp;Earn
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                pathname === href
                  ? "border-[3px] border-foreground bg-[hsl(var(--sb-peach))] text-foreground font-bold"
                  : "border-[3px] border-transparent text-muted-foreground hover:border-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          ))}

          <div className="my-3 h-[2px] rounded-full bg-border" />

          {externalNav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Credits chip + logout */}
        <div className="px-4 py-4 border-t-[3px] border-foreground space-y-3">
          <Link href="/rent/credits" className="flex items-center gap-2 px-3 py-2.5 rounded-2xl border-[3px] border-foreground bg-[hsl(var(--sb-butter))] shadow-[4px_4px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]">
            <Coins className="w-4 h-4 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Available</p>
              <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                {user?.credits_balance ?? 0}
              </p>
              {(user?.credits_held ?? 0) > 0 && (
                <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                  <Lock className="w-2.5 h-2.5" />{user!.credits_held} held
                </p>
              )}
            </div>
          </Link>
          <div className="px-1">
            <p className="text-xs font-medium text-foreground truncate">{user?.full_name}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={logout}
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
