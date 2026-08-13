"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { trackCtaClick, type CtaClickLabel } from "@/lib/marketingAnalytics";

const DEFAULT_PRIMARY = { href: "/contact", label: "Talk to us" };
const DEFAULT_SECONDARY = { href: "/features", label: "See all features" };

type CtaConfig = {
  href: string;
  label: string;
};

type MarketingCtaButtonsProps = {
  primary?: CtaConfig;
  secondary?: CtaConfig;
  layout?: "row" | "stack";
  size?: "sm" | "md" | "lg";
  align?: "center" | "start" | "end";
  className?: string;
  showSecondary?: boolean;
  trackLabels?: {
    primary?: CtaClickLabel;
    secondary?: CtaClickLabel;
  };
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
  variant?: "default" | "on-dark";
};

const sizeClasses = {
  sm: {
    primary: "px-5 py-2.5 text-sm rounded-xl",
    secondary: "px-5 py-2.5 text-sm rounded-xl",
    icon: "w-4 h-4",
  },
  md: {
    primary: "px-7 py-3.5 text-sm rounded-xl",
    secondary: "px-7 py-3.5 text-sm rounded-xl",
    icon: "w-4 h-4",
  },
  lg: {
    primary: "px-8 py-4 text-base rounded-2xl",
    secondary: "px-8 py-4 text-base rounded-2xl",
    icon: "w-5 h-5",
  },
} as const;

export function MarketingCtaButtons({
  primary = DEFAULT_PRIMARY,
  secondary = DEFAULT_SECONDARY,
  layout = "row",
  size = "md",
  align = "center",
  className,
  showSecondary = true,
  trackLabels,
  onPrimaryClick,
  onSecondaryClick,
  variant = "default",
}: MarketingCtaButtonsProps) {
  const sizes = sizeClasses[size];
  const isOnDark = variant === "on-dark";

  return (
    <div
      className={cn(
        "flex gap-3",
        layout === "row" ? "flex-col sm:flex-row" : "flex-col",
        align === "center" && "items-center justify-center",
        align === "start" && "items-start justify-start",
        align === "end" && "items-end justify-end",
        className
      )}
    >
      <Link
        href={primary.href}
        onClick={() => {
          if (trackLabels?.primary) trackCtaClick(trackLabels.primary);
          onPrimaryClick?.();
        }}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]",
          isOnDark
            ? "bg-white text-primary shadow-lg shadow-black/15 hover:bg-white/95 font-bold"
            : "gradient-primary text-primary-foreground shadow-sm shadow-primary/15 hover:brightness-105",
          sizes.primary
        )}
      >
        {primary.label}
        <ArrowRight className={sizes.icon} />
      </Link>
      {showSecondary && (
        <Link
          href={secondary.href}
          onClick={() => {
            if (trackLabels?.secondary) trackCtaClick(trackLabels.secondary);
            onSecondaryClick?.();
          }}
          className={cn(
            "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200",
            isOnDark
              ? "border border-white/40 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20"
              : "border-2 border-border bg-card text-foreground/90 shadow-sm hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
            sizes.secondary
          )}
        >
          {secondary.label}
        </Link>
      )}
    </div>
  );
}
