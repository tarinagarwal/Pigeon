"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  BookOpen,
  Rocket,
  Globe,
  Mail,
  Flame,
  Users,
  FileText,
  Send,
  BarChart3,
  Bell,
  Settings,
  CheckCircle2,
  ArrowRight,
  MessageSquare,
  Sparkles,
  TestTube,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpLinks } from "@/components/HelpLinks";
import { AppPageShell } from "@/components/AppPageShell";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useActivationProgress } from "@/hooks/useActivationProgress";
import { SetupProgressCard } from "@/components/activation/SetupProgressCard";
import { NextBestActionCard } from "@/components/activation/NextBestActionCard";

const SCROLL_SPY_OFFSET = 120;

const SECTIONS = [
  { id: "before-you-start", label: "Before You Start", icon: Rocket },
  { id: "domains", label: "Domains", icon: Globe },
  { id: "inbox-accounts", label: "Inbox Accounts", icon: Mail },
  { id: "warmup", label: "Warmup", icon: Flame },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "campaigns", label: "Campaigns", icon: Send },
  { id: "ab-testing", label: "Template A/B Testing", icon: TestTube },
  { id: "inbox-replies", label: "Inbox (Replies)", icon: MessageSquare },
  { id: "dashboard-analytics", label: "Dashboard & Analytics", icon: BarChart3 },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "settings-support", label: "Settings & Support", icon: Settings },
  { id: "quick-start", label: "Quick Start Checklist", icon: CheckCircle2 },
];

function useHash() {
  const [hash, setHash] = useState("");
  useEffect(() => {
    const read = () => setHash(typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "");
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return hash;
}

export default function GetStartedPage() {
  const hash = useHash();
  const { user } = useAuth();
  const isFreePlan =
    !user?.plan_id || user.plan_id === "free" || user?.plan?.id === "free";
  const noTrialEver =
    !user?.trial_used_at &&
    !user?.trial_ends_at &&
    user?.subscription_status !== "trial" &&
    user?.subscription_status !== "active";
  const canClaimFreeTrial = isFreePlan && noTrialEver;
  const activation = useActivationProgress(user?.id ?? "");

  const [activeSection, setActiveSection] = useState<string>(() => SECTIONS[0].id);

  // Sync active section from hash on load or hash change
  useEffect(() => {
    const clean = hash;
    if (clean && SECTIONS.some((s) => s.id === clean)) {
      setActiveSection(clean);
    }
  }, [hash]);

  // Scroll to section when hash changes (e.g. link click to /get-started#ab-testing)
  useEffect(() => {
    if (!hash || !SECTIONS.some((s) => s.id === hash)) return;
    const scrollToSection = () => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    let raf2: number;
    const raf = requestAnimationFrame(() => {
      scrollToSection();
      raf2 = requestAnimationFrame(() => scrollToSection());
    });
    return () => {
      cancelAnimationFrame(raf);
      if (raf2 != null) cancelAnimationFrame(raf2);
    };
  }, [hash]);

  // Scroll-spy: update active section based on scroll position
  useEffect(() => {
    const sectionIds = SECTIONS.map((s) => s.id);
    const updateActiveSection = () => {
      let current: string = sectionIds[0];
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= SCROLL_SPY_OFFSET) current = id;
      }
      setActiveSection(current);
    };
    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    return () => window.removeEventListener("scroll", updateActiveSection);
  }, []);

  return (
    <AppPageShell
      title="Get Started"
      description="Follow this guide to set up Pigeon AI from signup to your first campaign. We recommend doing the steps in order."
    >
    <div className="flex flex-col lg:flex-row gap-8 p-4 md:p-6 max-w-7xl mx-auto">
      <aside className="lg:w-56 shrink-0">
        <div className="sticky top-20 rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          <ScrollArea className="h-[calc(100vh-6rem)]">
            <nav className="space-y-0.5 py-4 px-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-3">On this page</p>
              {SECTIONS.map(({ id, label, icon: Icon }) => {
                const isActive = activeSection === id;
                return (
                  <a
                    key={id}
                    href={`#${id}`}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-all duration-200",
                      isActive
                        ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className={isActive ? "font-semibold" : ""}>{label}</span>
                  </a>
                );
              })}
            </nav>
          </ScrollArea>
        </div>
      </aside>

      <main className="flex-1 min-w-0 space-y-10 pb-16">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex items-center gap-2 text-primary">
            <BookOpen className="w-6 h-6" />
            <span className="text-sm font-medium">Documentation</span>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
            <CardContent className="py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2.5 shrink-0">
                  <BookOpen className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-lg">Try the interactive demo</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    New here? Take a 2-minute guided tour of the dashboard and main features before diving into the guide.
                  </p>
                </div>
              </div>
              <Button asChild className="shrink-0 gradient-primary">
                <Link href="/dashboard?startTour=1">
                  Start demo tour
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.section>

        {!activation.isLoading && !activation.isComplete && (
          <section className="space-y-4">
            <NextBestActionCard nextStep={activation.nextStep} />
            <SetupProgressCard
              percent={activation.percent}
              completedCount={activation.completedCount}
              totalSteps={activation.totalSteps}
              steps={activation.steps}
            />
          </section>
        )}

        {canClaimFreeTrial && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl border-2 border-amber-200/60 bg-gradient-to-br from-white via-amber-50/40 to-orange-50/30 p-5 shadow-lg transition-all duration-300 sm:p-6"
          >
            <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-100/80 via-orange-50/70 to-amber-50/80 p-6 ring-1 ring-amber-200/70 transition-all hover:ring-amber-300/80">
              <div className="absolute inset-0 bg-gradient-to-r from-amber-200/0 via-orange-200/20 to-amber-200/0 opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                  <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                    <div className="absolute inset-0 animate-pulse rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 opacity-25 blur-xl" />
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-400/60">
                      <Sparkles className="h-7 w-7 text-white animate-pulse" />
                    </div>
                  </div>
                  <div className="flex-1 pt-0.5">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-xl font-bold bg-gradient-to-r from-amber-700 via-orange-600 to-amber-700 bg-clip-text text-transparent leading-tight">
                        Unlock Your Free Premium Trial
                      </h3>
                      <span className="rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm border border-amber-200/80">
                        Limited Time
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      You&apos;re eligible for a{" "}
                      <span className="font-semibold text-amber-700">
                        free premium trial
                      </span>
                      ! Get unlimited campaigns, custom domains, and 10x daily email
                      limits.
                    </p>
                  </div>
                </div>
                <Button
                  asChild
                  size="lg"
                  className="shrink-0 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-600 hover:via-orange-600 hover:to-amber-600 text-white font-bold shadow-xl shadow-amber-400/40 transition-all hover:scale-105 rounded-xl border-2 border-amber-400/40 hover:border-amber-300 group/btn px-8"
                >
                  <Link href="/pricing" className="relative">
                    <span className="relative z-10 flex items-center gap-2">
                      Talk to us
                      <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                    </span>
                  </Link>
                </Button>
              </div>
            </div>
          </motion.section>
        )}

        <section id="before-you-start" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Rocket className="w-5 h-5" />
                Before You Start
              </CardTitle>
              <CardDescription>Prerequisites and account setup</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-1">What is Pigeon AI?</h4>
                <p className="text-sm text-muted-foreground">
                  Pigeon AI is an email outreach platform with AI-powered content, domain management, inbox warmup, campaign automation, and analytics. You connect domains and inboxes, import contacts, create templates, and run campaigns—all from one place.
                </p>
                <Link href="/features" className="text-sm text-primary hover:underline inline-flex items-center gap-1 mt-2">
                  See all features
                </Link>
              </div>
              <div>
                <h4 className="font-medium mb-1">Account & signup</h4>
                <p className="text-sm text-muted-foreground">
                  Create an account from the <Link href="/login" className="text-primary hover:underline">signup</Link> page. After logging in, you can reset your password anytime via{" "}
                  <Link href="/login" className="text-primary hover:underline">Login</Link> → Forgot password.
                </p>
              </div>
              <div>
                <h4 className="font-medium mb-1">Plans & limits</h4>
                <p className="text-sm text-muted-foreground">
                  Your plan defines limits for domains, inboxes, campaigns, and warmup. Check <Link href="/pricing" className="text-primary hover:underline">Pricing</Link> for details. You can see your current usage on the <Link href="/dashboard" className="text-primary hover:underline">Dashboard</Link> and in <Link href="/settings?tab=billing" className="text-primary hover:underline">Settings → Billing</Link>.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="domains" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Domains
              </CardTitle>
              <CardDescription>Add and verify your sending domain</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                To send from your own domain (e.g. <code className="rounded bg-muted px-1.5 py-0.5 text-xs">you@yourcompany.com</code>), add the domain in Pigeon and complete DNS setup.
              </p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Go to <Link href="/domains" className="text-primary hover:underline font-medium">Domains</Link> and click <strong>Add domain</strong>.</li>
                <li>Enter your domain name. You&apos;ll get the required DNS records (SPF, DKIM, DMARC).</li>
                <li>Add these records in your DNS provider (e.g. Cloudflare, GoDaddy).</li>
                <li>Click Verify in Pigeon. Once verified, the domain is ready to use.</li>
              </ol>
              <p className="text-sm text-muted-foreground">
                <strong>Domain health score</strong> reflects sender reputation and deliverability. Keep it high by following sending best practices and using warmup when available.
              </p>
              <h4 className="font-medium text-sm">Advanced</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li><strong>Enable receiving</strong> — For Mail Receiving; add the MX record then enable.</li>
                <li><strong>Sync to provider</strong> — Sync DNS state to SendGrid when needed.</li>
              </ul>
              <Button asChild variant="outline" size="sm">
                <Link href="/domains">Open Domains</Link>
              </Button>
              <HelpLinks slugs={["add-verify-sending-domain-pigeon"]} className="mt-4" />
            </CardContent>
          </Card>
        </section>

        <section id="inbox-accounts" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Inbox Accounts
              </CardTitle>
              <CardDescription>Connect Gmail or SMTP for sending</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                An <strong>inbox</strong> is the account that actually sends your campaign emails. Add inboxes from <Link href="/inboxes" className="text-primary hover:underline">Inbox Accounts</Link>; create new ones via <Link href="/inboxes/new" className="text-primary hover:underline">Add inbox</Link>.
              </p>
              <h4 className="font-medium text-sm">Gmail</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li>One-click connection via Google OAuth (no password stored).</li>
                <li>Requires your plan to allow Gmail. Configure OAuth in <Link href="/settings?tab=integrations" className="text-primary hover:underline">Settings → Integrations</Link> if you use your own Google Client ID and Secret.</li>
              </ul>
              <h4 className="font-medium text-sm">SMTP (custom domain)</h4>
              <p className="text-sm text-muted-foreground">Choose a provider when adding an SMTP inbox:</p>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li><strong>Pigeon Provider</strong> — Use Pigeon&apos;s SendGrid sending; select your verified domain. No credentials required.</li>
                <li><strong>Custom SMTP</strong> — Your own SMTP server: host, port (e.g. 587), username, password.</li>
              </ul>
              <h4 className="font-medium text-sm">Single vs bulk</h4>
              <p className="text-sm text-muted-foreground">
                Add one inbox at a time (single) or multiple at once (bulk). Bulk creation is available for SMTP with a selected domain: enter one username per line (or comma-separated); each becomes <code className="rounded bg-muted px-1 py-0.5 text-xs">username@yourdomain.com</code>. Custom SMTP is not supported for bulk (each needs its own credentials).
              </p>
              <h4 className="font-medium text-sm">Daily limit & warmup</h4>
              <p className="text-sm text-muted-foreground">
                Set a <strong>daily sending limit</strong> per inbox (e.g. 50) to protect deliverability. If your plan includes warmup, you can enable <strong>Auto warmup</strong> for new SMTP inboxes so they warm up automatically.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/inboxes">Open Inbox Accounts</Link>
              </Button>
              <HelpLinks
                slugs={[
                  "add-first-gmail-smtp-inbox",
                  "google-client-id-secret-gmail-setup",
                  "connect-gmail-app-password-without-oauth",
                  "add-smtp-inbox-accounts-domain",
                  "set-up-reply-to-imap-campaign-replies",
                  "manage-inbox-accounts-warmup-status",
                  "understanding-inbox-status-ready-warming-warmup-required",
                ]}
                className="mt-4"
              />
            </CardContent>
          </Card>
        </section>

        <section id="warmup" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="w-5 h-5" />
                Warmup
              </CardTitle>
              <CardDescription>Build sender reputation before heavy sending</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                <strong>Warmup</strong> sends low-volume, natural-looking traffic so providers (Gmail, Outlook, etc.) learn to trust your domain. Recommended before running large campaigns. Warmup may be a paid add-on depending on your plan.
              </p>
              <h4 className="font-medium text-sm">Warmup overview</h4>
              <p className="text-sm text-muted-foreground">
                On the <Link href="/warmup" className="text-primary hover:underline">Warmup</Link> page you&apos;ll see: status per inbox (<strong>Warming</strong> / <strong>Ready</strong> / Healthy), warmup progress, daily capacity, and domain health trend. Inboxes that are &quot;Ready&quot; have completed warmup and are safe for higher volume.
              </p>
              <h4 className="font-medium text-sm">Warmup templates</h4>
              <p className="text-sm text-muted-foreground">
                Under <Link href="/warmup/templates" className="text-primary hover:underline">Warmup → Manage templates</Link> you can create and edit the email templates used for warmup traffic. These are separate from your campaign templates. Create a new warmup template to customize what gets sent during warmup.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/warmup">Open Warmup</Link>
              </Button>
              <HelpLinks
                slugs={[
                  "what-is-email-warmup-how-to-use-pigeon",
                  "start-pause-resume-warmup-inboxes",
                  "check-warmup-progress-when-inbox-ready",
                  "best-practices-inbox-warmup-before-sending-campaigns",
                ]}
                className="mt-4"
              />
            </CardContent>
          </Card>
        </section>

        <section id="contacts" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Contacts
              </CardTitle>
              <CardDescription>Import and organize your leads</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Contacts are the people you send campaign emails to. Manage them from <Link href="/contacts" className="text-primary hover:underline">Contacts</Link>.
              </p>
              <h4 className="font-medium text-sm">Adding contacts</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li><strong>Add manually</strong> — Use the add-contact flow to enter name, email, and optional fields (company, etc.).</li>
                <li><strong>Import CSV/Excel</strong> — Go to <Link href="/contacts/import" className="text-primary hover:underline">Contacts → Import</Link> to upload a file. Map columns to contact fields (email, first name, last name, etc.). Supports dedupe and validation.</li>
              </ul>
              <h4 className="font-medium text-sm">Contact lists</h4>
              <p className="text-sm text-muted-foreground">
                Organize contacts into <strong>contact lists</strong>. When creating a campaign, you choose one or more lists as the audience. Use lists to segment by source, industry, or stage.
              </p>
              <h4 className="font-medium text-sm">Manual block / unblock</h4>
              <p className="text-sm text-muted-foreground">
                Use <Link href="/contacts/manual-block-unblock" className="text-primary hover:underline">Manual block / unblock</Link> to exclude or re-include contacts from receiving emails (e.g. unsubscribes, bounces, or opt-outs). Blocked contacts are not sent campaign emails.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/contacts">Open Contacts</Link>
              </Button>
              <HelpLinks
                slugs={[
                  "import-contacts-csv-excel",
                  "map-columns-when-importing-contacts",
                  "create-manage-contact-lists",
                  "manually-block-unblock-contacts",
                  "use-verified-leads-pro",
                ]}
                className="mt-4"
              />
            </CardContent>
          </Card>
        </section>

        <section id="templates" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Templates
              </CardTitle>
              <CardDescription>Create email content and use AI</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                <strong>Templates</strong> define the subject and body of your campaign emails. Create and edit them under <Link href="/templates" className="text-primary hover:underline">Templates</Link>.
              </p>
              <h4 className="font-medium text-sm">Variables</h4>
              <p className="text-sm text-muted-foreground">
                Use merge variables so each recipient gets personalized content, e.g. <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{{first_name}}`}</code>, <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{{last_name}}`}</code>, <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{{company}}`}</code>. These are replaced with the contact&apos;s data when the email is sent.
              </p>
              <h4 className="font-medium text-sm">AI generation</h4>
              <p className="text-sm text-muted-foreground">
                When creating or editing a template, you can use AI to generate subject and body. Configure an AI provider (e.g. OpenAI) in <Link href="/settings?tab=integrations" className="text-primary hover:underline">Settings → Integrations → AI Providers</Link> with your API key.
              </p>
              <h4 className="font-medium text-sm">Template Guide & Examples</h4>
              <p className="text-sm text-muted-foreground">
                The <Link href="/templates/guide" className="text-primary hover:underline">Template Guide</Link> explains spam trigger words and compliance so your emails stay out of spam. <Link href="/templates/examples" className="text-primary hover:underline">Template Examples</Link> give you ready-made ideas and structures.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/templates">Open Templates</Link>
              </Button>
              <HelpLinks
                slugs={[
                  "create-first-email-template",
                  "use-merge-variables-first-name-company",
                  "use-template-guide-and-examples",
                  "add-unsubscribe-link-compliance",
                ]}
                className="mt-4"
              />
            </CardContent>
          </Card>
        </section>

        <section id="campaigns" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5" />
                Campaigns
              </CardTitle>
              <CardDescription>Create and run your first campaign</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                A <strong>campaign</strong> sends a sequence of emails to a chosen audience. Create one from <Link href="/campaigns/new" className="text-primary hover:underline">Campaigns → Create</Link>. The wizard has five steps (the same flow is used when you <strong>Edit</strong> a campaign):
              </p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li><strong>Basics</strong> — Campaign name and sending identity (Gmail or domain inboxes, optional test send).</li>
                <li><strong>Audience</strong> — Choose a contact list and preview verified counts (and optional warmup network options).</li>
                <li><strong>Email sequence</strong> — Add steps, pick templates (including A/B variants), set delays, and optional AI or web enrichment.</li>
                <li><strong>Delivery</strong> — Timezone and sending window, weekdays, daily limit and inbox rotation, optional AI variation &amp; Serper enrichment (in an advanced section), plus Reply-To and open tracking.</li>
                <li><strong>Review</strong> — Spam/compliance summary and a final checklist before you launch or save.</li>
              </ol>
              <p className="text-sm text-muted-foreground">
                <strong>Reply-To:</strong> Where replies go is set in <Link href="/settings?tab=integrations" className="text-primary hover:underline">Settings → Integrations → Reply-To (for campaigns)</Link>. You can choose None, a Gmail account, or an IMAP account (add IMAP accounts there too).
              </p>
              <p className="text-sm text-muted-foreground">
                After creation, <strong>Start</strong> or <strong>Pause</strong> from the campaign list or detail page. Open a campaign to see <strong>Actions</strong> (send batches, logs) and <strong>Contacts</strong> (who received which step).
              </p>
              <Button asChild size="sm">
                <Link href="/campaigns/new">Create campaign</Link>
              </Button>
              <HelpLinks
                slugs={[
                  "create-first-campaign-pigeon",
                  "choose-gmail-vs-smtp-select-sending-inboxes",
                  "set-daily-limits-send-time-windows",
                  "use-ai-generate-campaign-templates-ai-campaign-studio",
                  "run-template-ab-tests-campaign",
                  "edit-or-pause-campaign",
                ]}
                className="mt-4"
              />
            </CardContent>
          </Card>
        </section>

        <section id="ab-testing" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TestTube className="w-5 h-5" />
                Template A/B Testing
              </CardTitle>
              <CardDescription>Test multiple templates; the best one wins and can be re-evaluated over time</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                In the <strong>Email sequence</strong> step of a campaign, you can add <strong>multiple template variants</strong> per step. The system splits your audience so each contact receives one variant (e.g. 50/50 for two templates). Performance is tracked per template, and the system <strong>auto-selects a winner</strong> once there&apos;s enough data—then <strong>re-evaluates</strong> over time so if the winner stops performing well, another variant can take over.
              </p>
              <h4 className="font-medium text-sm">How to set it up</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li>When creating or editing a campaign, go to <strong>Email sequence</strong>.</li>
                <li>For the <strong>Initial email</strong> or any <strong>Follow-up</strong>, use <strong>Add variant</strong> to add a second (or third, etc.) template. Each step can have its own number of variants.</li>
                <li>Select a different template for each variant. Contacts are assigned to one variant in a stable way (same contact always gets the same variant).</li>
              </ul>
              <h4 className="font-medium text-sm">How A/B evaluation works</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li><strong>Auto-winner:</strong> After the campaign has been sending for a while (e.g. 1+ day) and each variant has enough sends, the system picks a winner using open rate and reply rate (weighted 60% reply, 40% open). From then on, only that template is used for remaining contacts. You&apos;ll see &quot;Winner auto-selected&quot; on the campaign&apos;s Review step.</li>
                <li><strong>Re-evaluation:</strong> The winner is re-checked periodically (e.g. every 24 hours). If another variant&apos;s cumulative performance overtakes the current winner, the system switches to that template for future sends—so if the selected template stops working well over time, it can be replaced automatically.</li>
              </ul>
              <h4 className="font-medium text-sm">Where to see results</h4>
              <p className="text-sm text-muted-foreground">
                Open a campaign and go to the <strong>Review</strong> step. If the campaign has multiple templates, the <strong>A/B Performance by template</strong> card shows sent count, open %, click %, and reply % for each variant. The <Link href="/templates" className="text-primary hover:underline">Templates</Link> page also shows how many <strong>A/B tests are running</strong> (campaigns with 2+ templates).
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/campaigns/new">Create campaign with A/B</Link>
              </Button>
              <HelpLinks slugs={["run-template-ab-tests-campaign"]} className="mt-4" />
            </CardContent>
          </Card>
        </section>

        <section id="inbox-replies" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Inbox (Replies)
              </CardTitle>
              <CardDescription>View and manage campaign replies in one place</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The <Link href="/inbox/campaign-replies" className="text-primary hover:underline">Inbox</Link> page is a unified view of emails that land in your reply-to address (Gmail or IMAP configured in Settings → Integrations). Use it to see when prospects reply to your campaigns.
              </p>
              <h4 className="font-medium text-sm">What you can do</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li><strong>Filter</strong> — View all emails or filter by unread, etc.</li>
                <li><strong>Read & reply</strong> — Open an email to read it and send a reply. Replies are sent from the same account (Gmail or IMAP).</li>
                <li><strong>AI reply</strong> — If you have an AI provider configured, you can use AI to draft replies.</li>
                <li><strong>Archive / delete</strong> — Keep the inbox organized.</li>
              </ul>
              <p className="text-sm text-muted-foreground">
                Make sure <strong>Reply-To</strong> is set in Settings → Integrations so replies to campaign emails are received and shown here. For Gmail, connect the account in Integrations; for IMAP, add the IMAP account and set it as default Reply-To.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/inbox/campaign-replies">Open Inbox</Link>
              </Button>
              <HelpLinks
                slugs={[
                  "view-manage-campaign-replies-inbox",
                  "use-inbox-see-when-contacts-respond",
                  "set-up-notification-preferences-replies",
                ]}
                className="mt-4"
              />
            </CardContent>
          </Card>
        </section>

        <section id="dashboard-analytics" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Dashboard & Analytics
              </CardTitle>
              <CardDescription>Monitor performance and sending behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <h4 className="font-medium text-sm">Dashboard</h4>
              <p className="text-sm text-muted-foreground">
                The <Link href="/dashboard" className="text-primary hover:underline">Dashboard</Link> shows: <strong>Emails sent today</strong>, <strong>Open rate</strong>, <strong>Click rate</strong>, <strong>Reply rate</strong>, <strong>Domain health</strong>, warmup progress for your inboxes, active campaigns with start/pause, recent alerts, and recent activity. Use it for a quick health check.
              </p>
              <h4 className="font-medium text-sm">Analytics</h4>
              <p className="text-sm text-muted-foreground">
                <Link href="/analytics" className="text-primary hover:underline">Analytics</Link> gives deeper metrics: choose a <strong>time range</strong> (7, 30, or 90 days), optionally <strong>filter by campaign</strong>, and see totals and trends for sent, opened, clicked, replied. You can <strong>export to CSV</strong> for reports. Deliverability and performance charts help you optimize.
              </p>
              <h4 className="font-medium text-sm">Sending Behavior</h4>
              <p className="text-sm text-muted-foreground">
                <Link href="/tracking" className="text-primary hover:underline">Sending Behavior</Link> shows when and how you send: <strong>emails over time</strong>, <strong>sending by hour</strong>, <strong>by inbox</strong>, <strong>by campaign</strong>, and insights like <strong>peak sending hour (UTC)</strong>. Use it to stay within best practices and spread load across the day.
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/analytics">Analytics</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/tracking">Sending Behavior</Link>
                </Button>
              </div>
              <HelpLinks
                slugs={[
                  "read-dashboard-analytics",
                  "use-sending-behavior-tracking-improve-deliverability",
                  "understand-sending-by-inbox-and-campaign",
                ]}
                className="mt-4"
              />
            </CardContent>
          </Card>
        </section>

        <section id="alerts" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Alerts
              </CardTitle>
              <CardDescription>Stay informed about bounces and issues</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The <Link href="/alerts" className="text-primary hover:underline">Alerts</Link> page shows important notifications (e.g. bounces, spam complaints, deliverability issues) so you can react quickly.
              </p>
              <h4 className="font-medium text-sm">Alert types</h4>
              <p className="text-sm text-muted-foreground">
                Alerts can be <strong>info</strong>, <strong>warning</strong>, <strong>error</strong>, or <strong>success</strong>. Each shows a title, message, and optional <strong>action link</strong> (e.g. to open the affected campaign or domain).
              </p>
              <h4 className="font-medium text-sm">Filters & actions</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li><strong>Filter</strong> — View all, unread only, or critical (warnings and errors).</li>
                <li><strong>Mark as read</strong> — Single alert or &quot;Mark all as read&quot;.</li>
                <li><strong>Dismiss</strong> — Remove an alert from the list (or mark read if dismiss is not available).</li>
                <li><strong>Take action</strong> — Click the action link to go to the relevant page (e.g. Domains, Campaigns).</li>
              </ul>
              <Button asChild variant="outline" size="sm">
                <Link href="/alerts">Open Alerts</Link>
              </Button>
              <HelpLinks slugs={["understanding-alerts-deliverability-system-notifications"]} className="mt-4" />
            </CardContent>
          </Card>
        </section>

        <section id="settings-support" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Settings & Support
              </CardTitle>
              <CardDescription>Account, security, integrations, compliance, billing, and help</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-muted-foreground">
                <Link href="/settings" className="text-primary hover:underline">Settings</Link> is split into tabs. Use the app sidebar: <strong>Settings</strong> → Account, Security, Notifications, Integrations, Compliance, or Billing.
              </p>
              <h4 className="font-medium text-sm">Account</h4>
              <p className="text-sm text-muted-foreground">
                <Link href="/settings?tab=account" className="text-primary hover:underline">Settings → Account</Link>: Update <strong>First name</strong>, <strong>Last name</strong>, and <strong>Company</strong>. Email is read-only (your login). Option to change profile photo (UI may show disabled until implemented). Click <strong>Save Changes</strong> to apply.
              </p>
              <h4 className="font-medium text-sm">Security</h4>
              <p className="text-sm text-muted-foreground">
                <Link href="/settings?tab=security" className="text-primary hover:underline">Settings → Security</Link>: <strong>Change password</strong> (current password, new password, confirm). <strong>Two-factor authentication (2FA)</strong> — toggle may be on-demand. <strong>Active sessions</strong> — see devices/locations where you&apos;re logged in; use <strong>Revoke other sessions</strong> to log out all other devices.
              </p>
              <h4 className="font-medium text-sm">Notifications</h4>
              <p className="text-sm text-muted-foreground">
                <Link href="/settings?tab=notifications" className="text-primary hover:underline">Settings → Notifications</Link>: Toggles for <strong>Campaign updates</strong> (start, pause, complete), <strong>Reply notifications</strong> (when prospects reply), <strong>Weekly reports</strong>, and <strong>Product updates</strong>. Notifications are sent to your account email.
              </p>
              <h4 className="font-medium text-sm">Integrations</h4>
              <p className="text-sm text-muted-foreground">
                <Link href="/settings?tab=integrations" className="text-primary hover:underline">Settings → Integrations</Link>:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground ml-2">
                <li><strong>Gmail</strong> — Connect Gmail accounts (if your plan allows). If admin hasn&apos;t set app default, you can add your own <strong>Google Client ID and Secret</strong> and set the redirect URI in Google Cloud Console. Then connect or disconnect Gmail accounts and add another.</li>
                <li><strong>Reply-To (for campaigns)</strong> — Choose where replies to campaign emails go: <strong>None</strong>, <strong>Gmail</strong> (select account), or <strong>IMAP</strong>. For IMAP, add accounts (email, IMAP host, port, username, password); presets for Gmail, Hostinger, GoDaddy, Zoho, Outlook, Yahoo, or Other. Test or remove IMAP accounts. The selected Reply-To is used when creating campaigns.</li>
                <li><strong>Connected Domains / Email Inboxes</strong> — Read-only list of your domains and inboxes for reference.</li>
                <li><strong>Webhooks</strong> — Coming soon (e.g. email.sent, email.opened, email.replied, email.bounced).</li>
                <li><strong>AI Providers</strong> — Add LLM configs for AI features (e.g. template generation). Choose provider (OpenAI, Anthropic, Gemini, DeepSeek, Grok, Groq), enter <strong>API key</strong>, optional <strong>model name</strong>. Save; you can add multiple providers and delete when not needed.</li>
              </ul>
              <h4 className="font-medium text-sm">Compliance</h4>
              <p className="text-sm text-muted-foreground">
                <Link href="/settings?tab=compliance" className="text-primary hover:underline">Settings → Compliance</Link>: <strong>Spam words</strong> — comma-separated list of words that trigger spam filters; they&apos;ll be flagged. <strong>Max links per email</strong> and <strong>Max images per email</strong> — set limits (e.g. 3 links, 2 images). <strong>Require unsubscribe link</strong> — toggle to enforce an unsubscribe link in all emails (CAN-SPAM best practice). Save after changes.
              </p>
              <h4 className="font-medium text-sm">Billing</h4>
              <p className="text-sm text-muted-foreground">
                <Link href="/settings?tab=billing" className="text-primary hover:underline">Settings → Billing</Link>: View <strong>Current plan</strong> (name, price, usage summary). <strong>Usage</strong> bars for domains, subdomains, active campaigns, domain inboxes (SMTP), Gmail inboxes, and emails today vs plan limits. <strong>Payment method</strong> (update when billing is live). Upgrade / trial may be disabled until payment integration is complete; contact support for manual subscription.
              </p>
              <h4 className="font-medium text-sm">Support</h4>
              <p className="text-sm text-muted-foreground">
                For help, open a ticket from <Link href="/tickets" className="text-primary hover:underline">Support (Tickets)</Link>. Create, view, and reply to tickets there. Use this for billing requests, feature questions, or technical issues.
              </p>
              <div className="flex gap-2 flex-wrap pt-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings">Settings</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings?tab=integrations">Integrations</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings?tab=compliance">Compliance</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/tickets">Support</Link>
                </Button>
              </div>
              <HelpLinks
                slugs={[
                  "configure-compliance-settings-spam-words-links-unsubscribe",
                  "manage-security-active-sessions",
                  "update-billing-subscription",
                  "why-gmail-connection-fails-how-to-fix",
                  "redirect-uri-mismatch-fix-google-oauth-errors",
                ]}
                className="mt-4"
              />
            </CardContent>
          </Card>
        </section>

        <section id="quick-start" className="scroll-mt-24">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                Quick Start Checklist
              </CardTitle>
              <CardDescription>Minimum path to your first campaign</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3">
                {[
                  { label: "Sign up and log in", path: "/dashboard", completed: true },
                  ...activation.steps.map((step) => ({
                    label: step.label,
                    path: step.href,
                    completed: step.completed,
                  })),
                  { label: "Check Dashboard and Analytics", path: "/dashboard", completed: activation.isComplete },
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    {item.completed ? (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-green-600/40 bg-green-600/10 text-xs font-semibold text-green-700">
                        ✓
                      </span>
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 bg-background text-xs font-medium text-primary">
                        {i + 1}
                      </span>
                    )}
                    <Link href={item.path} className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                      {item.label}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground pt-2">
                Once these are done, expand with warmup, more inboxes, template guide, and alerts as needed.
              </p>
              <HelpLinks slugs={["use-get-started-checklist"]} className="mt-4" />
            </CardContent>
          </Card>
        </section>

        <section className="pt-4">
          <Card>
            <CardContent className="py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Ready to dive in?</p>
                  <p className="text-sm text-muted-foreground">Head to the Dashboard to see your metrics and campaigns.</p>
                </div>
              </div>
              <Button asChild>
                <Link href="/dashboard">
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
    </AppPageShell>
  );
}
