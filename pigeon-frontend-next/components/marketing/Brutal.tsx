import type { ReactNode } from "react";

/**
 * Soft-brutalist primitives — marketing pages only.
 * Thick borders + solid offset shadows (brutalist structure) with generous
 * rounded corners and pastel surfaces (the "soft" half). The authenticated app
 * keeps the default styling.
 */

export const SB_SHADOW = "shadow-[6px_6px_0_0_hsl(var(--foreground))]";
export const SB_SHADOW_SM = "shadow-[4px_4px_0_0_hsl(var(--foreground))]";
export const SB_PRESS =
  "transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]";

export const PASTELS = ["peach", "mint", "lilac", "butter"] as const;
export type Pastel = (typeof PASTELS)[number];

export function pastelBg(p: Pastel) {
  return `bg-[hsl(var(--sb-${p}))]`;
}

export function Slab({
  children,
  className = "",
  pastel,
}: {
  children: ReactNode;
  className?: string;
  pastel?: Pastel;
}) {
  return (
    <div
      className={`rounded-3xl border-[3px] border-foreground ${
        pastel ? pastelBg(pastel) : "bg-card"
      } ${SB_SHADOW} ${className}`}
    >
      {children}
    </div>
  );
}

export function Chip({ children, pastel = "butter" }: { children: ReactNode; pastel?: Pastel }) {
  return (
    <span
      className={`inline-block rounded-full border-[3px] border-foreground ${pastelBg(
        pastel
      )} px-4 py-1.5 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-foreground`}
    >
      {children}
    </span>
  );
}

export function SbButton({
  href,
  children,
  variant = "accent",
  external = false,
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "accent" | "plain" | "invert";
  external?: boolean;
  className?: string;
}) {
  const variants = {
    accent: "bg-primary text-primary-foreground",
    plain: "bg-card text-foreground",
    invert: "bg-foreground text-background",
  } as const;
  const props = external ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <a
      href={href}
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border-[3px] border-foreground px-7 py-3.5 font-display text-[14px] font-bold ${variants[variant]} ${SB_SHADOW} ${SB_PRESS} ${className}`}
    >
      {children}
    </a>
  );
}
