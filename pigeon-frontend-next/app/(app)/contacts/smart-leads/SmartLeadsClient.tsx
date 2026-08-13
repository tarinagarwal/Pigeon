"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  Eye,
  ExternalLink,
  Download,
  Globe,
  History,
  ListPlus,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Square,
  Target,
  Users,
  XCircle,
} from "lucide-react";
import type { SmartLeadsAudience, SmartLeadsEmailRow, SmartLeadsRunDetailResponse } from "@/types/api";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useLLMConfigs } from "@/hooks/useLLM";
import {
  useContinueSmartLeadsRun,
  useCreateSmartLeadsRun,
  useSmartLeadsRunDetail,
  useSmartLeadsRunStatus,
  useSmartLeadsRuns,
  useStopSmartLeadsRun,
} from "@/hooks/useSmartLeads";
import { useSerperSettings, useZeroBounceSettings } from "@/hooks/useSettings";
import {
  buildSmartLeadsExportPayload,
  buildSmartLeadsExportRows,
  defaultExportBasename,
  downloadBlob,
  exportRowsToCsv,
} from "@/lib/smart-leads-export";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const emptyAudience = (): SmartLeadsAudience => ({
  target_company: "",
  industry: "",
  geography: "",
  company_size: "",
  job_titles_or_roles: "",
  keywords: "",
  audience_notes: "",
  search_query_override: "",
});

function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function SmartLeadsClient() {
  const queryClient = useQueryClient();
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const { data: llmConfigs = [], isLoading: llmLoading } = useLLMConfigs(userId);
  const { data: serperSettings, isLoading: serperLoading } = useSerperSettings();
  const { data: zerobounceSettings, isLoading: zerobounceLoading } = useZeroBounceSettings();
  const { data: historyData, isLoading: historyLoading } = useSmartLeadsRuns(0, 50);
  const createRun = useCreateSmartLeadsRun();
  const continueRun = useContinueSmartLeadsRun();
  const stopRun = useStopSmartLeadsRun();

  const [audience, setAudience] = useState<SmartLeadsAudience>(emptyAudience);
  const [aiProvider, setAiProvider] = useState<string>("");
  const [maxEmails, setMaxEmails] = useState(100);
  /** How many Google-style result pages to fetch per search (company vs people). */
  const [companySearchPages, setCompanySearchPages] = useState(3);
  const [employeeSearchPages, setEmployeeSearchPages] = useState(3);
  /** User-configurable pipeline limits (see backend SmartLeadsRunCreateRequest). */
  const [companyQueries, setCompanyQueries] = useState(3);
  const [employeeQueriesPerCompany, setEmployeeQueriesPerCompany] = useState(3);
  const [maxPeoplePerCompany, setMaxPeoplePerCompany] = useState(12);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [sheetRunId, setSheetRunId] = useState<string | null>(null);
  /** Live progress panel collapsed by default; use Open to expand. */
  const [liveProgressOpen, setLiveProgressOpen] = useState(false);
  const [mainTab, setMainTab] = useState<"new" | "history">("new");
  const [continueTargetId, setContinueTargetId] = useState<string | null>(null);
  const [stopTargetId, setStopTargetId] = useState<string | null>(null);

  const { data: statusData } = useSmartLeadsRunStatus(activeRunId, true);
  const terminal =
    statusData?.status === "completed" ||
    statusData?.status === "failed" ||
    statusData?.status === "cancelled";
  const { data: activeDetail } = useSmartLeadsRunDetail(activeRunId, !!activeRunId && !!terminal);
  const { data: sheetDetail } = useSmartLeadsRunDetail(sheetRunId, !!sheetRunId);

  useEffect(() => {
    if (!llmConfigs.length) {
      setAiProvider("");
      return;
    }
    if (!aiProvider || !llmConfigs.some((c) => c.provider === aiProvider)) {
      setAiProvider(llmConfigs[0].provider);
    }
  }, [llmConfigs, aiProvider]);

  useEffect(() => {
    if (activeRunId && terminal) {
      queryClient.invalidateQueries({ queryKey: ["smart-leads", "runs"] });
      queryClient.invalidateQueries({ queryKey: ["smart-leads", "run", activeRunId] });
    }
  }, [activeRunId, terminal, queryClient]);

  const trimmedAudience = useMemo((): SmartLeadsAudience => {
    const trim = (s?: string) => (s && s.trim() ? s.trim() : undefined);
    return {
      target_company: trim(audience.target_company),
      industry: trim(audience.industry),
      geography: trim(audience.geography),
      company_size: trim(audience.company_size),
      job_titles_or_roles: trim(audience.job_titles_or_roles),
      keywords: trim(audience.keywords),
      audience_notes: trim(audience.audience_notes),
      search_query_override: trim(audience.search_query_override),
    };
  }, [audience]);

  const serperOk = serperSettings?.serper_configured === true;
  const zerobounceOk = zerobounceSettings?.zerobounce_configured === true;
  const canSubmit =
    !!userId &&
    serperOk &&
    llmConfigs.length > 0 &&
    !!aiProvider &&
    !createRun.isPending &&
    (trimmedAudience.search_query_override ||
      trimmedAudience.target_company ||
      trimmedAudience.industry ||
      trimmedAudience.job_titles_or_roles ||
      trimmedAudience.geography ||
      trimmedAudience.company_size ||
      trimmedAudience.keywords ||
      trimmedAudience.audience_notes);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiProvider) return;
    const positiveInt = (n: number, fallback: number) => Math.max(1, Math.round(Number(n)) || fallback);
    createRun.mutate(
      {
        ai_provider: aiProvider,
        audience: trimmedAudience,
        max_emails: positiveInt(maxEmails, 100),
        company_search_pages: positiveInt(companySearchPages, 3),
        employee_search_pages: positiveInt(employeeSearchPages, 3),
        company_queries: positiveInt(companyQueries, 3),
        employee_queries_per_company: positiveInt(employeeQueriesPerCompany, 3),
        max_people_per_company: positiveInt(maxPeoplePerCompany, 12),
      },
      {
        onSuccess: (res) => {
          setActiveRunId(res.run_id);
          setLiveProgressOpen(false);
        },
      }
    );
  };

  const progress = statusData?.progress_percent ?? 0;
  const runs = historyData?.runs ?? [];
  const canStopActiveRun =
    !!activeRunId && (statusData?.status === "running" || statusData?.status === "queued");

  return (
    <div className="space-y-8">
      {llmLoading || serperLoading || zerobounceLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : null}

      {llmConfigs.length === 0 ? (
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertTitle>Connect an AI provider</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>This tool needs an AI account (OpenAI, etc.). Add one under Settings → Integrations.</p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings?tab=integrations">Open Settings → Integrations</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!serperOk && llmConfigs.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Google search key required</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Smart Leads uses Google search behind the scenes. Add your API key from{" "}
              <a
                href="https://serper.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                serper.dev
              </a>{" "}
              in Settings → Integrations → Serper.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings?tab=integrations#serper">Add Google search key</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {serperOk && !zerobounceOk && llmConfigs.length > 0 ? (
        <Alert>
          <AlertTitle>ZeroBounce not configured (optional)</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Smart Leads runs without ZeroBounce, using syntax, MX, and spam-list checks only. Adding a{" "}
              <a
                href="https://www.zerobounce.net"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                ZeroBounce
              </a>{" "}
              key enables catch‑all detection and stronger mailbox verification (stored encrypted).
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings?tab=integrations#zerobounce">Add ZeroBounce key</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "new" | "history")} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="new">New search</TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-6 mt-6">
          <form onSubmit={handleStart} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="h-5 w-5" />
                  Who you want to reach
                </CardTitle>
                <CardDescription>
                  Tell us who you want to reach. We search Google the usual way, find companies and people, then AI
                  suggests work emails. We try to find people who could buy from you—things like industry lists, job
                  posts, or news—not pages that are mostly your competitors advertising. Use simple words (e.g. “B2B
                  fintech Series A in the US”). Do not ask for bulk email lists or a database download.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sl-company" className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      Company or site
                    </Label>
                    <Input
                      id="sl-company"
                      placeholder="e.g. Acme Corp or acme.com"
                      value={audience.target_company ?? ""}
                      onChange={(e) => setAudience((a) => ({ ...a, target_company: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sl-industry">Industry or type of business</Label>
                    <Input
                      id="sl-industry"
                      placeholder="e.g. B2B SaaS, fintech"
                      value={audience.industry ?? ""}
                      onChange={(e) => setAudience((a) => ({ ...a, industry: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sl-geo" className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      Location or region
                    </Label>
                    <Input
                      id="sl-geo"
                      placeholder="e.g. United States, DACH"
                      value={audience.geography ?? ""}
                      onChange={(e) => setAudience((a) => ({ ...a, geography: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sl-size">Company size</Label>
                    <Input
                      id="sl-size"
                      placeholder="e.g. 50–200 employees"
                      value={audience.company_size ?? ""}
                      onChange={(e) => setAudience((a) => ({ ...a, company_size: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="sl-roles" className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      Job titles to look for
                    </Label>
                    <Input
                      id="sl-roles"
                      placeholder="e.g. VP Marketing, Head of Growth"
                      value={audience.job_titles_or_roles ?? ""}
                      onChange={(e) => setAudience((a) => ({ ...a, job_titles_or_roles: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="sl-kw">Extra keywords (optional)</Label>
                    <Input
                      id="sl-kw"
                      placeholder="e.g. Shopify, Series A, outbound sales"
                      value={audience.keywords ?? ""}
                      onChange={(e) => setAudience((a) => ({ ...a, keywords: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="sl-notes">Notes (optional)</Label>
                    <Textarea
                      id="sl-notes"
                      placeholder="Anything else: tech stack, stage, pain points…"
                      rows={3}
                      value={audience.audience_notes ?? ""}
                      onChange={(e) => setAudience((a) => ({ ...a, audience_notes: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="sl-override" className="flex items-center gap-1.5">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      Special focus for searches (optional)
                    </Label>
                    <Input
                      id="sl-override"
                      placeholder="e.g. Only B2B fintech in India"
                      value={audience.search_query_override ?? ""}
                      onChange={(e) => setAudience((a) => ({ ...a, search_query_override: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Write this like something you’d type into Google—not “give me emails” or “download a lead list.”
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <p className="text-sm font-medium text-foreground">AI & limits</p>
                  <p className="text-xs text-muted-foreground -mt-2">
                    Optional numbers below control how wide we search. We keep up to 100 companies from the search
                    results automatically, and guess work emails per company (not one combined list). Defaults work for
                    most people.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 min-w-0">
                      <Label>AI to use</Label>
                      <Select value={aiProvider} onValueChange={setAiProvider} disabled={!llmConfigs.length}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose AI" />
                        </SelectTrigger>
                        <SelectContent>
                          {llmConfigs.map((c) => (
                            <SelectItem key={c.provider} value={c.provider}>
                              {c.provider}
                              {c.model_name ? ` (${c.model_name})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sl-max-emails">Max verified work emails to save</Label>
                      <Input
                        id="sl-max-emails"
                        type="number"
                        min={1}
                        value={maxEmails}
                        onChange={(e) => setMaxEmails(Number(e.target.value) || 100)}
                      />
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Cap per run on saved rows only: mailbox verified (not catch‑all) and ZeroBounce status valid
                        when configured. The pipeline may check more candidates that do not qualify.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="sl-n-co-q" className="leading-tight">
                        Different searches for companies
                      </Label>
                      <Input
                        id="sl-n-co-q"
                        type="number"
                        min={1}
                        value={companyQueries}
                        onChange={(e) => setCompanyQueries(Number(e.target.value) || 3)}
                      />
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        AI picks several Google-style queries biased toward customer-side results—not competitor roundup
                        pages. More searches = more angles (uses more search credits).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sl-n-emp-q" className="leading-tight">
                        Searches per company for people
                      </Label>
                      <Input
                        id="sl-n-emp-q"
                        type="number"
                        min={1}
                        value={employeeQueriesPerCompany}
                        onChange={(e) => setEmployeeQueriesPerCompany(Number(e.target.value) || 3)}
                      />
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        For each company, how many different people-finding searches we run.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sl-max-ppl" className="leading-tight">
                        People to pull from each company
                      </Label>
                      <Input
                        id="sl-max-ppl"
                        type="number"
                        min={1}
                        value={maxPeoplePerCompany}
                        onChange={(e) => setMaxPeoplePerCompany(Number(e.target.value) || 12)}
                      />
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Rough cap on contacts saved per company after we read the search results. Email guesses run per
                        company (not one giant list).
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="sl-co-pages" className="leading-tight">
                        Result pages per company search
                      </Label>
                      <Input
                        id="sl-co-pages"
                        type="number"
                        min={1}
                        title="Each extra page is more Google results for that search"
                        value={companySearchPages}
                        onChange={(e) => setCompanySearchPages(Number(e.target.value) || 3)}
                      />
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Each page is another screen of Google-style results (uses more search credits).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sl-emp-pages" className="leading-tight">
                        Result pages per people search
                      </Label>
                      <Input
                        id="sl-emp-pages"
                        type="number"
                        min={1}
                        title="Each extra page is more Google results when finding people"
                        value={employeeSearchPages}
                        onChange={(e) => setEmployeeSearchPages(Number(e.target.value) || 3)}
                      />
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Same idea: more pages = deeper scroll through results for each people search.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t pt-4">
                  {!canSubmit && llmConfigs.length > 0 && serperOk && (
                    <p className="text-xs text-muted-foreground">
                      Add at least one detail above about who you want to reach to start.
                    </p>
                  )}
                  <div className="flex justify-end">
                    <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto sm:min-w-[220px]">
                      {createRun.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Starting…
                        </>
                      ) : (
                        <>
                          <Globe className="h-4 w-4 mr-2" />
                          Start search
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </form>

          {activeRunId && statusData && (
            <Collapsible open={liveProgressOpen} onOpenChange={setLiveProgressOpen}>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                  <div className="space-y-1 min-w-0 flex-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {terminal && statusData.status === "completed" ? (
                        <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                      ) : terminal && statusData.status === "failed" ? (
                        <XCircle className="h-5 w-5 text-destructive shrink-0" />
                      ) : (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
                      )}
                      Progress
                    </CardTitle>
                    <CardDescription className="font-mono text-xs break-all">Run reference: {activeRunId}</CardDescription>
                    {!liveProgressOpen ? (
                      <p className="text-sm text-muted-foreground pt-1 line-clamp-2">
                        <span className="font-medium text-foreground">{statusData.status}</span>
                        {statusData.stage ? ` · ${statusData.stage}` : ""}
                        {statusData.stage_detail ? ` — ${statusData.stage_detail}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canStopActiveRun ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={stopRun.isPending}
                        onClick={() => {
                          if (!activeRunId) return;
                          setStopTargetId(activeRunId);
                          stopRun.mutate(activeRunId, {
                            onSettled: () => setStopTargetId(null),
                          });
                        }}
                      >
                        {stopRun.isPending && stopTargetId === activeRunId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
                        ) : (
                          <Square className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                        <span className="ml-1">Stop</span>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setLiveProgressOpen((o) => !o)}
                    >
                      {liveProgressOpen ? "Close" : "Open"}
                    </Button>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="space-y-4 pt-0">
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Badge variant="secondary">{statusData.status}</Badge>
                      {statusData.stage ? <Badge variant="outline">{statusData.stage}</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{statusData.stage_detail || "—"}</p>
                    <Progress value={Math.min(100, Math.max(0, progress))} className="h-2" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Companies</span>
                        <p className="font-medium">{statusData.stats?.companies ?? 0}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">People</span>
                        <p className="font-medium">{statusData.stats?.people ?? 0}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Emails</span>
                        <p className="font-medium">{statusData.stats?.emails ?? 0}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Verified inboxes</span>
                        <p className="font-medium">{statusData.stats?.mx_ok ?? 0}</p>
                      </div>
                    </div>
                    {statusData.error ? (
                      <Alert variant="destructive">
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{statusData.error}</AlertDescription>
                      </Alert>
                    ) : null}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {activeRunId && terminal && activeDetail && statusData?.status === "completed" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Results</CardTitle>
                <CardDescription>
                  Companies, people, and suggested emails from this run. Use Create contact list to save them to
                  Contacts.
                  {(activeDetail.run.company_search_pages != null ||
                    activeDetail.run.employee_search_pages != null ||
                    activeDetail.run.company_queries != null) && (
                    <span className="block mt-1 text-xs space-y-0.5">
                      <span className="block">
                        Settings: {activeDetail.run.company_queries ?? "—"} company searches ·{" "}
                        {activeDetail.run.employee_queries_per_company ?? "—"} people searches per company · up to{" "}
                        {activeDetail.run.max_people_per_company ?? "—"} people saved per company
                      </span>
                      <span className="block">
                        Result pages: {activeDetail.run.company_search_pages ?? "—"} per company search ·{" "}
                        {activeDetail.run.employee_search_pages ?? "—"} per people search. Work emails were guessed per
                        company (not one combined list).
                      </span>
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RunResults detail={activeDetail} userId={userId} />
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Past runs</CardTitle>
              <CardDescription>
                Runs that are still going update every few seconds so you can see what they’re doing. Open a run for
                full results.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading history…
                </div>
              ) : runs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No runs yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="min-w-[200px]">What’s happening</TableHead>
                      <TableHead className="text-right">Companies</TableHead>
                      <TableHead className="text-right">People</TableHead>
                      <TableHead className="text-right">Emails</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => {
                      const active = r.status === "running" || r.status === "queued" || r.status === "cancelling";
                      const activityText = (r.stage_detail || r.stage || "").trim() || "—";
                      const progress =
                        typeof r.progress_percent === "number" && !Number.isNaN(r.progress_percent)
                          ? Math.min(100, Math.max(0, r.progress_percent))
                          : null;
                      return (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm whitespace-nowrap">{formatWhen(r.created_at)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
                            {active ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" aria-hidden />
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-xs align-top",
                            active
                              ? "min-w-[220px] max-w-[min(100%,380px)] text-muted-foreground"
                              : "max-w-[240px] truncate text-muted-foreground",
                          )}
                          title={!active ? activityText : undefined}
                        >
                          {active ? (
                            <div className="space-y-2 py-0.5">
                              {r.stage ? (
                                <Badge variant="outline" className="text-[10px] font-normal">
                                  {r.stage}
                                </Badge>
                              ) : null}
                              <p className="text-foreground leading-snug break-words">
                                {r.stage_detail || r.stage || "Starting…"}
                              </p>
                              {progress !== null ? (
                                <div className="space-y-1">
                                  <Progress value={progress} className="h-1.5" />
                                  <p className="text-[10px] text-muted-foreground">{progress}% complete</p>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            activityText
                          )}
                        </TableCell>
                        <TableCell className="text-right">{r.stats?.companies ?? 0}</TableCell>
                        <TableCell className="text-right">{r.stats?.people ?? 0}</TableCell>
                        <TableCell className="text-right">{r.stats?.emails ?? 0}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {r.status === "failed" ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="gap-1.5"
                                disabled={continueRun.isPending}
                                onClick={() => {
                                  setContinueTargetId(r.id);
                                  continueRun.mutate(r.id, {
                                    onSettled: () => setContinueTargetId(null),
                                    onSuccess: () => {
                                      setActiveRunId(r.id);
                                      setLiveProgressOpen(true);
                                      setMainTab("new");
                                    },
                                  });
                                }}
                              >
                                {continueRun.isPending && continueTargetId === r.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
                                ) : null}
                                Continue
                              </Button>
                            ) : null}
                            {r.status === "running" || r.status === "queued" ? (
                              <Button
                                variant="destructive"
                                size="sm"
                                className="gap-1.5"
                                disabled={stopRun.isPending}
                                onClick={() => {
                                  setStopTargetId(r.id);
                                  stopRun.mutate(r.id, {
                                    onSettled: () => setStopTargetId(null),
                                  });
                                }}
                              >
                                {stopRun.isPending && stopTargetId === r.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
                                ) : (
                                  <Square className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                )}
                                Stop
                              </Button>
                            ) : null}
                            <Button variant="ghost" size="sm" onClick={() => setSheetRunId(r.id)}>
                              View
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Sheet open={!!sheetRunId} onOpenChange={(o) => !o && setSheetRunId(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Search run details</SheetTitle>
            <SheetDescription>{sheetRunId}</SheetDescription>
          </SheetHeader>
          {sheetDetail ? <RunResults detail={sheetDetail} userId={userId} className="mt-6" /> : sheetRunId ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function firstNameFromFullName(fullName?: string | null) {
  const s = (fullName || "").trim();
  if (!s) return "Contact";
  return s.split(/\s+/)[0] || "Contact";
}

function CreateContactListFromEmailsButton({ userId, emails }: { userId: string; emails: SmartLeadsEmailRow[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [listName, setListName] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const rows = emails.map((e) => ({
        email: e.email,
        first_name: firstNameFromFullName(e.full_name),
        company: (e.company_name || "").trim() || "—",
      }));
      const name =
        listName.trim() ||
        `Smart Leads ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
      return api.contacts.save(userId, rows, { email: "email", first_name: "first_name", company: "company" }, name);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["contacts", userId] });
      queryClient.invalidateQueries({ queryKey: ["contact-lists", userId] });
      toast.success(data.message || "Contacts saved to your list.");
      setOpen(false);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to save contacts");
    },
  });

  if (!userId || emails.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="sm"
        className="gap-2 shrink-0"
        onClick={() => {
          setListName(`Smart Leads — ${new Date().toLocaleString()}`);
          setOpen(true);
        }}
      >
        <ListPlus className="h-4 w-4" />
        Create contact list
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create contact list</DialogTitle>
            <DialogDescription>
              Adds {emails.length} contact{emails.length === 1 ? "" : "s"} with email, first name, and company (from
              this run). Existing contacts are updated by email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="sl-list-name">List name</Label>
            <Input
              id="sl-list-name"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="e.g. Smart Leads — Acme outreach"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                "Create list"
              )}
            </Button>
          </DialogFooter>
          <p className="text-xs text-muted-foreground">
            View contacts under{" "}
            <Link href="/contacts" className="text-primary underline underline-offset-2">
              All contacts
            </Link>
            .
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

const AUDIENCE_FIELD_META: { key: keyof SmartLeadsAudience; label: string }[] = [
  { key: "target_company", label: "Company or site" },
  { key: "industry", label: "Industry or type of business" },
  { key: "geography", label: "Location or region" },
  { key: "company_size", label: "Company size" },
  { key: "job_titles_or_roles", label: "Job titles to look for" },
  { key: "keywords", label: "Extra keywords" },
  { key: "audience_notes", label: "Notes" },
  { key: "search_query_override", label: "Special focus for searches" },
];

function audienceEntries(audience: SmartLeadsAudience | undefined) {
  if (!audience) return [];
  return AUDIENCE_FIELD_META.map(({ key, label }) => {
    const raw = audience[key];
    const v = typeof raw === "string" ? raw.trim() : "";
    return v ? { label, value: v } : null;
  }).filter(Boolean) as { label: string; value: string }[];
}

function SmartLeadsExportButtons({ detail }: { detail: SmartLeadsRunDetailResponse }) {
  const runId = detail.run.id || "run";
  const base = defaultExportBasename(runId);
  const hasData =
    detail.companies.length > 0 || detail.people.length > 0 || detail.emails.length > 0;

  const onCsv = () => {
    const rows = buildSmartLeadsExportRows(detail);
    const csv = exportRowsToCsv(rows);
    downloadBlob(`${base}.csv`, csv, "text/csv;charset=utf-8");
    toast.success(`Downloaded ${base}.csv (${rows.length} row${rows.length === 1 ? "" : "s"})`);
  };

  const onJson = () => {
    const payload = buildSmartLeadsExportPayload(detail);
    const json = JSON.stringify(payload, null, 2);
    downloadBlob(`${base}.json`, json, "application/json;charset=utf-8");
    toast.success(`Downloaded ${base}.json`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="gap-2" disabled={!hasData} onClick={onCsv}>
        <Download className="h-4 w-4" />
        Export CSV
      </Button>
      <Button type="button" variant="outline" size="sm" className="gap-2" disabled={!hasData} onClick={onJson}>
        <Download className="h-4 w-4" />
        Export JSON
      </Button>
      {!hasData ? (
        <span className="text-xs text-muted-foreground">Nothing to export yet.</span>
      ) : (
        <span className="text-xs text-muted-foreground">Companies, people (LinkedIn), and work emails.</span>
      )}
    </div>
  );
}

function RunResults({
  detail,
  userId,
  className,
}: {
  detail: SmartLeadsRunDetailResponse;
  userId: string;
  className?: string;
}) {
  const [audienceDialogOpen, setAudienceDialogOpen] = useState(false);
  const { companies, people, emails } = detail;
  const companyEmailRows = useMemo(() => {
    const rows: { key: string; email: string; companyName: string }[] = [];
    const seen = new Set<string>();
    for (const c of companies) {
      const companyName = (c.name || "").trim() || "—";
      const list = Array.isArray(c.company_emails) ? c.company_emails : [];
      for (const email of list) {
        const normalized = (email || "").trim().toLowerCase();
        if (!normalized) continue;
        const dedupeKey = `${companyName.toLowerCase()}|${normalized}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        rows.push({
          key: `${c.id}:${normalized}`,
          email: normalized,
          companyName,
        });
      }
    }
    return rows;
  }, [companies]);
  const audience = detail.run.audience;
  const audienceRows = audienceEntries(audience);

  return (
    <div className={`space-y-6 ${className ?? ""}`}>
      <div className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 min-w-0">
            <Target className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Who you wanted to reach</p>
              <p className="text-xs text-muted-foreground">
                {audienceRows.length > 0
                  ? `${audienceRows.length} detail${audienceRows.length === 1 ? "" : "s"} from when you started this run`
                  : "No details were saved, or everything was left blank."}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-2"
            onClick={() => setAudienceDialogOpen(true)}
          >
            <Eye className="h-3.5 w-3.5" />
            View details
          </Button>
        </div>
        <SmartLeadsExportButtons detail={detail} />
      </div>

      <Dialog open={audienceDialogOpen} onOpenChange={setAudienceDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Who you wanted to reach
            </DialogTitle>
            <DialogDescription>
              The same details you entered when you started this run.
            </DialogDescription>
          </DialogHeader>
          {audienceRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No audience fields were saved for this run, or they were left empty.
            </p>
          ) : (
            <dl className="space-y-3 text-sm">
              {audienceRows.map((row) => (
                <div key={row.label}>
                  <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <DialogFooter className="sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setAudienceDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Companies ({companies.length})
        </h3>
        {companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No companies saved for this run.</p>
        ) : (
          <ul className="space-y-2">
            {companies.map((c) => (
              <li key={c.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{c.name || "—"}</p>
                {c.linkedin_url ? (
                  <a
                    href={c.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary text-xs inline-flex items-center gap-1 break-all"
                  >
                    {c.linkedin_url}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : null}
                {c.snippet ? <p className="text-muted-foreground text-xs mt-1">{c.snippet}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Users className="h-4 w-4" />
          People ({people.length})
        </h3>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">No people were found from the searches.</p>
        ) : (
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {people.map((p) => (
              <li key={p.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{p.full_name || "—"}</p>
                <p className="text-xs text-muted-foreground">{p.title || "—"} · {p.company_name || ""}</p>
                {p.linkedin_url ? (
                  <a
                    href={p.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary text-xs inline-flex items-center gap-1 break-all"
                  >
                    {p.linkedin_url}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Company emails ({companyEmailRows.length})
        </h3>
        {companyEmailRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No company contact emails were extracted from search hints for this run.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companyEmailRows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-mono text-xs">{row.email}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate">
                    {row.companyName}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Suggested work emails ({emails.length})
          </h3>
          <CreateContactListFromEmailsButton userId={userId} emails={emails} />
        </div>
        {emails.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No emails were saved. Smart Leads prioritizes mailboxes passing basic checks (syntax, MX, spam list).
            When ZeroBounce is configured, only addresses with ZeroBounce status{" "}
            <span className="font-medium text-foreground/90">valid</span> are saved; catch‑all addresses may also
            appear as risky fallbacks.
          </p>
        ) : (
          <div className="text-xs text-muted-foreground mb-2 space-y-2">
            <p>
              Saved rows passed syntax, MX record, and StopForumSpam checks. When ZeroBounce is configured, strong
              rows include ZeroBounce status{" "}
              <span className="font-medium text-foreground/90">valid</span>; catch‑all rows may also appear and are
              marked as risky.
            </p>
          </div>
        )}
        {emails.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>First name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Check</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emails.map((row) => {
                const v = row.validation;
                const catchAll = Boolean(v?.catch_all);
                const strong = v?.mailbox_verified_strong === true;
                return (
                <TableRow key={row.id}>
                  <TableCell className="text-sm">{firstNameFromFullName(row.full_name)}</TableCell>
                  <TableCell className="font-mono text-xs">{row.email}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                    {row.company_name || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {strong ? (
                      <Badge className="bg-success/15 text-success border-success/30">Verified</Badge>
                    ) : catchAll ? (
                      <Badge
                        variant="outline"
                        className="text-orange-800 border-orange-500/45 bg-orange-500/10"
                      >
                        Catch‑all / risky
                      </Badge>
                    ) : (
                      <Badge variant="secondary">MX OK</Badge>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </div>
  );
}
