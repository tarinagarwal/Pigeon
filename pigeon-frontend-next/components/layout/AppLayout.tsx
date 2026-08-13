"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ProductTourProvider } from "@/contexts/ProductTourContext";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { PaymentFailedBanner } from "./PaymentFailedBanner";
import { cn } from "@/lib/utils";
import { IFRAME_PATH_MESSAGE, IFRAME_GOTO_DASHBOARD_MESSAGE } from "@/lib/demo";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 768;
      setIsDesktop(desktop);
      if (desktop) {
        setMobileSidebarOpen(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /** Single scroll: lock document so only the main region scrolls (avoids double scrollbars with inner overflow-auto). */
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlHeight = html.style.height;
    const prevBodyHeight = body.style.height;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.height = "100%";
    body.style.height = "100%";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      html.style.height = prevHtmlHeight;
      body.style.height = prevBodyHeight;
    };
  }, []);

  // When loaded in iframe or demo=1: mark demo mode (hides tour close button). Iframe also gets scroll isolation.
  useEffect(() => {
    const inIframe = typeof window !== "undefined" && window.self !== window.top;
    const isDemo = searchParams?.get("demo") === "1";
    if (!inIframe && !isDemo) return;
    document.body.classList.add("demo-mode");
    const html = document.documentElement;
    const body = document.body;
    let prevHtml = "";
    let prevBody = "";
    if (inIframe) {
      prevHtml = html.style.overscrollBehavior;
      prevBody = body.style.overscrollBehavior;
      html.style.overscrollBehavior = "contain";
      body.style.overscrollBehavior = "contain";
    }
    return () => {
      document.body.classList.remove("demo-mode");
      if (inIframe) {
        html.style.overscrollBehavior = prevHtml;
        body.style.overscrollBehavior = prevBody;
      }
    };
  }, [searchParams]);

  // When in demo iframe: report path to parent so it can enforce dashboard for initial 5s; listen for goto-dashboard.
  useEffect(() => {
    const inIframe = typeof window !== "undefined" && window.self !== window.top;
    const isDemo = searchParams?.get("demo") === "1";
    if (!inIframe || !isDemo || typeof pathname !== "string") return;

    const parent = window.top;
    if (!parent || parent === window) return;

    parent.postMessage(
      { type: IFRAME_PATH_MESSAGE, path: pathname },
      window.location.origin
    );

    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === IFRAME_GOTO_DASHBOARD_MESSAGE) {
        router.replace("/dashboard?demo=1");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [pathname, searchParams, router]);

  const isAiCampaignStudio = pathname?.includes("/ai-campaign-studio") ?? false;
  const sidebarOffset = isDesktop ? (sidebarCollapsed ? 72 : 256) : 0;

  return (
    <ProductTourProvider>
      <div className="flex h-[100dvh] min-h-0 max-h-[100dvh] flex-col overflow-hidden bg-muted/25 dark:bg-background">
        <AppSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          isDesktop={isDesktop}
          isMobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />
        <motion.div
          initial={false}
          animate={{ marginLeft: sidebarOffset }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <TopBar onSidebarToggle={() => setMobileSidebarOpen((prev) => !prev)} />
          <PaymentFailedBanner />
          <main
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              isAiCampaignStudio ? "bg-background" : "bg-background/80"
            )}
          >
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain",
                isAiCampaignStudio ? "p-0" : "p-4 md:p-6 lg:p-8"
              )}
            >
              {children}
            </div>
          </main>
        </motion.div>
      </div>
    </ProductTourProvider>
  );
}
