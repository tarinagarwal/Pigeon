"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { productTourSteps, PRODUCT_TOUR_STORAGE_KEY } from "@/lib/productTourSteps";
import { DEMO_TOUR_COMPLETE_EVENT } from "@/contexts/AuthContext";
import { IFRAME_START_TOUR_MESSAGE, IFRAME_TOUR_DONE_MESSAGE } from "@/lib/demo";

interface ProductTourContextValue {
  startTour: () => void;
  /** Current 0-based step index while tour is running; null when not running */
  tourStepIndex: number | null;
}

const ProductTourContext = createContext<ProductTourContextValue | null>(null);

export function useProductTour() {
  const ctx = useContext(ProductTourContext);
  if (!ctx) return { startTour: () => {}, tourStepIndex: null };
  return ctx;
}

const TOUR_STORAGE_KEY = PRODUCT_TOUR_STORAGE_KEY;

const SPINNER_HTML =
  '<span class="driver-popover-spinner" role="status" aria-hidden="true"></span>';

function setNextButtonLoading(loading: boolean, label = "") {
  const btn = document.querySelector<HTMLButtonElement>(
    ".product-tour-popover .driver-popover-next-btn, .driver-popover .driver-popover-next-btn"
  );
  if (!btn) return;
  if (loading) {
    btn.setAttribute("disabled", "");
    btn.classList.add("driver-popover-btn-loading");
    btn.innerHTML = SPINNER_HTML + label;
  } else {
    btn.removeAttribute("disabled");
    btn.classList.remove("driver-popover-btn-loading");
    btn.textContent = "Next";
  }
}

function setPrevButtonLoading(loading: boolean, label = "") {
  const btn = document.querySelector<HTMLButtonElement>(
    ".product-tour-popover .driver-popover-prev-btn, .driver-popover .driver-popover-prev-btn"
  );
  if (!btn) return;
  if (loading) {
    btn.setAttribute("disabled", "");
    btn.classList.add("driver-popover-btn-loading");
    btn.innerHTML = SPINNER_HTML + label;
  } else {
    btn.removeAttribute("disabled");
    btn.classList.remove("driver-popover-btn-loading");
    btn.textContent = "Previous";
  }
}

function setTourLoading(loading: boolean) {
  const popover = document.querySelector(".driver-popover, .product-tour-popover");
  if (popover) {
    if (loading) {
      popover.classList.add("driver-popover-loading");
    } else {
      popover.classList.remove("driver-popover-loading");
    }
  }
}

export function ProductTourProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState<number | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const driverRef = useRef<Driver | null>(null);
  const lastStepIndexRef = useRef<number>(0);
  const isDemoRef = useRef(false);
  const isLoadingRef = useRef(false);

  const startTour = useCallback(() => {
    setRunning(true);
  }, []);

  // Start tour when URL has startTour=1 (e.g. from landing "Try interactive demo" button - full page)
  useEffect(() => {
    if (pathname !== "/dashboard") return;
    const startParam = searchParams?.get("startTour");
    if (startParam !== "1") return;
    // Skip auto-start when in iframe; iframe tour starts via postMessage when user clicks Play
    if (typeof window !== "undefined" && window.self !== window.top) return;
    isDemoRef.current = searchParams?.get("demo") === "1";
    setRunning(true);
    router.replace("/dashboard", { scroll: false });
  }, [pathname, searchParams, router]);

  // When in iframe with demo=1, listen for Play click from parent to start tour
  useEffect(() => {
    if (typeof window === "undefined" || window.self === window.top) return;
    if (pathname !== "/dashboard") return;
    const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";
    if (!isDemo) return;

    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === IFRAME_START_TOUR_MESSAGE) {
        isDemoRef.current = true;
        setRunning(true);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [pathname]);

  // When running becomes true, start the driver.js tour
  useEffect(() => {
    if (!running) return;

    // When tour runs inside an iframe (e.g. interactive demo on landing), driver.js's
    // scrollIntoView can scroll the parent page. Patch scrollIntoView to preserve parent scroll.
    const inIframe = typeof window !== "undefined" && window.self !== window.top;
    let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView | null = null;

    if (inIframe && typeof HTMLElement !== "undefined") {
      originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
      HTMLElement.prototype.scrollIntoView = function (
        this: HTMLElement,
        arg?: boolean | ScrollIntoViewOptions
      ) {
        try {
          const parent = window.top;
          if (parent && parent !== window) {
            const savedScrollY = parent.scrollY ?? parent.document.documentElement.scrollTop;
            const savedScrollX = parent.scrollX ?? parent.document.documentElement.scrollLeft;
            originalScrollIntoView!.call(this, arg);
            // Restore parent scroll after browser processes scrollIntoView
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                try {
                  parent.scrollTo(savedScrollX, savedScrollY);
                } catch {
                  // ignore cross-origin
                }
              });
            });
          } else {
            originalScrollIntoView!.call(this, arg);
          }
        } catch {
          originalScrollIntoView!.call(this, arg);
        }
      };
    }

    const navigationMap: Record<number, string> = {
      // Route changes between major sections.
      // Indices are 0-based positions in productTourSteps.
      //
      // 0–7: Dashboard (welcome + dashboard cards)
      8: "/campaigns", // sidebar-campaigns → campaigns page (next step highlights create button)
      9: "/campaigns/new", // campaigns create → new campaign wizard (tabs walkthrough)
      //
      // 10–16: /campaigns/new (wizard tabs)
      16: "/inbox/campaign-replies", // after Review tab → inbox overview
      17: "/templates", // inbox → templates (list + add)
      19: "/templates/examples", // templates add → examples (Variables & Spintax)
      //
      // 20–21: /templates/examples (variables + spintax)
      21: "/contacts", // templates examples → contacts (sidebar + status card + import CTA)
      //
      // 22–24: /contacts
      24: "/contacts/import", // contacts import CTA → import wizard (3-step flow)
      //
      // 25: /contacts/import
      25: "/analytics", // import wizard → analytics
      //
      // 26–27: /analytics
      27: "/tracking", // analytics overview → sending behavior
      //
      // 28–29: /tracking
      29: "/domains", // sending behavior insights → domains
      //
      // 30–31: /domains
      31: "/inboxes", // after Add Domain step → inboxes list
      //
      // 32: /inboxes (Inbox Accounts step)
      32: "/warmup", // Inbox Accounts → Warmup page (step 33)
    };

    // Compute which route each step is expected to live on so that both
    // "Next" and "Previous" can keep the tour steps and pages in sync.
    const routeForStep: Record<number, string> = {};

    // Step 0 always starts on the dashboard.
    routeForStep[0] = "/dashboard";

    // For each navigationMap entry, the *next* step after the index lives
    // on the mapped route.
    Object.entries(navigationMap).forEach(([fromIdx, route]) => {
      const nextIdx = Number(fromIdx) + 1;
      routeForStep[nextIdx] = route;
    });

    // Fill in gaps so that every step inherits the previous step's route,
    // giving us contiguous segments across the whole tour.
    for (let i = 1; i < productTourSteps.length; i += 1) {
      if (!routeForStep[i]) {
        routeForStep[i] = routeForStep[i - 1];
      }
    }

    setTourStepIndex(0);

    // Block keyboard arrows when loading (waiting for page navigation)
    const handleKeydown = (e: KeyboardEvent) => {
      if (!isLoadingRef.current) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", handleKeydown, true);

    const isDemo =
      isDemoRef.current ||
      (typeof window !== "undefined" && window.self !== window.top) ||
      (typeof window !== "undefined" &&
        typeof URLSearchParams !== "undefined" &&
        new URLSearchParams(window.location.search).get("demo") === "1");
    driverRef.current = driver({
      showProgress: true,
      steps: productTourSteps,
      nextBtnText: "Next",
      prevBtnText: "Previous",
      doneBtnText: "Done",
      progressText: "{{current}} of {{total}}",
      popoverClass: "product-tour-popover",
      // For demo users, prevent closing the tour by clicking outside
      // the popover so they complete the full guided flow.
      allowClose: !isDemo,
      showButtons: isDemo ? ["next", "previous"] : ["next", "previous", "close"],
      onPopoverRender: isDemo
        ? (popover, options) => {
            if (popover.closeButton) {
              popover.closeButton.style.display = "none";
            }
            const idx = options.state?.activeIndex ?? 0;
            const isLastStep = idx === productTourSteps.length - 1;
            if (isLastStep && popover.nextButton) {
              popover.nextButton.style.display = "none";
            }
          }
        : undefined,
      onHighlightStarted: (_element, _step, options) => {
        const idx = options.state.activeIndex;
        if (typeof idx === "number") {
          lastStepIndexRef.current = idx;
          setTourStepIndex(idx);

          // Proactively prefetch the next 2–3 pages in the tour so that
          // upcoming route changes are already compiled/loaded.
          if (typeof router.prefetch === "function") {
            const PREFETCH_STEPS_AHEAD = 3;
            const currentRoute = routeForStep[idx];

            for (let offset = 1; offset <= PREFETCH_STEPS_AHEAD; offset += 1) {
              const nextIdx = idx + offset;
              const nextRoute = routeForStep[nextIdx];
              if (!nextRoute || nextRoute === currentRoute) continue;
              try {
                router.prefetch(nextRoute);
              } catch {
                // ignore – push will still work even if prefetch fails
              }
            }
          }
        }
      },
      onNextClick: (_element, _step, options) => {
        const idx = options.state.activeIndex ?? 0;
        const currentRoute = routeForStep[idx];
        const nextStepIndex = idx + 1;
        const nextRoute = routeForStep[nextStepIndex];

        // If moving to the next step requires a route change, prefetch & navigate first,
        // wait for the next step's element to exist, then advance the tour.
        if (nextRoute && nextRoute !== currentRoute) {
          isLoadingRef.current = true;
          setTourLoading(true);
          setNextButtonLoading(true);

          // Best effort prefetch so the new page is compiled/loaded before push.
          if (typeof router.prefetch === "function") {
            try {
              router.prefetch(nextRoute);
            } catch {
              // ignore – push will still work even if prefetch fails
            }
          }

          router.push(nextRoute);

          const nextStep = productTourSteps[nextStepIndex];
          const selector =
            nextStep && typeof nextStep.element === "string" ? (nextStep.element as string) : null;

          if (typeof window !== "undefined") {
            // Wait for the new page to load and the target element to exist before advancing.
            const timeoutMs = 10000;
            const pollIntervalMs = 100;
            const settleDelayMs = 400; // Extra delay after element found so React can finish render
            const startTime = Date.now();

            const tryAdvance = () => {
              if (Date.now() - startTime >= timeoutMs) {
                isLoadingRef.current = false;
                setTourLoading(false);
                setNextButtonLoading(false);
                options.driver.moveNext();
                return;
              }
              const pathname = typeof window !== "undefined" ? window.location.pathname : "";
              const onCorrectRoute =
                pathname === nextRoute || pathname.startsWith(nextRoute + "/");
              if (!onCorrectRoute) {
                window.setTimeout(tryAdvance, pollIntervalMs);
                return;
              }
              const el = selector ? document.querySelector(selector) : null;
              const elementReady = selector ? !!el : true;
              if (elementReady) {
                // Page loaded, route changed, and element exists (if any) – wait for components to settle
                window.setTimeout(() => {
                  isLoadingRef.current = false;
                  setTourLoading(false);
                  options.driver.moveNext();
                }, settleDelayMs);
                return;
              }

              window.setTimeout(tryAdvance, pollIntervalMs);
            };

            window.setTimeout(tryAdvance, pollIntervalMs);
            return;
          }
        }

        // Default behavior for steps that stay on the same page (or if window is unavailable).
        options.driver.moveNext();
      },
      onPrevClick: (_element, _step, options) => {
        const idx = options.state.activeIndex ?? 0;
        const currentRoute = routeForStep[idx];
        const prevStepIndex = idx - 1;

        // If there's no previous step, let driver.js handle it normally.
        if (prevStepIndex < 0) {
          options.driver.movePrevious();
          return;
        }

        const prevRoute = routeForStep[prevStepIndex];

        // If moving to the previous step requires a route change, prefetch & navigate first,
        // wait for the previous step's element to exist, then move the tour back.
        if (prevRoute && prevRoute !== currentRoute) {
          isLoadingRef.current = true;
          setTourLoading(true);
          setPrevButtonLoading(true);

          if (typeof router.prefetch === "function") {
            try {
              router.prefetch(prevRoute);
            } catch {
              // ignore – push will still work even if prefetch fails
            }
          }

          router.push(prevRoute);

          const prevStep = productTourSteps[prevStepIndex];
          const selector =
            prevStep && typeof prevStep.element === "string" ? (prevStep.element as string) : null;

          if (typeof window !== "undefined") {
            const timeoutMs = 10000;
            const pollIntervalMs = 100;
            const settleDelayMs = 400;
            const startTime = Date.now();

            const tryGoBack = () => {
              if (Date.now() - startTime >= timeoutMs) {
                isLoadingRef.current = false;
                setTourLoading(false);
                setPrevButtonLoading(false);
                options.driver.movePrevious();
                return;
              }
              const pathname = typeof window !== "undefined" ? window.location.pathname : "";
              const onCorrectRoute =
                pathname === prevRoute || pathname.startsWith(prevRoute + "/");
              if (!onCorrectRoute) {
                window.setTimeout(tryGoBack, pollIntervalMs);
                return;
              }
              const el = selector ? document.querySelector(selector) : null;
              const elementReady = selector ? !!el : true;
              if (elementReady) {
                window.setTimeout(() => {
                  isLoadingRef.current = false;
                  setTourLoading(false);
                  options.driver.movePrevious();
                }, settleDelayMs);
                return;
              }
              window.setTimeout(tryGoBack, pollIntervalMs);
            };

            window.setTimeout(tryGoBack, pollIntervalMs);
            return;
          }
        }

        // Default behavior for steps that stay on the same page (or if window is unavailable).
        options.driver.movePrevious();
      },
      onDestroyStarted: () => {
        const onLastStep =
          lastStepIndexRef.current === productTourSteps.length - 1;
        if (isDemoRef.current && onLastStep) {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent(DEMO_TOUR_COMPLETE_EVENT));
            // When inside iframe (e.g. landing interactive demo), tell parent to go to signup
            // so the main page navigates to signup while the iframe may show login.
            if (window.self !== window.top) {
              window.parent.postMessage(
                { type: IFRAME_TOUR_DONE_MESSAGE },
                window.location.origin
              );
            }
          }
          router.push("/signup");
        }
        setTourStepIndex(null);
        setRunning(false);
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(TOUR_STORAGE_KEY, "true");
          } catch {
            // ignore
          }
        }
      },
    });

    driverRef.current.drive();

    return () => {
      window.removeEventListener("keydown", handleKeydown, true);
      isLoadingRef.current = false;
      driverRef.current?.destroy();
      driverRef.current = null;
      // Restore original scrollIntoView when tour ends
      if (originalScrollIntoView && typeof HTMLElement !== "undefined") {
        HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      }
    };
  }, [running]);

  return (
    <ProductTourContext.Provider value={{ startTour, tourStepIndex }}>
      {children}
    </ProductTourContext.Provider>
  );
}
