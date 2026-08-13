"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";

const PLAN_NAMES: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  scale: "Scale",
};

const REACH = [
  { p: "peach", label: "Email", value: "tarinagarwal@gmail.com", href: "mailto:tarinagarwal@gmail.com?subject=Pigeon%20enquiry" },
  { p: "mint", label: "WhatsApp", value: "+91 93520 23583", href: "https://wa.me/919352023583" },
];

function ContactForm() {
  const searchParams = useSearchParams();
  const planId = searchParams.get("plan")?.toLowerCase();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
    company: "",
    phone: "",
  });

  useEffect(() => {
    if (planId && PLAN_NAMES[planId]) {
      setForm((prev) => ({ ...prev, subject: `Inquiry about ${PLAN_NAMES[planId]} plan` }));
    }
  }, [planId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.subject.trim() || !form.message.trim()) {
      toast.error("Please fill in name, email, subject, and message.");
      return;
    }
    setLoading(true);
    try {
      await api.contact.submit({
        name: form.name.trim(),
        email: form.email.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
        company: form.company.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
      import("@/lib/marketingAnalytics").then((m) => m.trackContactSubmit());
      toast.success("Message sent. We'll get back to you shortly.");
      setForm({ name: "", email: "", subject: "", message: "", company: "", phone: "" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const field =
    "w-full rounded-xl border-[3px] border-foreground bg-background px-4 py-3 text-[15px] text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0";
  const label = "font-display mb-1.5 block text-[13px] font-bold text-foreground";

  return (
    <div className="min-h-screen bg-[hsl(var(--sb-cream))]">
      {/* ── Header ── */}
      <section className="border-b-[3px] border-foreground">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-16">
          <span className="font-display inline-block rounded-full border-[3px] border-foreground bg-[hsl(var(--sb-butter))] px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-foreground">
            Get in touch
          </span>
          <h1 className="font-display mt-6 text-[2.8rem] font-black leading-[0.95] text-foreground sm:text-[4rem]">
            Tell us what
            <span className="mt-2 block">
              <span className="inline-block rounded-2xl border-[3px] border-foreground bg-primary px-3 py-0.5 text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))]">
                you need.
              </span>
            </span>
          </h1>
          <p className="mt-7 max-w-xl text-[16.5px] leading-relaxed text-foreground/75">
            Accounts are set up by our team, so this is where it starts. Tell us your sending
            volume and how many mailboxes you run, and we&rsquo;ll come back with a number.
          </p>
        </div>
      </section>

      {/* ── Form + reach ── */}
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_330px] lg:gap-12">
          <form
            onSubmit={handleSubmit}
            className="rounded-3xl border-[3px] border-foreground bg-card p-6 shadow-[8px_8px_0_0_hsl(var(--foreground))] sm:p-8"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className={label}>Name *</label>
                <input id="name" name="name" value={form.name} onChange={handleChange} placeholder="Alex Doe" className={field} required />
              </div>
              <div>
                <label htmlFor="email" className={label}>Email *</label>
                <input id="email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@company.com" className={field} required />
              </div>
              <div>
                <label htmlFor="company" className={label}>Company</label>
                <input id="company" name="company" value={form.company} onChange={handleChange} placeholder="Acme Inc." className={field} />
              </div>
              <div>
                <label htmlFor="phone" className={label}>Phone</label>
                <input id="phone" name="phone" value={form.phone} onChange={handleChange} placeholder="+91 00000 00000" className={field} />
              </div>
            </div>

            <div className="mt-5">
              <label htmlFor="subject" className={label}>Subject *</label>
              <input id="subject" name="subject" value={form.subject} onChange={handleChange} placeholder="What's this about?" className={field} required />
            </div>

            <div className="mt-5">
              <label htmlFor="message" className={label}>Message *</label>
              <textarea id="message" name="message" rows={6} value={form.message} onChange={handleChange} placeholder="How many mailboxes and domains do you send from, and roughly what monthly volume?" className={`${field} resize-y`} required />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="font-display mt-7 w-full rounded-2xl border-[3px] border-foreground bg-primary px-7 py-4 text-[15px] font-bold text-primary-foreground shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))] disabled:opacity-60"
            >
              {loading ? "Sending…" : "Send message →"}
            </button>
          </form>

          <aside className="flex flex-col gap-5">
            {REACH.map((r) => (
              <a
                key={r.label}
                href={r.href}
                target={r.href.startsWith("http") ? "_blank" : undefined}
                rel={r.href.startsWith("http") ? "noopener noreferrer" : undefined}
                className="block rounded-3xl border-[3px] border-foreground p-6 shadow-[6px_6px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[3px_3px_0_0_hsl(var(--foreground))]"
                style={{ background: `hsl(var(--sb-${r.p}))` }}
              >
                <p className="font-display text-[12px] font-bold uppercase tracking-[0.1em] text-foreground/60">
                  {r.label}
                </p>
                <p className="font-display mt-1.5 break-words text-[17px] font-black text-foreground">
                  {r.value}
                </p>
              </a>
            ))}

            <div className="rounded-3xl border-[3px] border-foreground bg-card p-6 shadow-[6px_6px_0_0_hsl(var(--foreground))]">
              <p className="font-display text-[15px] font-black text-foreground">Response time</p>
              <p className="mt-2 text-[14px] leading-relaxed text-foreground/70">
                We reply within 1–2 business days. Most messages get answered the same day.
              </p>
              <p className="mt-4 text-[14px] leading-relaxed text-foreground/70">
                Prefer to run it yourself? Pigeon is MIT licensed —{" "}
                <Link href="/features" className="font-semibold text-primary hover:underline">
                  see what&rsquo;s included
                </Link>
                .
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default function ContactPage() {
  return (
    <Suspense fallback={null}>
      <ContactForm />
    </Suspense>
  );
}
