import { Badge } from "@/components/ui/badge";
import { PlanResourceKey, usePlanGate } from "@/hooks/usePlanGate";
import { cn } from "@/lib/utils";
import { Crown, Sparkles, Star, Zap } from "lucide-react";
import { type ComponentType, type SVGProps } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type IconVariant = "crown" | "sparkles" | "star" | "zap" | "none";

/**
 * foil       — pearl-to-gold gradient with a live shimmer sweep (flagship)
 * linen      — matte warm-neutral, elegant and understated
 * outline    — hairline gold border, semi-transparent fill
 * champagne  — soft blush-gold with a gentle ambient pulse
 */
type StyleVariant = "foil" | "linen" | "outline" | "champagne";

interface PremiumBadgeProps {
  /** Feature key used to derive upgrade copy from the plan gate hook. */
  featureKey?: PlanResourceKey;
  /** Label rendered inside the badge. Defaults to "Pro". */
  label?: string;
  /** Additional classes merged on the root element. */
  className?: string;
  /** Icon shown before the label. Defaults to "crown". */
  icon?: IconVariant;
  /** Visual style preset. Defaults to "foil". */
  variant?: StyleVariant;
}

// ─── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<
  Exclude<IconVariant, "none">,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  crown: Crown,
  sparkles: Sparkles,
  star: Star,
  zap: Zap,
};

// ─── Variant tokens ───────────────────────────────────────────────────────────

/**
 * Each variant is a self-contained token set so the badge never inherits
 * stray Tailwind utilities from the outer Badge shell.
 */
const VARIANTS: Record<
  StyleVariant,
  { badge: string; icon: string; shimmer: boolean; pulse: boolean }
> = {
  /**
   * FOIL — lustrous pearl-gold gradient with a live shimmer sweep.
   * The shimmer is achieved via a CSS pseudo-element injected through
   * an absolutely-positioned <span>; no JS timers required.
   */
  foil: {
    badge: cn(
      // Shape & spacing
      "relative overflow-hidden",
      // Light background: pearl → gold → pearl
      "bg-[linear-gradient(135deg,_#fffef8_0%,_#fef4c8_30%,_#fdedb0_55%,_#fef7d6_80%,_#fffef8_100%)]",
      // Border: subtle warm gold
      "border border-[rgba(215,170,30,0.45)]",
      // Text: deep amber-gold, readable against the pale background
      "text-[#8b6500]",
      // Shadow: top-highlight inset + warm glow underneath
      "shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,_0_-1px_0_rgba(200,155,0,0.15)_inset,_0_1px_4px_rgba(200,155,0,0.12),_0_0_0_1px_rgba(232,168,0,0.08)]",
      "hover:shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,_0_-1px_0_rgba(200,155,0,0.15)_inset,_0_4px_14px_rgba(200,155,0,0.22),_0_0_0_1px_rgba(232,168,0,0.15)]",
    ),
    icon: "text-[#c9930a]",
    shimmer: true,
    pulse: false,
  },

  /**
   * LINEN — matte warm parchment. Restrained, editorial, legible.
   */
  linen: {
    badge: cn(
      "bg-gradient-to-br from-[#faf7f0] to-[#f5f0e4]",
      "border border-[rgba(180,160,110,0.3)]",
      "text-[#6b5a2e]",
      "shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,_0_1px_3px_rgba(0,0,0,0.06)]",
      "hover:shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,_0_2px_8px_rgba(0,0,0,0.08)]",
    ),
    icon: "text-[#a07c30]",
    shimmer: false,
    pulse: false,
  },

  /**
   * OUTLINE — hairline gold border, barely-there fill. Airy and modern.
   */
  outline: {
    badge: cn(
      "bg-[rgba(255,253,245,0.7)] backdrop-blur-[4px]",
      "border-[1.5px] border-[rgba(215,170,30,0.5)]",
      "text-[#9a7200]",
      "shadow-[0_1px_3px_rgba(215,170,30,0.08)]",
      "hover:bg-[rgba(255,249,229,0.85)] hover:border-[rgba(215,170,30,0.7)]",
      "hover:shadow-[0_2px_8px_rgba(215,170,30,0.15)]",
    ),
    icon: "text-[#c9930a]",
    shimmer: false,
    pulse: false,
  },

  /**
   * CHAMPAGNE — soft blush-gold with a slow ambient pulse glow.
   * Use sparingly for highest-tier features you want to catch the eye.
   */
  champagne: {
    badge: cn(
      "bg-gradient-to-br from-[#fffaf0] via-[#fff5e0] to-[#fef0d0]",
      "border border-[rgba(230,185,80,0.4)]",
      "text-[#7a5c00]",
      "shadow-[0_1px_0_rgba(255,255,255,0.95)_inset,_0_2px_6px_rgba(230,185,80,0.15)]",
      "hover:shadow-[0_1px_0_rgba(255,255,255,0.95)_inset,_0_4px_16px_rgba(230,185,80,0.28)]",
    ),
    icon: "text-[#b8860b]",
    shimmer: false,
    pulse: true,
  },
};

// ─── Global keyframes ─────────────────────────────────────────────────────────
//
// Preferred: add these to globals.css instead of injecting at runtime.
//
//   @keyframes pb-shimmer {
//     0%   { transform: translateX(-120%); }
//     55%  { transform: translateX(120%);  }
//     100% { transform: translateX(120%);  }
//   }
//   @keyframes pb-pulse {
//     0%, 100% { box-shadow: 0 0 0 0 rgba(232,168,0,0); }
//     50%       { box-shadow: 0 0 0 3px rgba(232,168,0,0.18); }
//   }
//
// The inline fallback below fires only once per page load if the above is absent.

const KEYFRAMES = `
@keyframes pb-shimmer {
  0%   { transform: translateX(-120%); }
  55%  { transform: translateX(120%);  }
  100% { transform: translateX(120%);  }
}
@keyframes pb-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(232,168,0,0); }
  50%       { box-shadow: 0 0 0 3px rgba(232,168,0,0.18); }
}
`;

let keyframesInjected = false;
function ensureKeyframes() {
  if (keyframesInjected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
  keyframesInjected = true;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PremiumBadge({
  featureKey,
  label = "Pro",
  className,
  icon = "crown",
  variant = "foil",
}: PremiumBadgeProps) {
  // Hooks must be called unconditionally; guard the resolved value instead.
  const gate = usePlanGate(featureKey as PlanResourceKey);
  const resolvedGate = featureKey ? gate : null;

  const title = resolvedGate?.planName
    ? `${label} • Upgrade from ${resolvedGate.planName} to unlock more ${resolvedGate.label}.`
    : resolvedGate?.upgradeLine
    ? `${label} • ${resolvedGate.upgradeLine}`
    : label;

  const tokens = VARIANTS[variant];
  const IconComponent = icon !== "none" ? ICON_MAP[icon] : null;

  if (tokens.shimmer || tokens.pulse) ensureKeyframes();

  return (
    <Badge
      variant="outline"
      className={cn(
        // ── Base geometry & typography ──────────────────────────────────
        "inline-flex items-center gap-1",
        "rounded-md px-2 py-0.5",
        "text-[10px] font-semibold uppercase tracking-widest",
        "select-none whitespace-nowrap",
        // ── Hover lift ──────────────────────────────────────────────────
        "transition-all duration-200 ease-out hover:scale-[1.06]",
        // ── Variant ─────────────────────────────────────────────────────
        tokens.badge,
        tokens.pulse && "[animation:pb-pulse_3s_ease-in-out_infinite]",
        className,
      )}
      title={title}
      aria-label={title}
    >
      {/* Shimmer sweep — foil variant only */}
      {tokens.shimmer && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit]",
            "bg-[linear-gradient(105deg,_transparent_30%,_rgba(255,255,255,0.55)_50%,_transparent_70%)]",
            "[animation:pb-shimmer_3s_ease-in-out_infinite]",
          )}
        />
      )}

      {IconComponent && (
        <IconComponent
          className={cn("h-2.5 w-2.5 shrink-0", tokens.icon)}
          strokeWidth={2.5}
          aria-hidden
        />
      )}

      <span className="relative z-10">{label}</span>
    </Badge>
  );
}