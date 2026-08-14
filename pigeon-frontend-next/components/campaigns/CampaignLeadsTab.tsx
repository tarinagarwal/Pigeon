"use client";

import { useMemo, useState } from "react";
import { Building2, Download, Loader2, Phone, Search, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useCampaignLeads, useUpdateCampaignLeadTracker } from "@/hooks/useCampaigns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  campaignId: string;
};

type LeadTrackerStatus =
  | "new"
  | "contacted"
  | "in_progress"
  | "follow_up"
  | "qualified"
  | "disqualified";

const DEFAULT_TRACKER_STATUS: LeadTrackerStatus = "new";
const TRACKER_STATUS_LABELS: Record<LeadTrackerStatus, string> = {
  new: "New",
  contacted: "Contacted",
  in_progress: "In Progress",
  follow_up: "Follow Up",
  qualified: "Qualified",
  disqualified: "Disqualified",
};

const NON_COMPANY_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "google.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "aol.com",
  "msn.com",
  "proton.me",
  "protonmail.com",
]);

function normalizeDomain(input?: string | null): string | null {
  const value = (input || "").trim().toLowerCase();
  if (!value) return null;
  const withoutProtocol = value.replace(/^https?:\/\//, "");
  const host = withoutProtocol.split("/")[0].replace(/^www\./, "");
  return host || null;
}

export function CampaignLeadsTab({ campaignId }: Props) {
  const [search, setSearch] = useState("");
  const [trackerStatusFilter, setTrackerStatusFilter] = useState<"all" | LeadTrackerStatus>("all");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const { data, isLoading, isFetching } = useCampaignLeads(campaignId, { limit: 200, search: search.trim() || undefined });
  const updateLeadTracker = useUpdateCampaignLeadTracker(campaignId);
  const leads = data?.leads ?? [];

  const updateLeadStatus = (leadId: string, status: LeadTrackerStatus) => {
    updateLeadTracker.mutate({
      leadId,
      data: { tracker_status: status },
    });
  };

  const updateLeadNote = (leadId: string) => {
    const note = noteDrafts[leadId] ?? "";
    updateLeadTracker.mutate({
      leadId,
      data: { tracker_note: note },
    });
  };

  const rows = useMemo(() => {
    return leads.filter((lead) => {
      if (trackerStatusFilter === "all") return true;
      const currentStatus = (lead.tracker_status as LeadTrackerStatus | undefined) ?? DEFAULT_TRACKER_STATUS;
      return currentStatus === trackerStatusFilter;
    });
  }, [leads, trackerStatusFilter]);

  const handleExportCsv = () => {
    const csvEscape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const headers = [
      "Person",
      "LinkedIn",
      "Company",
      "Company Domain",
      "Company Phone",
      "Summary",
      "Tracker Status",
      "Tracker Note",
      "Lead Created",
      "Tracker Updated",
    ];

    const lines = [headers.map(csvEscape).join(",")];
    for (const lead of rows) {
      const leadObj = lead.lead_object ?? {};
      const person = leadObj.person_name || "Unknown";
      const company = leadObj.company_name || lead.query_context?.company || "Unknown";
      const linkedin = leadObj.person_linkedin_url || "";
      const phone = leadObj.company_phone || "";
      const websiteDomain = normalizeDomain(leadObj.company_website_url);
      const fallbackDomain = normalizeDomain(leadObj.company_domain);
      const companySubtext =
        websiteDomain ||
        (fallbackDomain && !NON_COMPANY_DOMAINS.has(fallbackDomain) ? fallbackDomain : "");
      const summary = lead.compacted_facts || leadObj.company_summary || "";
      const status = TRACKER_STATUS_LABELS[(lead.tracker_status as LeadTrackerStatus | undefined) ?? DEFAULT_TRACKER_STATUS];
      const note = noteDrafts[lead.id] ?? lead.tracker_note ?? "";
      const created = lead.created_at ? new Date(lead.created_at).toISOString() : "";
      const updated = lead.tracker_updated_at ? new Date(lead.tracker_updated_at).toISOString() : "";

      lines.push(
        [
          person,
          linkedin,
          company,
          companySubtext,
          phone,
          summary,
          status,
          note,
          created,
          updated,
        ]
          .map((v) => csvEscape(String(v)))
          .join(","),
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `campaign-${campaignId}-lead-tracker.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg font-medium">Enriched leads</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{rows.length}</Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={handleExportCsv}
              disabled={rows.length === 0}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export CSV
            </Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by person, company, or domain..."
              className="pl-9"
            />
          </div>
          <Select
            value={trackerStatusFilter}
            onValueChange={(v) => setTrackerStatusFilter(v as "all" | LeadTrackerStatus)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(TRACKER_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading leads...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-sm text-muted-foreground text-center">
            No enriched leads found for this campaign yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>LinkedIn</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Company Phone</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Tracker Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((lead) => {
                const leadObj = lead.lead_object ?? {};
                const person = leadObj.person_name || "Unknown";
                const company = leadObj.company_name || lead.query_context?.company || "Unknown";
                const linkedin = leadObj.person_linkedin_url;
                const phone = leadObj.company_phone;
                const phoneExtension =
                  leadObj.company_phone_extension || leadObj.phone_extension || leadObj.extension;
                const displayPhone = phone
                  ? phoneExtension && !/\b(?:ext\.?|extension|x)\s*[:\-]?\s*\d{1,6}\b/i.test(phone)
                    ? `${phone} ext ${phoneExtension}`
                    : phone
                  : "—";
                const websiteDomain = normalizeDomain(leadObj.company_website_url);
                const fallbackDomain = normalizeDomain(leadObj.company_domain);
                const companySubtext =
                  websiteDomain ||
                  (fallbackDomain && !NON_COMPANY_DOMAINS.has(fallbackDomain) ? fallbackDomain : null);
                const summary = (lead.compacted_facts || leadObj.company_summary || "").slice(0, 180);
                const currentStatus = (lead.tracker_status as LeadTrackerStatus | undefined) ?? DEFAULT_TRACKER_STATUS;
                const currentNote = noteDrafts[lead.id] ?? lead.tracker_note ?? "";
                return (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <User className="h-4 w-4 mt-0.5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{person}</p>
                          <p className="text-xs text-muted-foreground">{leadObj.job_title || "—"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {linkedin ? (
                        <Button asChild variant="link" className="h-auto p-0">
                          <a href={linkedin} target="_blank" rel="noreferrer">
                            Profile
                          </a>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground" />
                        <div>
                          <p>{company}</p>
                          <p className="text-xs text-muted-foreground">{companySubtext || "—"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{displayPhone}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                      {summary || "—"}
                    </TableCell>
                    <TableCell className="min-w-[160px]">
                      <Select
                        value={currentStatus}
                        onValueChange={(v) => updateLeadStatus(lead.id, v as LeadTrackerStatus)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(TRACKER_STATUS_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="min-w-[260px]">
                      <Textarea
                        value={currentNote}
                        onChange={(e) =>
                          setNoteDrafts((prev) => ({ ...prev, [lead.id]: e.target.value }))
                        }
                        onBlur={() => updateLeadNote(lead.id)}
                        placeholder="Add note..."
                        className="min-h-[66px] resize-y text-xs"
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {lead.created_at ? new Date(lead.created_at).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {isFetching && !isLoading && (
          <p className="mt-3 text-xs text-muted-foreground">Refreshing...</p>
        )}
      </CardContent>
    </Card>
  );
}
