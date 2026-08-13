import Link from "next/link";
import Image from "next/image";
import { GITHUB_URL } from "@/components/layout/Header";

const LINKS = [
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Rent & Earn", href: "/rent" },
  { label: "Contact", href: "/contact" },
];

export const Footer = () => {
  return (
    <footer className="border-t-[3px] border-foreground bg-background">
      {/* Loud closing band */}
      <div className="border-b-[3px] border-foreground bg-[hsl(var(--sb-peach))] text-foreground">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p className="font-display max-w-xl text-2xl font-black leading-[1.08] sm:text-3xl">
            Accounts are set up by us. Tell us what you need.
          </p>
          <Link
            href="/contact"
            className="font-display inline-flex shrink-0 items-center justify-center rounded-2xl border-[3px] border-foreground bg-primary px-7 py-3.5 text-[15px] font-bold text-primary-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]"
          >
            Talk to us →
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <Image
                src="/pigeon-mark.png"
                alt=""
                width={919}
                height={621}
                sizes="80px"
                className="h-10 w-auto"
                unoptimized
              />
              <span className="font-display text-[1.35rem] font-black leading-none text-foreground">
                Pigeon
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-[13.5px] leading-relaxed text-foreground/60">
              Open-source cold email &amp; deliverability. MIT licensed.
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-6 gap-y-3">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="font-display text-[14px] font-bold text-foreground underline-offset-4 hover:underline"
              >
                {l.label}
              </Link>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display text-[14px] font-bold text-foreground underline-offset-4 hover:underline"
            >
              GitHub ↗
            </a>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t-[3px] border-foreground pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-foreground/60">
            © {new Date().getFullYear()} Pigeon
          </p>
        </div>
      </div>
    </footer>
  );
};
