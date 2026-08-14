"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Href = string | { pathname?: string; query?: Record<string, string> };

interface NavLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: Href;
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
  exact?: boolean;
}

function hrefToPath(href: Href): string {
  if (typeof href === "string") return href;
  const path = href.pathname ?? "/";
  const qs = href.query && Object.keys(href.query).length
    ? "?" + new URLSearchParams(href.query).toString()
    : "";
  return path + qs;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  ({ className, activeClassName, pendingClassName, href, exact, ...props }, ref) => {
    const pathname = usePathname();
    const path = hrefToPath(href);
    const pathnameBase = path.split("?")[0];
    const isActive = exact
      ? pathname === pathnameBase
      : pathname === pathnameBase || (pathnameBase !== "/" && pathname.startsWith(pathnameBase));

    return (
      <Link
        ref={ref}
        href={typeof href === "string" ? href : { pathname: href.pathname ?? "/", query: href.query }}
        className={cn(className, isActive && activeClassName)}
        {...props}
      />
    );
  }
);

NavLink.displayName = "NavLink";

export { NavLink };
