"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Code, Eye, Copy, Check, Variable, Type, Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IsolatedPreview } from "@/components/IsolatedPreview";
import { toast } from "sonner";
import { HelpLinks } from "@/components/HelpLinks";

const SAMPLE_DATA = {
  first_name: "John",
  last_name: "Doe",
  company: "Acme Corp",
  title: "CEO",
  industry: "Technology",
};

function replaceVariables(str: string): string {
  return str
    .replace(/\{\{first_name\}\}/g, SAMPLE_DATA.first_name)
    .replace(/\{\{last_name\}\}/g, SAMPLE_DATA.last_name)
    .replace(/\{\{company\}\}/g, SAMPLE_DATA.company)
    .replace(/\{\{title\}\}/g, SAMPLE_DATA.title)
    .replace(/\{\{industry\}\}/g, SAMPLE_DATA.industry);
}

type ExampleBase = {
  id: string;
  title: string;
  description: string;
  subject: string;
};

const PLAIN_TEXT_EXAMPLES: Array<ExampleBase & { text: string }> = [
  {
    id: "plain-cold-outreach",
    title: "Cold outreach",
    description: "Short, direct first touch. Personalize with {{company}} and {{industry}}.",
    subject: "Quick question about {{company}}",
    text: `Hi {{first_name}},

I noticed {{company}} is in the {{industry}} space. We help similar teams cut outreach time by 40% without sacrificing reply rates.

Worth a 15-min call this week to see if it's a fit?

Best,
[Your Name]`,
  },
  {
    id: "plain-intro",
    title: "B2B intro (all variables)",
    description: "Uses {{first_name}}, {{last_name}}, {{company}}, {{title}}, {{industry}} for a tailored intro.",
    subject: "{{first_name}}, intro from [Your Name]",
    text: `Hi {{first_name}} {{last_name}},

As {{title}} at {{company}}, you're likely focused on growth in {{industry}}. We've helped similar leaders double pipeline from outbound.

I'd love to share how — are you free for a 10-min call this week?

Thanks,
[Your Name]`,
  },
  {
    id: "spintax-basic",
    title: "Spintax: Basic Variations",
    description: "Use {option1|option2} syntax for unique greetings and CTAs. Zero cost, maximum uniqueness.",
    subject: "{Quick question|Question|Reaching out} about {{company}}",
    text: `{Hi|Hello|Hey} {{first_name}},

I noticed {{company}} is in the {{industry}} space. {We help|We assist|We work with} {similar teams|companies like yours} {cut|reduce|optimize} outreach time by 40%.

{Worth a call?|Can we chat?|Interested in learning more?}

{Best|Cheers|Thanks},
[Your Name]`,
  },
  {
    id: "spintax-advanced",
    title: "Spintax: Advanced (Variables + Spintax)",
    description: "Combine spintax with variables for extreme uniqueness. Perfect for 750 emails/day scale.",
    subject: "{Hi|Hello|Hey} {{first_name}}, {quick question|question} about {{company}}",
    text: `{Hi|Hello|Hey there} {{first_name}},

{I noticed|I saw|I came across} {{company}} in the {{industry}} {space|industry|sector}. {We've helped|We work with|We assist} {similar|comparable} {teams|companies|organizations} {increase|boost|improve} their {outreach|outbound|email} {efficiency|performance|results} by {30-40%|over 35%|up to 40%}.

{Would you be open to|Are you interested in|Can we schedule} a {quick|brief|short} {call|chat|conversation} this week?

{Best regards|Best|Cheers|Thanks},
[Your Name]`,
  },
];

const HTML_EXAMPLES: Array<ExampleBase & { html: string }> = [
  {
    id: "html-cold-outreach",
    title: "Cold outreach (HTML)",
    description: "Clean, mobile-friendly HTML. Same variables; better rendering in clients.",
    subject: "Quick question about {{company}}",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Email</title>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5;">
  <div style="max-width:600px; margin:0 auto; padding:32px 24px;">
    <div style="background:#fff; border-radius:12px; padding:28px 24px; box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Hi {{first_name}},</p>
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">I noticed {{company}} is in the {{industry}} space. We help similar teams cut outreach time without sacrificing reply rates.</p>
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Worth a 15-min call this week to see if it's a fit?</p>
      <p style="margin:0; font-size:15px; line-height:1.6; color:#1a1a1a;">Best,<br>[Your Name]</p>
    </div>
  </div>
</body>
</html>`,
  },
  {
    id: "html-intro",
    title: "B2B intro – all variables (HTML)",
    description: "Uses {{first_name}}, {{last_name}}, {{company}}, {{title}}, {{industry}}. Styled for readability.",
    subject: "{{first_name}}, intro from [Your Name]",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5;">
  <div style="max-width:600px; margin:0 auto; padding:32px 24px;">
    <div style="background:#fff; border-radius:12px; padding:28px 24px; box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Hi {{first_name}} {{last_name}},</p>
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">As {{title}} at {{company}}, you're likely focused on growth in {{industry}}. We've helped similar leaders double pipeline from outbound.</p>
      <p style="margin:0; font-size:15px; line-height:1.6; color:#1a1a1a;">I'd love to share how — are you free for a 10-min call this week?<br><br>Thanks,<br>[Your Name]</p>
    </div>
  </div>
</body>
</html>`,
  },
  {
    id: "html-image",
    title: "HTML with image",
    description: "Shows how to add an image with &lt;img&gt;. Use a hosted URL; replace src with your image link.",
    subject: "{{first_name}}, quick visual from [Your Name]",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5;">
  <div style="max-width:600px; margin:0 auto; padding:32px 24px;">
    <div style="background:#fff; border-radius:12px; padding:28px 24px; box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Hi {{first_name}},</p>
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Here's a quick visual for {{company}} — thought you might find it useful.</p>
      <!-- Replace src with your hosted image URL. Use width for email compatibility. -->
      <img src="https://placehold.co/600x240/f0f0f0/666?text=Your+Image+Here" alt="Preview" width="600" style="max-width:100%; height:auto; display:block; border-radius:8px; margin:16px 0;" />
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Happy to walk you through it on a short call.</p>
      <p style="margin:0; font-size:15px; line-height:1.6; color:#1a1a1a;">Best,<br>[Your Name]</p>
    </div>
  </div>
</body>
</html>`,
  },
  {
    id: "html-table",
    title: "HTML with table",
    description: "Email-safe table with inline styles. Use for comparison, features, or data.",
    subject: "{{company}} – quick comparison",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5;">
  <div style="max-width:600px; margin:0 auto; padding:32px 24px;">
    <div style="background:#fff; border-radius:12px; padding:28px 24px; box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">Hi {{first_name}},</p>
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#1a1a1a;">For {{company}}, here's a quick comparison — happy to discuss.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse; margin:16px 0; font-size:14px;">
        <tr style="background:#f8f8f8;">
          <th style="text-align:left; padding:12px 14px; border:1px solid #e5e5e5;">Feature</th>
          <th style="text-align:left; padding:12px 14px; border:1px solid #e5e5e5;">Basic</th>
          <th style="text-align:left; padding:12px 14px; border:1px solid #e5e5e5;">Pro</th>
        </tr>
        <tr>
          <td style="padding:12px 14px; border:1px solid #e5e5e5;">Outreach</td>
          <td style="padding:12px 14px; border:1px solid #e5e5e5;">✓</td>
          <td style="padding:12px 14px; border:1px solid #e5e5e5;">✓</td>
        </tr>
        <tr style="background:#fafafa;">
          <td style="padding:12px 14px; border:1px solid #e5e5e5;">Personalization</td>
          <td style="padding:12px 14px; border:1px solid #e5e5e5;">—</td>
          <td style="padding:12px 14px; border:1px solid #e5e5e5;">✓</td>
        </tr>
        <tr>
          <td style="padding:12px 14px; border:1px solid #e5e5e5;">Analytics</td>
          <td style="padding:12px 14px; border:1px solid #e5e5e5;">—</td>
          <td style="padding:12px 14px; border:1px solid #e5e5e5;">✓</td>
        </tr>
      </table>
      <p style="margin:0; font-size:15px; line-height:1.6; color:#1a1a1a;">Best,<br>[Your Name]</p>
    </div>
  </div>
</body>
</html>`,
  },
];

function PlainExampleCard({
  example,
  index,
}: {
  example: (typeof PLAIN_TEXT_EXAMPLES)[number];
  index: number;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(example.text);
    setCopied(true);
    toast.success("Plain text copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="overflow-hidden border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">{example.title}</CardTitle>
          <CardDescription className="text-sm">{example.description}</CardDescription>
          <div className="rounded-md border bg-muted/40 px-3 py-2 mt-2">
            <p className="text-xs font-medium text-muted-foreground">Subject</p>
            <p className="font-mono text-sm mt-0.5">{example.subject}</p>
            <p className="text-xs text-muted-foreground mt-1">→ {replaceVariables(example.subject)}</p>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <Tabs defaultValue="preview" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-9">
              <TabsTrigger value="code" className="gap-1.5 text-xs">
                <Code className="w-3.5 h-3.5" />
                Copy code
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-1.5 text-xs">
                <Eye className="w-3.5 h-3.5" />
                Preview
              </TabsTrigger>
            </TabsList>
            <TabsContent value="code" className="mt-3">
              <div className="relative rounded-lg border bg-muted/50">
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute top-2 right-2 gap-1 h-8 text-xs"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <pre className="p-4 pr-24 max-h-[280px] overflow-y-auto text-xs font-mono whitespace-pre-wrap leading-relaxed">
                  {example.text}
                </pre>
              </div>
            </TabsContent>
            <TabsContent value="preview" className="mt-3">
              <div className="rounded-lg border bg-white p-4 max-h-[280px] overflow-y-auto">
                <pre className="text-sm font-sans whitespace-pre-wrap m-0 text-foreground/90">
                  {replaceVariables(example.text)}
                </pre>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function HtmlExampleCard({
  example,
  index,
}: {
  example: (typeof HTML_EXAMPLES)[number];
  index: number;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(example.html);
    setCopied(true);
    toast.success("HTML copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="overflow-hidden border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">{example.title}</CardTitle>
          <CardDescription className="text-sm">{example.description}</CardDescription>
          <div className="rounded-md border bg-muted/40 px-3 py-2 mt-2">
            <p className="text-xs font-medium text-muted-foreground">Subject</p>
            <p className="font-mono text-sm mt-0.5">{example.subject}</p>
            <p className="text-xs text-muted-foreground mt-1">→ {replaceVariables(example.subject)}</p>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <Tabs defaultValue="preview" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-9">
              <TabsTrigger value="code" className="gap-1.5 text-xs">
                <Code className="w-3.5 h-3.5" />
                Copy HTML
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-1.5 text-xs">
                <Eye className="w-3.5 h-3.5" />
                Preview
              </TabsTrigger>
            </TabsList>
            <TabsContent value="code" className="mt-3">
              <div className="relative rounded-lg border bg-muted/50">
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute top-2 right-2 gap-1 h-8 text-xs"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <pre className="p-4 pr-24 max-h-[280px] overflow-y-auto text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
                  <code>{example.html}</code>
                </pre>
              </div>
            </TabsContent>
            <TabsContent value="preview" className="mt-3">
              <div className="rounded-lg border overflow-hidden">
                <div className="p-3 border-b bg-muted/30 text-xs text-muted-foreground">
                  Preview: John, Doe, Acme Corp, CEO, Technology
                </div>
                <IsolatedPreview
                  mode="html"
                  html={replaceVariables(example.html)}
                  plainText=""
                  title="Example preview"
                  className="max-h-[280px] w-full rounded-none border-0"
                />
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function VariableReference() {
  return (
    <div
      className="rounded-xl border bg-card p-4"
      data-tour="templates-variables"
    >
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
        <Variable className="w-3.5 h-3.5" />
        Variables (replace with contact data)
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <code className="rounded bg-muted px-2 py-1.5 font-mono">{`{{first_name}}`}</code>
        <code className="rounded bg-muted px-2 py-1.5 font-mono">{`{{last_name}}`}</code>
        <code className="rounded bg-muted px-2 py-1.5 font-mono">{`{{email}}`}</code>
        <code className="rounded bg-muted px-2 py-1.5 font-mono">{`{{company}}`}</code>
        <code className="rounded bg-muted px-2 py-1.5 font-mono">{`{{industry}}`}</code>
        <code className="rounded bg-muted px-2 py-1.5 font-mono col-span-2 sm:col-span-1">{`{{title}}`}</code>
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        Use these exact names. first_name, last_name, email, company, industry are standard. title and others work as custom fields if your list has them.
      </p>
    </div>
  );
}

function SpintaxReference() {
  return (
    <div
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
      data-tour="templates-spintax"
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          <Braces className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Spintax</p>
          <p className="text-xs text-muted-foreground">Random variations per email</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Use <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{`{option1|option2}`}</code> to pick one option at random for each recipient.
      </p>
      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground">Example</p>
        <code className="block rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
          {`{Hi|Hello} {{first_name}}, {hope you're well|just reaching out}`}
        </code>
        <div className="space-y-2 pt-1 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground">Sample results</p>
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex items-baseline gap-2">
              <span className="w-14 shrink-0 font-medium text-muted-foreground">Result 1:</span>
              <span className="text-foreground">Hi John, hope you're well</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="w-14 shrink-0 font-medium text-muted-foreground">Result 2:</span>
              <span className="text-foreground">Hello John, just reaching out</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TemplateExamplesPage() {
  const [activeTab, setActiveTab] = useState<"plain" | "html">("plain");

  return (
    <div className="min-h-screen space-y-6 pb-12">
      <section className="flex flex-col gap-4">
        <Link href="/templates">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
            Back to Templates
          </Button>
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Template examples
          </h1>
          <p className="text-muted-foreground text-sm max-w-xl">
            Pick plain text or HTML → copy an example → paste into your template. Variables like {`{{first_name}}`} and {`{{company}}`} are replaced with each contact's data when you send.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <VariableReference />
          <SpintaxReference />
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "plain" | "html")} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2 h-11 mb-6">
          <TabsTrigger value="plain" className="gap-2">
            <Type className="w-4 h-4" />
            Plain text
          </TabsTrigger>
          <TabsTrigger value="html" className="gap-2">
            <Braces className="w-4 h-4" />
            HTML
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plain" className="mt-0 space-y-4">
          <p className="text-sm text-muted-foreground">
            Sent as <code className="rounded bg-muted px-1.5 py-0.5 text-xs">text/plain</code>. No formatting; works everywhere. Best for short, direct outreach.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
            {PLAIN_TEXT_EXAMPLES.map((example, index) => (
              <PlainExampleCard key={example.id} example={example} index={index} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="html" className="mt-0 space-y-4">
          <p className="text-sm text-muted-foreground">
            Sent as <code className="rounded bg-muted px-1.5 py-0.5 text-xs">text/html</code>. Styled layout; better rendering in Gmail, Outlook, etc.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
            {HTML_EXAMPLES.map((example, index) => (
              <HtmlExampleCard key={example.id} example={example} index={index} />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <HelpLinks
        slugs={["use-template-guide-and-examples", "use-merge-variables-first-name-company", "create-first-email-template"]}
        className="mt-6"
      />
    </div>
  );
}
