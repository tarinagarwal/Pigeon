"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  FileText,
  AlertTriangle,
  Lock,
  Lightbulb,
  ArrowLeft,
  Sparkles,
  Shield,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HelpLinks } from "@/components/HelpLinks";

const CATEGORIES = [
  {
    id: "financial",
    emoji: "💰",
    title: "Financial & \"Get Rich\"",
    words: [
      "100% free", "Affordable", "Bargain", "Beneficiary", "Best price", "Cash", "Cash bonus", "Cheap", "Claims", "Collect", "Cost", "Credit", "Credit bureaus", "Debt", "Discount", "Earn", "Earn $", "Earn extra cash", "Eliminate debt", "Equity", "Fast cash", "Financial freedom", "Free", "Free gift", "Free investment", "Full refund", "Hidden assets", "Income", "Investment", "Loans", "Lower interest rate", "Lowest price", "Million dollars", "Money back", "Mortgage", "No cost", "No fees", "No hidden costs", "No interest", "No investment", "Obligation", "One hundred percent free", "Pennies a day", "Profits", "Pure profit", "Refinance", "Save big", "Save up to", "Total freedom", "Unsecured debt", "US dollars",
    ],
    accent: "amber",
  },
  {
    id: "urgency",
    emoji: "🚨",
    title: "Urgency & High Pressure",
    words: [
      "Act now", "Apply now", "Apply online", "Call free", "Call now", "Can't live without", "Do it today", "Don't delete", "Don't hesitate", "Exclusive deal", "Expire", "For only", "Get it now", "Get started now", "Great offer", "Immediate", "Instant", "Limited time", "New customers only", "Now only", "Offer expires", "Once in a lifetime", "Order now", "Special promotion", "Urgent", "While supplies last",
    ],
    accent: "red",
  },
  {
    id: "marketing",
    emoji: "🎁",
    title: "Marketing & Gimmicks",
    words: [
      "Ad", "All natural", "All new", "Amazing", "As seen on", "Auto email removal", "Believe me", "Bonus", "Cancel at any time", "Cards accepted", "Certified", "Click below", "Click here", "Congratulations", "Dear friend", "Direct email", "Direct marketing", "Double your", "Fantastic deal", "For free", "Free access", "Free consultation", "Free hosting", "Free info", "Free membership", "Free preview", "Free priority mail", "Free quote", "Free sample", "Free trial", "Guaranteed", "Increase sales", "Join millions", "Multi-level marketing", "No catch", "No strings attached", "Performance", "Prize", "Promise", "Quotes", "Removal", "Risk-free", "Satisfaction guaranteed", "Search engine listing", "Success", "Thousands", "Unlimited", "Winner",
    ],
    accent: "violet",
  },
  {
    id: "medical",
    emoji: "⚕️",
    title: "Medical & \"Miracle\" Cures",
    words: [
      "Additional income", "Age retrace", "Cure", "Diagnostics", "Fast Viagra", "Herbs", "Life insurance", "Lose weight", "Lose weight spam", "Medicine", "No medical exams", "No prescription", "Online pharmacy", "Pharmacy", "Removes wrinkles", "Reverses aging", "Stop snoring", "Valium", "Vicodin", "Weight loss", "Xanax",
    ],
    accent: "emerald",
  },
  {
    id: "safety",
    emoji: "🛡️",
    title: "Safety & Legal Scams",
    words: [
      "Account compromised", "Billing address", "Form", "Important information regarding", "Information you requested", "Legal", "Message contains", "Password", "Recover", "Security alert", "Social Security Number", "This isn't junk", "This isn't spam", "Unauthorized", "Verify your account",
    ],
    accent: "slate",
  },
];

const PRO_TIPS = [
  {
    title: "Avoid \"Trigger Density\"",
    description: "Using one or two of these words is fine. Using ten of them in two sentences is a red flag.",
    icon: AlertTriangle,
    step: "1",
  },
  {
    title: "Balance Text-to-Image",
    description: "Don't send an email that is just one big image. Spammers do this to hide text from filters, so Gmail often flags image-heavy emails.",
    icon: FileText,
    step: "2",
  },
  {
    title: "The \"Re:\" Trick",
    description: "Never start a subject line with \"Re:\" or \"Fwd:\" if it isn't actually a reply. It's a fast track to the spam folder for deceptive practices.",
    icon: Lock,
    step: "3",
  },
];

const tagColors: Record<string, string> = {
  amber: "bg-amber-500 text-white border-transparent hover:bg-amber-600",
  red: "bg-red-500 text-white border-transparent hover:bg-red-600",
  violet: "bg-primary text-white border-transparent hover:bg-primary",
  emerald: "bg-emerald-500 text-white border-transparent hover:bg-emerald-600",
  slate: "bg-slate-600 text-white border-transparent hover:bg-slate-700",
};

export default function TemplateGuidePage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border bg-card mb-8">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative px-6 py-8 sm:px-8 sm:py-10">
          <Link href="/templates">
            <Button variant="ghost" size="sm" className="gap-2 -ml-2 mb-4 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
              Back to Templates
            </Button>
          </Link>
          <Badge variant="secondary" className="mb-4 gap-1.5 px-3 py-1 text-xs font-medium">
            <Shield className="w-3.5 h-3.5" />
            Deliverability
          </Badge>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight max-w-2xl">
            Draft templates that land in{" "}
            <span className="text-primary dark:text-primary font-semibold">Primary</span>, not Promotions or Spam
          </h1>
          <p className="mt-3 text-muted-foreground max-w-xl text-sm sm:text-base">
            Words and phrases that often trigger spam or Promotions filters. Use sparingly. Customize your own list in{" "}
            <Link href="/settings?tab=compliance" className="text-primary font-medium hover:underline">
              Settings → Compliance
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Spam trigger categories */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-6">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Spam trigger words by category</h2>
        </div>
        <div className="space-y-5">
          {CATEGORIES.map((cat, index) => (
            <motion.div
              key={cat.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
            >
              <Card className="overflow-hidden border bg-card hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <span className="text-2xl" aria-hidden>{cat.emoji}</span>
                    {cat.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {cat.words.map((word) => (
                      <span
                        key={word}
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          tagColors[cat.accent] ?? tagColors.slate
                        )}
                      >
                        {word}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pro tips */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-6">
          <Lightbulb className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Pro-tips to stay out of Promotions or Spam</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRO_TIPS.map((tip, index) => (
            <motion.div
              key={tip.title}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + index * 0.05 }}
            >
              <Card className="h-full border bg-card hover:border-primary/30 hover:shadow-md transition-all">
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                      {tip.step}
                    </span>
                    <div>
                      <CardTitle className="text-base">{tip.title}</CardTitle>
                      <CardDescription className="mt-1.5 text-sm leading-relaxed">
                        {tip.description}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <Card className="border-dashed bg-muted/40">
        <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Settings className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">Customize compliance rules</p>
              <p className="text-sm text-muted-foreground">
                Spam words, max links, max images, and unsubscribe link in Settings.
              </p>
            </div>
          </div>
          <Link href="/settings?tab=compliance">
            <Button variant="outline" size="sm" className="shrink-0">
              Open Settings → Compliance
            </Button>
          </Link>
        </CardContent>
      </Card>

      <HelpLinks
        slugs={["use-template-guide-and-examples", "add-unsubscribe-link-compliance", "configure-compliance-settings-spam-words-links-unsubscribe"]}
        className="mt-6"
      />
    </div>
  );
}
