"use client";

import { useState, useRef, useEffect } from "react";
import type { MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, LayoutDashboard, Send, Flame, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

import {
  IFRAME_START_TOUR_MESSAGE,
  IFRAME_TOUR_DONE_MESSAGE,
  IFRAME_PATH_MESSAGE,
  IFRAME_GOTO_DASHBOARD_MESSAGE,
} from "@/lib/demo";

// ─── Config ───────────────────────────────────────────────────────────────────

const DEMO_IFRAME_SRC = "/dashboard?demo=1";
const DEMO_LOCK_DASHBOARD_MS = 5000;
const DEMO_STORAGE_KEY = "demo_mode";

// ─── Data ─────────────────────────────────────────────────────────────────────

const DEMO_FEATURES = [
  {
    icon: Flame,
    title: "Warmup Dashboard",
    desc: "Live health score and real inbox activity",
  },
  {
    icon: Send,
    title: "Campaign Overview",
    desc: "Sends, opens, replies tracked in real-time",
  },
  {
    icon: LayoutDashboard,
    title: "Deliverability Hub",
    desc: "Provider placement, blacklists, auth status",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function InteractiveDemoSection() {
  const router = useRouter();
  const { isAuthenticated, refetchUser } = useAuth();
  const [showFrame, setShowFrame] = useState(false);
  const [isPreparingDemo, setIsPreparingDemo] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeSrcRef = useRef<string>(DEMO_IFRAME_SRC);
  const lockToDashboardUntilRef = useRef<number>(0);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === IFRAME_TOUR_DONE_MESSAGE) {
        router.push("/login");
        return;
      }
      if (event.data?.type === IFRAME_PATH_MESSAGE) {
        const path = event.data?.path;
        const now = Date.now();
        if (
          typeof path === "string" &&
          path !== "/dashboard" &&
          now < lockToDashboardUntilRef.current
        ) {
          const win = iframeRef.current?.contentWindow;
          if (win) {
            win.postMessage({ type: IFRAME_GOTO_DASHBOARD_MESSAGE }, window.location.origin);
          }
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [router]);

  const handlePlayClick = async () => {
    if (!isAuthenticated && typeof window !== "undefined") {
      setIsPreparingDemo(true);
      try {
        window.sessionStorage.setItem(DEMO_STORAGE_KEY, "1");
        const res = await fetch("/api/demo/me", { credentials: "include" });
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (data?.id !== "demo-user") { setIsPreparingDemo(false); return; }
        await refetchUser();
        await new Promise((r) => setTimeout(r, 150));
        const recheck = await fetch("/api/demo/me", { credentials: "include" });
        const recheckData = recheck.ok ? await recheck.json().catch(() => null) : null;
        if (recheckData?.id !== "demo-user") { setIsPreparingDemo(false); return; }
      } catch {
        setIsPreparingDemo(false);
        return;
      }
    }
    iframeSrcRef.current = DEMO_IFRAME_SRC;
    lockToDashboardUntilRef.current = Date.now() + DEMO_LOCK_DASHBOARD_MS;
    setShowFrame(true);
    setIsPreparingDemo(false);
  };

  const handleIframeLoad = () => {
    lockToDashboardUntilRef.current = Date.now() + DEMO_LOCK_DASHBOARD_MS;
    const sendStart = () => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: IFRAME_START_TOUR_MESSAGE },
        window.location.origin
      );
    };
    sendStart();
    setTimeout(sendStart, 400);
  };

  const handleScrollToDemo = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document
      .getElementById("interactive-demo-iframe-container")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section
      id="interactive-demo"
      className="py-16 lg:py-20 marketing-band-subtle border-y border-border/50"
      aria-labelledby="interactive-demo-heading"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">

        {/* ── Section header ── */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/8 border border-primary/20 text-primary text-xs font-semibold mb-5">
            <Play className="w-3 h-3 fill-primary" />
            Interactive demo
          </div>
          <h2
            id="interactive-demo-heading"
            className="text-3xl sm:text-4xl font-black tracking-tight text-foreground mb-3 leading-tight"
          >
            See Pigeon in action —
            <span className="block mt-0.5 bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              no signup needed.
            </span>
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed font-medium">
            A guided 2-minute walkthrough of the live dashboard. Click a section, explore freely.
          </p>
        </div>

        {/* ── What you'll see — 3 feature pills ── */}
        <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mb-10">
          {DEMO_FEATURES.map((feat, i) => {
            const Icon = feat.icon;
            return (
              <div
                key={i}
                className="flex flex-col items-center text-center gap-2.5 px-4 py-4 rounded-2xl border border-border bg-card hover:border-primary/20 transition-colors duration-200"
              >
                <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
                  <Icon className="w-4.5 h-4.5 text-primary" style={{ width: 18, height: 18 }} />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground leading-snug mb-0.5">{feat.title}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">{feat.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── CTA buttons (pre-iframe) ── */}
        {!showFrame && (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
            <Link
              href="#interactive-demo-iframe-container"
              onClick={handleScrollToDemo}
              className="group"
            >
              <Button
                size="lg"
                className="gradient-primary px-8 py-5 h-auto font-bold rounded-2xl shadow-md shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.02] transition-all duration-200 cursor-pointer gap-2"
              >
                <Play className="w-4 h-4 fill-white" />
                {isAuthenticated ? "Launch interactive demo" : "Try interactive demo — free"}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Button>
            </Link>
            {!isAuthenticated && (
              <Button
                size="lg"
                variant="outline"
                className="px-8 py-5 h-auto font-semibold rounded-2xl border-border hover:bg-muted/50 transition-all duration-200 cursor-pointer"
                asChild
              >
                <Link href="/contact">Talk to us</Link>
              </Button>
            )}
          </div>
        )}

        {/* ── Demo iframe container ── */}
        <div
          className="relative isolate"
          style={{ overscrollBehavior: "contain", contain: "layout style paint" }}
          id="interactive-demo-iframe-container"
        >
          {/* Ambient glow */}
          <div
            className="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] blur-2xl opacity-60"
            style={{
              background:
                "radial-gradient(ellipse, hsl(var(--primary) / 0.1) 0%, transparent 70%)",
            }}
            aria-hidden
          />

          {/* Window chrome frame */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-foreground/[0.06] ring-1 ring-foreground/[0.04]">

            {/* Browser bar */}
            <div className="flex h-10 items-center gap-2 border-b border-border/70 bg-muted/30 px-4">
              <div className="flex gap-1.5" aria-hidden>
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
              </div>
              <div className="ml-3 flex h-6 flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-3">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                <span className="text-[11px] text-muted-foreground/70 font-medium truncate">
                  app.pigeon.com/dashboard
                </span>
              </div>
              <div className="ml-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse block" aria-hidden />
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Live demo</span>
              </div>
            </div>

            {/* Content area */}
            <div className="relative aspect-[16/9] w-full bg-background min-h-[600px]">
              {showFrame ? (
                <iframe
                  ref={iframeRef}
                  src={DEMO_IFRAME_SRC}
                  title="Pigeon Interactive Product Tour"
                  className="h-full w-full min-h-[600px]"
                  allow="clipboard-read; clipboard-write; fullscreen; autoplay"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  onLoad={handleIframeLoad}
                />
              ) : (
                /* ── Play overlay ── */
                <div
                  className={`absolute inset-0 flex items-center justify-center overflow-hidden group ${
                    isPreparingDemo ? "cursor-wait" : "cursor-pointer"
                  }`}
                  onClick={isPreparingDemo ? undefined : handlePlayClick}
                  onKeyDown={(e) => !isPreparingDemo && e.key === "Enter" && handlePlayClick()}
                  role="button"
                  tabIndex={0}
                  aria-label="Start interactive demo"
                  aria-busy={isPreparingDemo}
                >
                  {/* Background image + overlay */}
                  <div className="absolute inset-0" aria-hidden>
                    <div className="h-full w-full bg-[url('/bg-interactive.png')] bg-cover bg-center" />
                    <div className="absolute inset-0 bg-background/85 dark:bg-background/90 backdrop-blur-md" />
                    {/* Subtle dot grid on top */}
                    <div
                      className="absolute inset-0 opacity-[0.025]"
                      style={{
                        backgroundImage:
                          "radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)",
                        backgroundSize: "28px 28px",
                      }}
                    />
                  </div>

                  {/* Overlay content */}
                  <div className="relative z-10 flex flex-col items-center gap-7 px-6 text-center sm:px-12">
                    {isPreparingDemo ? (
                      /* Loading state */
                      <>
                        <div className="inline-flex items-center gap-2 rounded-full bg-primary/12 px-4 py-2 text-xs font-semibold text-primary border border-primary/20">
                          Setting up your demo session…
                        </div>
                        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                        <p className="text-sm text-muted-foreground font-medium">
                          This takes just a second.
                        </p>
                      </>
                    ) : (
                      /* Default play state */
                      <>
                        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary border border-primary/20">
                          Guided · 2-minute product tour · No signup
                        </div>

                        <div className="space-y-2.5 max-w-lg">
                          <p className="text-2xl sm:text-3xl font-black tracking-tight text-foreground leading-tight">
                            See how Pigeon warms up your inbox with real people
                          </p>
                          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed font-medium">
                            Walk through the warmup dashboard, deliverability insights, and campaign view — live, in the actual product.
                          </p>
                        </div>

                        {/* Play button */}
                        <div className="flex flex-col items-center gap-3">
                          <div className="relative">
                            <div
                              className="absolute inset-0 rounded-full blur-xl opacity-50 group-hover:opacity-75 transition-opacity duration-300"
                              style={{ background: "hsl(var(--primary) / 0.35)" }}
                              aria-hidden
                            />
                            <div className="relative w-20 h-20 rounded-full bg-primary flex items-center justify-center shadow-xl ring-4 ring-primary/20 group-hover:scale-110 group-hover:ring-primary/35 transition-all duration-200">
                              <Play className="w-9 h-9 text-white fill-white ml-1" />
                            </div>
                          </div>
                          <span className="text-sm font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
                            Click to launch the tour
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom note */}
        <p className="text-center text-xs text-muted-foreground mt-5 font-medium">
          No account needed. Explore the product freely in under 2 minutes.
        </p>
      </div>
    </section>
  );
}
