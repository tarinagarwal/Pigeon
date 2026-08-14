"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { DevsBazaarBar } from "@/components/layout/DevsBazaarBar";

/** Public GitHub repo — open-source home of Pigeon. */
export const GITHUB_URL = "https://github.com/tarinagarwal/Pigeon";

const NAV = [
  { name: "Features", path: "/features" },
  { name: "Pricing", path: "/pricing" },
  { name: "Rent & Earn", path: "/rent" },
  { name: "Contact", path: "/contact" },
];

export const Header = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, user, clearDemoUser } = useAuth();
  const [open, setOpen] = useState(false);

  const isDemoUser = user?.id === "demo-user";
  const isActive = (p: string) => pathname === p || pathname.startsWith(`${p}/`);

  const handleDashboard = (e: React.MouseEvent) => {
    if (isDemoUser) {
      e.preventDefault();
      clearDemoUser();
      router.push("/login");
    }
  };

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  // Bar + nav pin together as one block, so the attribution stays visible on scroll.
  return (
    <div className="sticky top-0 z-50">
      <DevsBazaarBar />
      <header role="banner" className="border-b-[3px] border-foreground bg-[hsl(var(--sb-cream))]">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="group flex items-center gap-2.5" aria-label="Pigeon — home">
            <Image
              src="/pigeon-mark.png"
              alt=""
              width={919}
              height={621}
              sizes="80px"
              priority
              className="h-10 w-auto"
            />
            <span className="font-display text-[1.35rem] font-black leading-none text-foreground">
              Pigeon
            </span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV.map((l) => (
              <Link
                key={l.path}
                href={l.path}
                className={`font-display rounded-full border-[3px] px-4 py-1.5 text-[13px] font-bold transition-none ${
                  isActive(l.path)
                    ? "border-foreground bg-[hsl(var(--sb-butter))] text-foreground"
                    : "border-transparent text-foreground/70 hover:border-foreground hover:text-foreground"
                }`}
              >
                {l.name}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href={isAuthenticated ? "/dashboard" : "/login"}
              onClick={isAuthenticated ? handleDashboard : undefined}
              className="font-display hidden rounded-2xl border-[3px] border-foreground bg-primary px-5 py-2.5 text-[13px] font-bold text-primary-foreground shadow-[4px_4px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))] sm:block"
            >
              {isAuthenticated ? "Dashboard" : "Sign in"}
            </Link>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? "Close menu" : "Open menu"}
              className="flex h-11 w-11 flex-col items-center justify-center gap-[6px] rounded-xl border-[3px] border-foreground bg-card md:hidden"
            >
              <span
                className={`block h-[3px] w-5 rounded-full bg-foreground transition-transform duration-150 ${
                  open ? "translate-y-[4.5px] rotate-45" : ""
                }`}
              />
              <span
                className={`block h-[3px] w-5 rounded-full bg-foreground transition-transform duration-150 ${
                  open ? "-translate-y-[4.5px] -rotate-45" : ""
                }`}
              />
            </button>
          </div>
        </div>
      </header>

      {/* top-full anchors the panel to the bottom of the sticky block, so it stays
          correct even when the attribution bar wraps to two lines on small screens. */}
      {open && (
        <div className="absolute inset-x-0 top-full z-40 h-[calc(100vh-100%)] overflow-y-auto bg-[hsl(var(--sb-cream))] md:hidden">
          <nav className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
            {NAV.map((l, i) => (
              <Link
                key={l.path}
                href={l.path}
                className="mb-3 flex items-baseline gap-4 rounded-2xl border-[3px] border-foreground bg-card px-5 py-4 shadow-[4px_4px_0_0_hsl(var(--foreground))]"
              >
                <span className="font-mono text-[12px] font-bold tabular-nums text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-display text-2xl font-black text-foreground">
                  {l.name}
                </span>
              </Link>
            ))}
            <Link
              href={isAuthenticated ? "/dashboard" : "/login"}
              onClick={isAuthenticated ? handleDashboard : undefined}
              className="font-display mt-6 block rounded-2xl border-[3px] border-foreground bg-primary px-4 py-3.5 text-center text-[14px] font-bold text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))]"
            >
              {isAuthenticated ? "Dashboard" : "Sign in"}
            </Link>
            <Link
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display mt-3 block rounded-2xl border-[3px] border-foreground bg-card px-4 py-3.5 text-center text-[14px] font-bold text-foreground"
            >
              GitHub ↗
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
};
