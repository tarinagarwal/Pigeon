"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { BLOG_LINKS, blogHref } from "@/lib/blog-links";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Public blog routes are deleted; flip to true if they are ever restored. */
const BLOG_ENABLED = false;

type HelpLinksProps = {
  slugs: string[];
  title?: string;
  variant?: "card" | "inline";
  className?: string;
};

/**
 * Renders a list of blog/guide links for the current page.
 * Use variant="card" for a bordered section, "inline" for a compact line of links.
 */
export function HelpLinks({ slugs, title = "Related guides", variant = "card", className = "" }: HelpLinksProps) {
  // The public /blog routes were removed, so every guide link would 404.
  // Call sites are left in place: restore the blog and delete this line to bring them back.
  if (!BLOG_ENABLED) return null;

  const items = slugs
    .filter((s) => BLOG_LINKS[s])
    .map((slug) => ({ slug, title: BLOG_LINKS[slug], href: blogHref(slug) }));

  if (items.length === 0) return null;

  if (variant === "inline") {
    return (
      <p className={["text-sm text-muted-foreground", className].filter(Boolean).join(" ")}>
        <span className="font-medium text-foreground">Learn more: </span>
        {items.map((item, i) => (
          <span key={item.slug}>
            {i > 0 && ", "}
            <Link href={item.href} className="text-primary hover:underline">
              {item.title}
            </Link>
          </span>
        ))}
      </p>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <BookOpen className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item.slug}>
              <Link href={item.href} className="text-primary hover:underline" target="_blank">
                {item.title}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
