"use client";

import { useState, useEffect, Fragment, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  CheckCircle,
  XCircle,
  RefreshCw,
  Copy,
  Shield,
  Trash2,
  Clock,
  MessageSquare,
  Info,
  MoreVertical,
  CornerDownRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDomains, useVerifyDomain, useDNSRecords } from "@/hooks/useDomains";
import { useInboxes } from "@/hooks/useInboxes";
import { AddDomainDialog } from "@/components/AddDomainDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { useCreateTicket } from "@/hooks/useTickets";
import { useSettings } from "@/hooks/useSettings";
import { HealthScoreTooltip } from "@/components/HealthScoreTooltip";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Domain, DNSRecords, DNSProviderConnection } from "@/types/api";
import { usePlanGate } from "@/hooks/usePlanGate";
import { PremiumBadge } from "@/components/PremiumBadge";
import { HelpLinks } from "@/components/HelpLinks";
import { AppPageShell } from "@/components/AppPageShell";
import { EmptyState } from "@/components/EmptyState";
import { Listen } from "@/components/Listen";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

type BulkSubdomainLiveJob = {
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed";
  total_count?: number;
  processed_count?: number;
  created_count: number;
  pending_count?: number;
  failed_count: number;
  skipped_count: number;
  results: Array<{ error?: string }>;
};

/** MX record "Name" at the DNS zone for SendGrid inbound: @ for apex; for subdomains, the host under the registrable apex (e.g. `cloud` for `cloud.example.com`). */
function getReceivingMxDnsRecordName(fqdn: string): string {
  const labels = fqdn
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  if (labels.length <= 2) return "@";
  return labels.slice(0, -2).join(".");
}

/** Default left label for custom tracking subdomain when none is stored (e.g. `cloud.example.com`). */
const DEFAULT_TRACKING_SUBDOMAIN_LABEL = "cloud";

/** Last two labels (e.g. pigeon.com) — same heuristic as elsewhere in the app. */
function getRegistrableApexDomain(fqdn: string): string {
  const labels = fqdn
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  return labels.slice(-2).join(".");
}

/**
 * CNAME "Name" / Host at the **registrable** DNS zone (e.g. pigeon.com).
 * For apex `example.com` + prefix `cloud` → `cloud`.
 * For `cloud.pigeon.com` + `center` → `center.cloud` (full host `center.cloud.pigeon.com`).
 */
function getTrackingCnameDnsRecordName(hostDomain: string, leftLabel: string): string {
  const prefix = (leftLabel || DEFAULT_TRACKING_SUBDOMAIN_LABEL).trim().toLowerCase().replace(/\.$/, "");
  const labels = hostDomain
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  if (labels.length <= 2) return prefix;
  const beforeApex = labels.slice(0, -2);
  if (beforeApex.length === 0) return prefix;
  return `${prefix}.${beforeApex.join(".")}`;
}

// Suggested random subdomain prefixes for custom tracking domains.
// Only the left-most part is editable; we append `.{selectedDomain.domain}` server-side.
const TRACKING_SUBDOMAIN_PICKER: string[] = [
  "go",
  "links",
  "visit",
  "access",
  "view",
  "explore",
  "connect",
  "discover",
  "start",
  "app",
  "portal",
  "hub",
  "dashboard",
  "client",
  "workspace",
  "account",
  "center",
  "home",
  "info",
  "direct",
];

const BULK_SUBDOMAIN_RANDOM_POOL: string[] = [
  "sales",
  "team",
  "contact",
  "growth",
  "partners",
  "success",
  "connect",
  "network",
  "outreach",
  "hello",
  "app",
  "portal",
  "dashboard",
  "workspace",
  "system",
  "platform",
  "console",
  "cloud",
  "core",
  "engine",
  "support",
  "help",
  "service",
  "assist",
  "care",
  "client",
  "customer",
  "relations",
  "experience",
  "desk",
  "teamhub",
  "growthhub",
  "connecthub",
  "clienthub",
  "partnerhub",
  "node",
  "node1",
  "node2",
  "hub",
  "hub1",
  "hub2",
  "core1",
  "core2",
  "grid",
  "grid1",
  "grid2",
  "alpha",
  "beta",
  "prime",
  "edge",
];

/** Max direct subdomains per parent domain (total), and max per bulk-create batch. */
const BULK_SUBDOMAIN_MAX_COUNT = 5;

export default function DomainsPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const confirmDialog = useConfirmDialog();
  const { data: settings } = useSettings();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: domains = [], isLoading: domainsLoading, refetch: refetchDomains } = useDomains();
  const { data: inboxes = [], isLoading: inboxesLoading } = useInboxes(userId);
  const verifyDomain = useVerifyDomain();
  const createTicket = useCreateTicket();
  const domainGate = usePlanGate("domains");

  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DNSRecords | null>(null);
  const [verifyingDomainId, setVerifyingDomainId] = useState<string | null>(null);
  const [syncingDomainId, setSyncingDomainId] = useState<string | null>(null);
  const [enablingReceivingDomainId, setEnablingReceivingDomainId] = useState<string | null>(null);
  const [disablingReceivingDomainId, setDisablingReceivingDomainId] = useState<string | null>(null);
  const [testingDomainId, setTestingDomainId] = useState<string | null>(null);
  const [mailTestDialogOpen, setMailTestDialogOpen] = useState(false);
  const [mailTestResult, setMailTestResult] = useState<{
    domain: string;
    senderEmail?: string;
    recipientEmail?: string;
    recipientSource?: "connected_gmail" | "backend_receiver_pool";
    senderOk: boolean;
    recipientOk: boolean;
    receiveStatus: "idle" | "pending" | "success" | "failed";
    receiveMessage: string;
    reverseEnabled?: boolean;
    reverseStatus?: "idle" | "pending" | "success" | "failed";
    reverseMessage?: string;
  } | null>(null);
  const [enableReceivingDialogDomain, setEnableReceivingDialogDomain] = useState<Domain | null>(null);
  const [trackingDomainDialogDomain, setTrackingDomainDialogDomain] = useState<Domain | null>(null);
  const [bulkSubdomainDialogDomain, setBulkSubdomainDialogDomain] = useState<Domain | null>(null);
  const [bulkSubdomainCount, setBulkSubdomainCount] = useState(BULK_SUBDOMAIN_MAX_COUNT);
  const [bulkSubdomainSelections, setBulkSubdomainSelections] = useState<string[]>([]);
  const [creatingBulkSubdomains, setCreatingBulkSubdomains] = useState(false);
  const [bulkSubdomainLiveJob, setBulkSubdomainLiveJob] = useState<BulkSubdomainLiveJob | null>(null);
  const creatingBulkSubdomainsRef = useRef(false);
  const [loadingDnsRecords, setLoadingDnsRecords] = useState(false);
  const [creatingEmailInfraDomainId, setCreatingEmailInfraDomainId] = useState<string | null>(null);
  const [deletingEmailInfraDomainId, setDeletingEmailInfraDomainId] = useState<string | null>(null);
  const [settingSendingProviderDomainId, setSettingSendingProviderDomainId] = useState<string | null>(null);
  const [trackingSubdomainInput, setTrackingSubdomainInput] = useState("");
  const [savingTrackingDomainId, setSavingTrackingDomainId] = useState<string | null>(null);
  const [verifyingTrackingDomainId, setVerifyingTrackingDomainId] = useState<string | null>(null);
  const [disablingTrackingDomainId, setDisablingTrackingDomainId] = useState<string | null>(null);
  const [dnsProviderDialogOpen, setDnsProviderDialogOpen] = useState(false);
  const [dnsProvider, setDnsProvider] = useState<DNSProviderConnection["provider"]>("cloudflare");
  const [dnsProviderCredentials, setDnsProviderCredentials] = useState<Record<string, string>>({});
  const [dnsProviderConnections, setDnsProviderConnections] = useState<DNSProviderConnection[]>([]);
  const [savingDnsProvider, setSavingDnsProvider] = useState(false);
  const [disconnectingDnsProvider, setDisconnectingDnsProvider] = useState(false);
  const [autoSetupDomainId, setAutoSetupDomainId] = useState<string | null>(null);
  const [domainSearchQuery, setDomainSearchQuery] = useState("");

  const selectedDomainId = selectedDomain?.id || "";
  const { data: dnsData, isLoading: isDnsLoading } = useDNSRecords(selectedDomainId);

  /** Direct child domains per registered parent (same parent resolution as the domain tree). */
  const subdomainCountByParentId = useMemo(() => {
    const normalize = (value: string) => value.trim().toLowerCase().replace(/\.$/, "");
    const byName = new Map<string, Domain>();
    domains.forEach((d) => {
      byName.set(normalize(d.domain), d);
    });

    const resolveParent = (domainName: string): Domain | null => {
      const parts = normalize(domainName).split(".");
      if (parts.length < 3) return null;
      for (let i = 1; i < parts.length - 1; i += 1) {
        const candidate = parts.slice(i).join(".");
        const found = byName.get(candidate);
        if (found) return found;
      }
      return null;
    };

    const countByParentId = new Map<string, number>();
    for (const d of domains) {
      const parent = resolveParent(d.domain);
      if (parent) {
        countByParentId.set(parent.id, (countByParentId.get(parent.id) ?? 0) + 1);
      }
    }
    return countByParentId;
  }, [domains]);

  /** Slots left under per-domain cap while bulk dialog is open. */
  const bulkSubdomainRemainingSlots = useMemo(() => {
    if (!bulkSubdomainDialogDomain) return 0;
    const existing = subdomainCountByParentId.get(bulkSubdomainDialogDomain.id) ?? 0;
    return Math.max(0, BULK_SUBDOMAIN_MAX_COUNT - existing);
  }, [bulkSubdomainDialogDomain, subdomainCountByParentId]);

  const receivingMxRecord = useMemo(() => {
    const d = enableReceivingDialogDomain?.domain;
    return {
      type: "MX" as const,
      name: d ? getReceivingMxDnsRecordName(d) : "@",
      value: "mx.sendgrid.net",
      priority: "10",
    };
  }, [enableReceivingDialogDomain]);

  const orderedDomainRows = useMemo(() => {
    const normalize = (value: string) => value.trim().toLowerCase().replace(/\.$/, "");
    const byName = new Map<string, Domain>();
    const indexById = new Map<string, number>();
    domains.forEach((d, idx) => {
      byName.set(normalize(d.domain), d);
      indexById.set(d.id, idx);
    });

    const parentById = new Map<string, string | null>();
    const childrenByParentId = new Map<string, Domain[]>();

    const resolveParent = (domainName: string): Domain | null => {
      const parts = normalize(domainName).split(".");
      if (parts.length < 3) return null;
      for (let i = 1; i < parts.length - 1; i += 1) {
        const candidate = parts.slice(i).join(".");
        const found = byName.get(candidate);
        if (found) return found;
      }
      return null;
    };

    for (const d of domains) {
      const parent = resolveParent(d.domain);
      parentById.set(d.id, parent?.id ?? null);
      if (parent) {
        const list = childrenByParentId.get(parent.id) ?? [];
        list.push(d);
        childrenByParentId.set(parent.id, list);
      }
    }

    const rows: Array<{ domain: Domain; parentDomain: string | null; isChild: boolean }> = [];
    const visited = new Set<string>();

    const appendTree = (node: Domain) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      const parentId = parentById.get(node.id) ?? null;
      const parentDomain = parentId ? domains.find((d) => d.id === parentId)?.domain ?? null : null;
      rows.push({ domain: node, parentDomain, isChild: Boolean(parentId) });

      const children = (childrenByParentId.get(node.id) ?? []).sort(
        (a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0)
      );
      children.forEach(appendTree);
    };

    const roots = domains.filter((d) => !parentById.get(d.id));
    roots.forEach(appendTree);

    // Safety fallback for any orphaned edge-cases.
    domains.forEach(appendTree);
    return rows;
  }, [domains]);

  const filteredDomainRows = useMemo(() => {
    const q = domainSearchQuery.trim().toLowerCase();
    if (!q) return orderedDomainRows;
    return orderedDomainRows.filter((row) => {
      const domainName = (row.domain.domain || "").toLowerCase();
      const status = (row.domain.status || "").toLowerCase();
      const parentDomain = (row.parentDomain || "").toLowerCase();
      return domainName.includes(q) || status.includes(q) || parentDomain.includes(q);
    });
  }, [orderedDomainRows, domainSearchQuery]);

  useEffect(() => {
    setLoadingDnsRecords(isDnsLoading);
  }, [isDnsLoading]);

  useEffect(() => {
    if (dnsData) setDnsRecords(dnsData);
  }, [dnsData]);

  useEffect(() => {
    const root = (selectedDomain?.domain || "").trim().toLowerCase().replace(/\.$/, "");
    const stored = (selectedDomain?.tracking_domain || "").trim().toLowerCase().replace(/\.$/, "");
    const defaultSub = DEFAULT_TRACKING_SUBDOMAIN_LABEL;
    if (!root) {
      setTrackingSubdomainInput(defaultSub);
      return;
    }
    if (!stored) {
      setTrackingSubdomainInput(defaultSub);
      return;
    }
    const expectedSuffix = `.${root}`;
    if (stored.endsWith(expectedSuffix)) {
      const extracted = stored.slice(0, -expectedSuffix.length);
      setTrackingSubdomainInput(extracted || defaultSub);
    } else {
      // If stored value doesn't match the expected suffix, still try to use it as the editable part.
      setTrackingSubdomainInput(stored);
    }
  }, [selectedDomain?.id, selectedDomain?.tracking_domain]);

  const getTrackingDomainFromSubdomain = () => {
    const domain = trackingDomainDialogDomain;
    const root = (domain?.domain || "").trim().toLowerCase().replace(/\.$/, "");
    const sub = (trackingSubdomainInput || "").trim().toLowerCase().replace(/\.$/, "");
    if (!domain || !root || !sub) return "";
    if (sub.endsWith(`.${root}`)) {
      const extracted = sub.slice(0, -(`.${root}`.length));
      return `${extracted}.${root}`;
    }
    return `${sub}.${root}`;
  };

  const toFqdnHost = (host: string | undefined | null, domain: string | undefined | null) => {
    const hostValue = String(host || "").trim().replace(/\.$/, "");
    const domainValue = String(domain || "").trim().toLowerCase().replace(/\.$/, "");
    if (!domainValue) return hostValue;
    if (!hostValue || hostValue === "@") return domainValue;
    const normalizedHost = hostValue.toLowerCase();
    if (normalizedHost.endsWith(`.${domainValue}`) || normalizedHost === domainValue) {
      return hostValue;
    }
    return `${hostValue}.${domainValue}`;
  };

  const handleVerifyDomain = async (domainId: string) => {
    setVerifyingDomainId(domainId);
    try {
      await verifyDomain.mutateAsync(domainId);
      toast.success("Domain verification completed");

      await queryClient.removeQueries({ queryKey: ["domains"] });
      await queryClient.removeQueries({ queryKey: ["domain", domainId] });

      const updatedDomains = await api.domains.list();
      await queryClient.setQueryData(["domains"], updatedDomains);

      if (selectedDomain?.id === domainId) {
        const updatedDnsRecords = await api.domains.getDNSRecords(domainId);
        setDnsRecords(updatedDnsRecords);
        queryClient.setQueryData(["dns-records", domainId], updatedDnsRecords);
        const updatedDomain = updatedDomains.find((d: Domain) => d.id === domainId);
        if (updatedDomain) setSelectedDomain(updatedDomain);
      } else {
        await queryClient.removeQueries({ queryKey: ["dns-records", domainId] });
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to verify domain");
    } finally {
      setVerifyingDomainId(null);
    }
  };

  const pickRandomSubdomainNames = (countRaw: number, perBatchMax: number) => {
    const maxAvailable = Math.min(BULK_SUBDOMAIN_RANDOM_POOL.length, Math.max(0, perBatchMax));
    if (maxAvailable <= 0) return [];
    const count = Math.max(1, Math.min(maxAvailable, Number(countRaw) || 1));
    const shuffled = [...BULK_SUBDOMAIN_RANDOM_POOL].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  };

  const openBulkSubdomainDialog = (domain: Domain) => {
    const existing = subdomainCountByParentId.get(domain.id) ?? 0;
    const remaining = BULK_SUBDOMAIN_MAX_COUNT - existing;
    if (remaining <= 0) {
      toast.error(
        `This domain already has the maximum of ${BULK_SUBDOMAIN_MAX_COUNT} subdomains. Remove one or use another domain.`
      );
      return;
    }
    const initialCount = remaining;
    setBulkSubdomainDialogDomain(domain);
    setBulkSubdomainCount(initialCount);
    setBulkSubdomainSelections(pickRandomSubdomainNames(initialCount, remaining));
  };

  const handleShuffleBulkSubdomains = () => {
    if (bulkSubdomainRemainingSlots <= 0) return;
    setBulkSubdomainSelections(
      pickRandomSubdomainNames(bulkSubdomainCount, bulkSubdomainRemainingSlots)
    );
  };

  const handleCreateBulkSubdomains = async () => {
    // Guard against rapid repeat clicks before React applies disabled state.
    if (creatingBulkSubdomainsRef.current || creatingBulkSubdomains) return;
    creatingBulkSubdomainsRef.current = true;
    setCreatingBulkSubdomains(true);
    try {
    if (!bulkSubdomainDialogDomain) return;
    const names = bulkSubdomainSelections
      .map((name) => name.trim().toLowerCase().replace(/[^a-z0-9-]/g, ""))
      .filter(Boolean);
    if (names.length === 0) {
      toast.error("Add at least one valid subdomain name");
      return;
    }
    const uniqueNames = [...new Set(names)];
    if (uniqueNames.length !== names.length) {
      toast.error("Subdomain names must be unique");
      return;
    }

    const existingForParent = subdomainCountByParentId.get(bulkSubdomainDialogDomain.id) ?? 0;
    const remainingSlots = BULK_SUBDOMAIN_MAX_COUNT - existingForParent;
    if (remainingSlots <= 0) {
      toast.error(
        `This domain already has the maximum of ${BULK_SUBDOMAIN_MAX_COUNT} subdomains. Remove one or use another domain.`
      );
      return;
    }

    let namesToCreate = uniqueNames;
    if (namesToCreate.length > remainingSlots) {
      namesToCreate = namesToCreate.slice(0, remainingSlots);
      toast.info(
        `Creating ${remainingSlots} subdomain(s) only — this domain already has ${existingForParent} of ${BULK_SUBDOMAIN_MAX_COUNT} allowed.`
      );
    }

    const { job_id: jobId } = await api.domains.startBulkBackground({
      mode: "subdomains",
      domain_id: bulkSubdomainDialogDomain.id,
      names: namesToCreate,
    });

    let finalJob: BulkSubdomainLiveJob | null = null;
    setBulkSubdomainLiveJob({
      status: "queued",
      total_count: namesToCreate.length,
      processed_count: 0,
      created_count: 0,
      pending_count: namesToCreate.length,
      failed_count: 0,
      skipped_count: 0,
      results: [],
    });
    await new Promise<void>((resolve) => {
      const streamUrl = `${API_BASE_URL}/domains/bulk/background/${encodeURIComponent(jobId)}/stream`;
      const es = new EventSource(streamUrl, { withCredentials: true });
      const timeoutId = window.setTimeout(() => {
        es.close();
        resolve();
      }, 8 * 60 * 1000); // hard timeout guard

      const closeAndResolve = () => {
        window.clearTimeout(timeoutId);
        es.close();
        resolve();
      };

      const handleStreamMessage = (evt: MessageEvent) => {
        try {
          const payload = JSON.parse(evt.data) as {
            type?: string;
            job?: {
              status: "queued" | "running" | "completed" | "completed_with_errors" | "failed";
              created_count: number;
              pending_count?: number;
              failed_count: number;
              skipped_count: number;
              results: Array<{ error?: string }>;
            };
          };
          if (!payload?.job) return;
          finalJob = payload.job;
          setBulkSubdomainLiveJob(payload.job);
          if (payload.type === "done" || payload.type === "failed") {
            closeAndResolve();
          }
        } catch {
          // Ignore malformed event payloads and keep stream alive.
        }
      };

      es.addEventListener("progress", handleStreamMessage as EventListener);
      es.addEventListener("done", handleStreamMessage as EventListener);
      es.addEventListener("failed", handleStreamMessage as EventListener);
      es.onerror = async () => {
        // Fallback to polling so live progress still updates even if SSE fails/auth drops.
        try {
          for (let i = 0; i < 240; i += 1) {
            const polled = await api.domains.getBulkBackgroundJob(jobId);
            finalJob = polled;
            setBulkSubdomainLiveJob(polled);
            if (
              polled.status === "completed" ||
              polled.status === "completed_with_errors" ||
              polled.status === "failed"
            ) {
              break;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
        } catch {
          // Ignore poll fallback errors and keep existing timeout behavior.
        }
        closeAndResolve();
      };
    });

    if (!finalJob) {
      toast.warning("Bulk process is still running in background. Refresh shortly to see new domains.");
      return;
    }
    const resolvedJob = finalJob as BulkSubdomainLiveJob;

    try {
      const updatedDomains = await api.domains.list();
      queryClient.setQueryData(["domains"], updatedDomains);
    } catch {
      // no-op: retain final job toast even if list refresh fails
    }

    const firstError = resolvedJob.results.find((r: { error?: string }) => !!r.error)?.error ?? "";
    if (resolvedJob.status === "completed" && resolvedJob.failed_count === 0) {
      toast.success(
        `Created ${resolvedJob.created_count} subdomains for ${bulkSubdomainDialogDomain.domain}.`
      );
      setBulkSubdomainDialogDomain(null);
      return;
    }

    if (resolvedJob.created_count > 0 || resolvedJob.failed_count > 0 || resolvedJob.skipped_count > 0) {
      toast.warning(
        `Created ${resolvedJob.created_count}, skipped ${resolvedJob.skipped_count}, failed ${resolvedJob.failed_count}${firstError ? ` (${firstError})` : ""}`
      );
      return;
    }

    toast.error(firstError || "Bulk subdomain creation failed");
    } finally {
      creatingBulkSubdomainsRef.current = false;
      setCreatingBulkSubdomains(false);
      setBulkSubdomainLiveJob(null);
    }
  };

  useEffect(() => {
    if (!bulkSubdomainDialogDomain) return;
    if (bulkSubdomainRemainingSlots <= 0) {
      toast.info(`This domain already has ${BULK_SUBDOMAIN_MAX_COUNT} subdomains.`);
      setBulkSubdomainDialogDomain(null);
      return;
    }
    setBulkSubdomainCount((prev) =>
      prev <= bulkSubdomainRemainingSlots ? prev : bulkSubdomainRemainingSlots
    );
    setBulkSubdomainSelections((prev) =>
      prev.length <= bulkSubdomainRemainingSlots ? prev : prev.slice(0, bulkSubdomainRemainingSlots)
    );
  }, [bulkSubdomainDialogDomain, bulkSubdomainRemainingSlots]);

  const handleEnableReceiving = async (domainId: string) => {
    setEnablingReceivingDomainId(domainId);
    try {
      await api.domains.enableReceiving(domainId);
      toast.success("Receiving mail enabled for this domain");
      setEnableReceivingDialogDomain(null);
      await refetchDomains();
      const updated = await api.domains.list();
      queryClient.setQueryData(["domains"], updated);
      const d = updated.find((d: Domain) => d.id === domainId);
      if (d && selectedDomain?.id === domainId) setSelectedDomain(d);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to enable receiving";
      toast.error(msg);
    } finally {
      setEnablingReceivingDomainId(null);
    }
  };

  const handleDisableReceiving = async (domainId: string) => {
    setDisablingReceivingDomainId(domainId);
    try {
      await api.domains.disableReceiving(domainId);
      toast.success("Receiving mail disabled for this domain");
      await refetchDomains();
      const updated = await api.domains.list();
      queryClient.setQueryData(["domains"], updated);
      const d = updated.find((d: Domain) => d.id === domainId);
      if (d && selectedDomain?.id === domainId) setSelectedDomain(d);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to disable receiving";
      toast.error(msg);
    } finally {
      setDisablingReceivingDomainId(null);
    }
  };

  const handleEnableReceivingDialogSubmit = async () => {
    const domain = enableReceivingDialogDomain;
    if (!domain) return;
    setEnablingReceivingDomainId(domain.id);
    try {
      const verify = await api.domains.verifyReceivingMx(domain.id);
      if (!verify.valid) {
        toast.error(verify.message || "MX record not found. Add the record and try again after DNS propagates.");
        return;
      }
      await handleEnableReceiving(domain.id);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to verify MX record";
      toast.error(msg);
    } finally {
      setEnablingReceivingDomainId(null);
    }
  };

  const handleDomainMailTest = async (domain: Domain) => {
    const eligibleDomainInboxes = inboxes.filter(
      (inbox) =>
        inbox.domain_id === domain.id &&
        ["ready", "warming"].includes((inbox.status || "").toLowerCase())
    );
    if (eligibleDomainInboxes.length === 0) {
      const shouldCreate = await confirmDialog({
        title: "Create inbox to run test mode",
        description: `No ready/warming inbox exists for "${domain.domain}". Create an inbox first, then run test mode.`,
        variant: "default",
      });
      if (shouldCreate) {
        router.push(`/inboxes/new?domain_id=${encodeURIComponent(domain.id)}`);
      }
      return;
    }

    setTestingDomainId(domain.id);
    setMailTestDialogOpen(true);
    setMailTestResult({
      domain: domain.domain,
      senderOk: false,
      recipientOk: false,
      receiveStatus: "idle",
      receiveMessage: "Preparing test...",
    });
    try {
      const result = await api.warmup.domainMailTest(domain.id);
      setMailTestResult({
        domain: domain.domain,
        senderEmail: result.sender_email,
        recipientEmail: result.recipient_email,
        recipientSource: result.recipient_source,
        senderOk: Boolean(result.sender_check?.ok),
        recipientOk: Boolean(result.recipient_check?.ok),
        receiveStatus: "pending",
        receiveMessage: "Waiting for receive/open signal...",
        reverseEnabled: Boolean(result.reverse_test_id) || Boolean(result.reverse_flow?.enabled),
        reverseStatus: result.reverse_test_id
          ? "pending"
          : result.reverse_flow?.enabled
            ? (result.reverse_flow.status || "pending")
            : "idle",
        reverseMessage: result.reverse_test_id
          ? `Waiting for reverse signal: ${result.recipient_email || "recipient"} -> ${result.sender_email || "sender"}`
          : result.reverse_flow?.message || "Reverse flow not available.",
      });
      let forwardDetected = false;
      let reverseDetected = !Boolean(result.reverse_test_id);
      const pollDelaysMs = [20000, 20000]; // checks at ~20s and ~40s after send
      for (const delayMs of pollDelaysMs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const forwardStatus = await api.warmup.domainMailTestStatus(result.test_id);
        if (forwardStatus.receive_signal.ok) {
          forwardDetected = true;
          setMailTestResult((prev) =>
            prev
              ? {
                  ...prev,
                  receiveStatus: "success",
                  receiveMessage: forwardStatus.receive_signal.message,
                }
              : prev
          );
        }
        if (result.reverse_test_id) {
          const reverseStatus = await api.warmup.domainMailTestStatus(result.reverse_test_id);
          if (reverseStatus.receive_signal.ok) {
            reverseDetected = true;
            setMailTestResult((prev) =>
              prev
                ? {
                    ...prev,
                    reverseStatus: "success",
                    reverseMessage: reverseStatus.receive_signal.message,
                  }
                : prev
            );
          }
        }
        if (forwardDetected && reverseDetected) {
          break;
        }
      }
      if (!forwardDetected) {
        setMailTestResult((prev) =>
          prev
            ? {
                ...prev,
                receiveStatus: "pending",
                receiveMessage:
                  "Send was successful, but receive/open signal was not detected yet. Mail can still be delivered (including Spam/Junk). Check again in a few minutes.",
              }
            : prev
        );
      }
      if (result.reverse_test_id && !reverseDetected) {
        setMailTestResult((prev) =>
          prev
            ? {
                ...prev,
                reverseStatus: "pending",
                reverseMessage:
                  "Reverse send was successful, but reverse receive/open signal was not detected yet. Mail can still be delivered (including Spam/Junk).",
              }
            : prev
        );
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to run test mode";
      setMailTestResult((prev) =>
        prev
          ? {
              ...prev,
              receiveStatus: "failed",
              receiveMessage: msg,
            }
          : null
      );
    } finally {
      setTestingDomainId(null);
    }
  };

  const handleTrackingDomainDialogSubmit = async () => {
    const domain = trackingDomainDialogDomain;
    if (!domain) return;
    if (!trackingSubdomainInput.trim()) {
      toast.error("Enter a tracking subdomain first (e.g. cloud)");
      return;
    }
    await handleSaveTrackingDomain(domain.id);
    await handleVerifyTrackingDomain(domain.id);
  };

  const pickRandomTrackingSubdomain = () => {
    const pool = TRACKING_SUBDOMAIN_PICKER;
    if (!pool.length) return;
    const next = pool[Math.floor(Math.random() * pool.length)] || DEFAULT_TRACKING_SUBDOMAIN_LABEL;
    setTrackingSubdomainInput(next);
  };

  const openTrackingDomainDialog = (domain: Domain) => {
    const root = (domain.domain || "").trim();
    const stored = (domain.tracking_domain || `${DEFAULT_TRACKING_SUBDOMAIN_LABEL}.${domain.domain}`).trim();
    const extracted = stored.endsWith(`.${root}`) ? stored.slice(0, -(root.length + 1)) : stored;
    setTrackingSubdomainInput(extracted || DEFAULT_TRACKING_SUBDOMAIN_LABEL);
    setTrackingDomainDialogDomain(domain);
  };

  const handleSyncToProvider = async (domainId: string) => {
    const targetDomain = domains.find((d) => d.id === domainId);
    const confirmed = await confirmDialog({
      title: "Sync SendGrid DNS",
      description: `Sync for "${targetDomain?.domain || "this domain"}" may create a new SendGrid DNS record if no matching record exists. If you face issues after sync, create a support ticket so we can resolve it quickly.`,
      variant: "default",
    });
    if (!confirmed) return;

    setSyncingDomainId(domainId);
    try {
      const result = await api.domains.syncToProvider(domainId);
      toast.success(result.message || `Domain synced to ${result.provider}`);

      await queryClient.removeQueries({ queryKey: ["domains"] });
      await queryClient.removeQueries({ queryKey: ["dns-records", domainId] });
      await queryClient.removeQueries({ queryKey: ["domain", domainId] });
      await refetchDomains();

      if (selectedDomain?.id === domainId) {
        const updatedDnsRecords = await api.domains.getDNSRecords(domainId);
        setDnsRecords(updatedDnsRecords);
        const updatedDomains = await api.domains.list();
        const updatedDomain = updatedDomains.find((d: Domain) => d.id === domainId);
        if (updatedDomain) setSelectedDomain(updatedDomain);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to sync domain to provider";
      toast.error(errorMessage);
    } finally {
      setSyncingDomainId(null);
    }
  };

  const handleDeleteDomain = async (domain: Domain) => {
    const confirmed = await confirmDialog({
      title: "Delete domain",
      description: `Are you sure you want to delete domain "${domain.domain}"?\n\nThis action cannot be undone. All DNS records and settings will be lost.\n\nNote: Domains with active inboxes cannot be deleted.`,
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      await api.domains.delete(domain.id);
      toast.success(`Domain "${domain.domain}" deleted successfully`);
      refetchDomains();
      if (selectedDomain?.id === domain.id) {
        setSelectedDomain(null);
        setDnsRecords(null);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to delete domain");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const handleCreateSupportTicket = async () => {
    if (!selectedDomain) return;
    try {
      const ticket = await createTicket.mutateAsync({
        subject: `DNS verification help: ${selectedDomain.domain}`,
        description: `My domain "${selectedDomain.domain}" needs help with DNS verification.`,
        priority: "medium",
      });
      router.push(`/tickets/${ticket.id}`);
    } catch {
      // toast handled by hook
    }
  };

  const getInboxCount = (domainId: string) =>
    inboxes.filter((inbox) => inbox.domain_id === domainId).length;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "verified":
        return (
          <Badge className="bg-success text-success-foreground border-success hover:bg-success hover:text-success-foreground">
            Verified
          </Badge>
        );
      case "pending":
        return <Badge variant="outline">Pending</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getDnsStatus = (enabled: boolean) =>
    enabled ? (
      <CheckCircle className="w-5 h-5 text-success" />
    ) : (
      <XCircle className="w-5 h-5 text-destructive" />
    );

  const getHealthColor = (score: number) => {
    if (score >= 90) return "text-success";
    if (score >= 70) return "text-warning";
    return "text-destructive";
  };

  const currentProvider = "sendgrid";
  const isSendGrid = currentProvider === "sendgrid";
  const colSpanCount = 9;
  const emailInfraEnabledForUser = Boolean(settings?.email_infra?.enabled);

  const handleCreateEmailInfra = async (domainId: string) => {
    if (!emailInfraEnabledForUser) {
      toast.error("Enable Email Infra in settings first.");
      return;
    }
    setCreatingEmailInfraDomainId(domainId);
    try {
      const updatedDomain = await api.domains.createEmailInfra(domainId);
      const updatedDomains = await api.domains.list();
      queryClient.setQueryData(["domains"], updatedDomains);
      if (selectedDomain?.id === domainId && updatedDomain) {
        setSelectedDomain(updatedDomain);
      }
      toast.success("Pigeon DNS created for this domain.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create Pigeon DNS for this domain";
      toast.error(message);
    } finally {
      setCreatingEmailInfraDomainId(null);
    }
  };

  const handleDeleteEmailInfra = async (domain: Domain) => {
    if (!emailInfraEnabledForUser) {
      toast.error("Enable Email Infra in settings first.");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Remove Pigeon DNS",
      description: `This removes Pigeon DNS from Email Infra for "${domain.domain}". SendGrid DNS and verification are unchanged. If sending was set to Email Infra, it will switch back to SendGrid.`,
      variant: "destructive",
    });
    if (!confirmed) return;

    setDeletingEmailInfraDomainId(domain.id);
    try {
      const updatedDomain = await api.domains.deleteEmailInfra(domain.id);
      const updatedDomains = await api.domains.list();
      queryClient.setQueryData(["domains"], updatedDomains);
      await queryClient.invalidateQueries({ queryKey: ["dns-records", domain.id] });
      if (selectedDomain?.id === domain.id && updatedDomain) {
        setSelectedDomain(updatedDomain);
        try {
          const dns = await api.domains.getDNSRecords(domain.id);
          setDnsRecords(dns);
        } catch {
          // DNS panel can refetch via hook
        }
      }
      toast.success("Pigeon DNS removed");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to remove Pigeon DNS";
      toast.error(message);
    } finally {
      setDeletingEmailInfraDomainId(null);
    }
  };

  const handleSetSendingProvider = async (domainId: string, provider: "sendgrid" | "email_infra") => {
    setSettingSendingProviderDomainId(domainId);
    try {
      await api.domains.setSendingProvider(domainId, provider);
      toast.success(
        provider === "email_infra" ? "Sending provider set to Email Infra" : "Sending provider set to SendGrid"
      );
      await refetchDomains();
      const updatedDomains = await api.domains.list();
      queryClient.setQueryData(["domains"], updatedDomains);

      const updatedDomain = updatedDomains.find((d: Domain) => d.id === domainId);
      if (updatedDomain && selectedDomain?.id === domainId) {
        setSelectedDomain(updatedDomain);
        const updatedDnsRecords = await api.domains.getDNSRecords(domainId);
        setDnsRecords(updatedDnsRecords);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update sending provider";
      toast.error(message);
    } finally {
      setSettingSendingProviderDomainId(null);
    }
  };

  const handleSaveTrackingDomain = async (domainId: string, trackingDomainOverride?: string) => {
    setSavingTrackingDomainId(domainId);
    try {
      const host = (trackingDomainOverride || getTrackingDomainFromSubdomain()).trim();
      const updated = await api.domains.setTrackingDomain(domainId, host);
      const updatedDomains = await api.domains.list();
      queryClient.setQueryData(["domains"], updatedDomains);
      const latest = updatedDomains.find((d: Domain) => d.id === domainId) || updated;
      if (selectedDomain?.id === domainId) {
        setSelectedDomain(latest);
        const updatedDnsRecords = await api.domains.getDNSRecords(domainId);
        setDnsRecords(updatedDnsRecords);
        queryClient.setQueryData(["dns-records", domainId], updatedDnsRecords);
      }
      toast.success("Tracking domain saved");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save tracking domain";
      toast.error(message);
    } finally {
      setSavingTrackingDomainId(null);
    }
  };

  const handleVerifyTrackingDomain = async (domainId: string) => {
    setVerifyingTrackingDomainId(domainId);
    try {
      const result = await api.domains.verifyTrackingDomain(domainId);
      const updatedDomains = await api.domains.list();
      queryClient.setQueryData(["domains"], updatedDomains);
      const latest = updatedDomains.find((d: Domain) => d.id === domainId) || result.domain || selectedDomain;
      if (selectedDomain?.id === domainId && latest) {
        setSelectedDomain(latest);
        const updatedDnsRecords = await api.domains.getDNSRecords(domainId);
        setDnsRecords(updatedDnsRecords);
        queryClient.setQueryData(["dns-records", domainId], updatedDnsRecords);
      }
      if (result?.verification?.valid) {
        toast.success(result.verification.message || "Tracking domain verified");
        setTrackingDomainDialogDomain(null); // Close modal after successful enable/verification
      } else {
        toast.error(
          (result?.verification?.message || "Tracking domain verification failed") +
            ". If DNS has not propagated yet, wait a bit and try again."
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to verify tracking domain";
      toast.error(message + ". If DNS has not propagated yet, wait a bit and try again.");
    } finally {
      setVerifyingTrackingDomainId(null);
    }
  };

  const handleDisableTrackingDomain = async (domainId: string) => {
    setDisablingTrackingDomainId(domainId);
    try {
      await api.domains.setTrackingDomain(domainId, "");
      toast.success("Tracking disabled");

      await refetchDomains();
      const updatedDomains = await api.domains.list();
      queryClient.setQueryData(["domains"], updatedDomains);

      if (selectedDomain?.id === domainId) {
        const updatedDomain = updatedDomains.find((d: Domain) => d.id === domainId);
        if (updatedDomain) setSelectedDomain(updatedDomain);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to disable tracking";
      toast.error(message);
    } finally {
      setDisablingTrackingDomainId(null);
    }
  };

  const loadDnsProviderConnections = async () => {
    try {
      const res = await api.domains.listDNSProviders();
      setDnsProviderConnections(res.providers || []);
    } catch {
      // Keep UI usable even if provider metadata endpoint is unavailable.
      setDnsProviderConnections([]);
    }
  };

  const handleConnectDnsProvider = async () => {
    const requiredByProvider: Record<DNSProviderConnection["provider"], string[]> = {
      cloudflare: ["api_token"],
      godaddy: ["api_key", "api_secret"],
      namecheap: ["api_user", "api_key", "client_ip"],
      clouddns: ["service_account_json"],
    };
    const required = requiredByProvider[dnsProvider] || [];
    const missing = required.filter((key) => !(dnsProviderCredentials[key] || "").trim());
    if (missing.length > 0) {
      toast.error(`Missing required fields: ${missing.join(", ")}`);
      return;
    }
    setSavingDnsProvider(true);
    try {
      await api.domains.connectDNSProvider(dnsProvider, dnsProviderCredentials);
      toast.success(`${dnsProvider} connected.`);
      setDnsProviderCredentials({});
      await loadDnsProviderConnections();
      setDnsProviderDialogOpen(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to connect DNS provider");
    } finally {
      setSavingDnsProvider(false);
    }
  };

  const handleDisconnectDnsProvider = async () => {
    setDisconnectingDnsProvider(true);
    try {
      await api.domains.disconnectDNSProvider(dnsProvider);
      toast.success(`${dnsProvider} disconnected.`);
      await loadDnsProviderConnections();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect DNS provider");
    } finally {
      setDisconnectingDnsProvider(false);
    }
  };

  const handleAutoDnsSetup = async (domainId: string) => {
    setAutoSetupDomainId(domainId);
    try {
      const result = await api.domains.autoSetupDNS(domainId, dnsProvider);
      toast.success(result.message || "DNS records configured automatically.");
      await handleVerifyDomain(domainId);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to auto setup DNS");
    } finally {
      setAutoSetupDomainId(null);
    }
  };

  useEffect(() => {
    void loadDnsProviderConnections();
  }, []);

  return (
    <AppPageShell
      title="Domains & Inboxes"
      description={
        domainGate.atLimit
          ? "You have reached the maximum number of domains on your current plan."
          : "Manage your sending domains and email accounts"
      }
      actions={
        <div className="flex items-center gap-2" data-tour="domains-add-domain">
          {domainGate.atLimit && <PremiumBadge featureKey="domains" />}
          <AddDomainDialog
            userId={userId}
            onSuccess={async (domain) => {
              await refetchDomains();
              setSelectedDomain(domain);
            }}
          />
        </div>
      }
    >
    <div className="space-y-6">
      <Tabs defaultValue="domains">
        <TabsList>
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="inboxes" onClick={() => router.push("/inboxes")}>
            Inboxes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="domains" className="mt-6">
          <Card className="rounded-xl border border-border/80 bg-card shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold tracking-tight">Your Domains</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Sending domains with DNS verification status and health.
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Input
                  value={domainSearchQuery}
                  onChange={(e) => setDomainSearchQuery(e.target.value)}
                  placeholder="Search domains by name, status, or parent"
                  className="w-full sm:max-w-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Showing {filteredDomainRows.length} of {orderedDomainRows.length}
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[320px]">Domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">SPF</TableHead>
                    <TableHead className="text-center">DKIM</TableHead>
                    <TableHead className="text-center">DMARC</TableHead>
                    <TableHead className="text-center">MX</TableHead>
                    <TableHead className="text-center">Health</TableHead>
                    <TableHead className="text-right">Inboxes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domainsLoading ? (
                    <TableRow>
                      <TableCell colSpan={colSpanCount} className="text-center py-8">
                        Loading domains...
                      </TableCell>
                    </TableRow>
                  ) : domains.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colSpanCount} className="p-0">
                        <EmptyState
                          icon={Globe}
                          headline="No domains yet"
                          description="Add a sending domain to verify DNS and start sending email."
                          primaryAction={
                            !domainGate.atLimit ? (
                              <AddDomainDialog
                                userId={userId}
                                onSuccess={async (domain) => {
                                  await refetchDomains();
                                  setSelectedDomain(domain);
                                }}
                              />
                            ) : null
                          }
                          className="rounded-none border-0 border-t border-dashed"
                        />
                      </TableCell>
                    </TableRow>
                  ) : filteredDomainRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colSpanCount} className="text-center py-8 text-sm text-muted-foreground">
                        No domains match your search.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDomainRows.map((row) => {
                      const domain = row.domain;
                      const childCountForDomain = subdomainCountByParentId.get(domain.id) ?? 0;
                      const bulkSubdomainsAtLimit = childCountForDomain >= BULK_SUBDOMAIN_MAX_COUNT;
                      return (
                      <Fragment key={domain.id}>
                        {/* Main domain row with metrics and actions */}
                        <TableRow
                          key={`${domain.id}-main`}
                          className={row.isChild ? "bg-muted/20" : undefined}
                        >
                          <TableCell>
                            <div className={`flex items-start gap-2 ${row.isChild ? "pl-4" : ""}`}>
                              {row.isChild ? (
                                <CornerDownRight className="mt-0.5 w-4 h-4 text-muted-foreground shrink-0" />
                              ) : (
                                <Globe className="mt-0.5 w-4 h-4 text-primary shrink-0" />
                              )}
                              <div className="min-w-0 space-y-1">
                                <span className="block font-medium break-words leading-tight">{domain.domain}</span>
                                {row.isChild && row.parentDomain && (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                                      Subdomain
                                    </Badge>
                                    <span className="text-[11px] text-muted-foreground">
                                      linked to {row.parentDomain}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          {/* If Pigeon DNS is not enabled, show SendGrid DNS metrics directly in the main row */}
                          <TableCell className="text-center">
                            {domain.email_infra?.enabled ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              getStatusBadge(domain.status)
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {domain.email_infra?.enabled ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              getDnsStatus(domain.spf_verified)
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {domain.email_infra?.enabled ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              getDnsStatus(domain.dkim_verified)
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {domain.email_infra?.enabled ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              getDnsStatus(domain.dmarc_verified)
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {domain.email_infra?.enabled ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              getDnsStatus(!!domain.mx_verified)
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {domain.email_infra?.enabled ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : domain.status === "verified" ? (
                              <div className="flex items-center justify-center gap-2">
                                <Progress value={domain.health_score} className="w-16 h-2" />
                                <span className={`font-medium ${getHealthColor(domain.health_score)}`}>
                                  {domain.health_score}%
                                </span>
                                <HealthScoreTooltip />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {inboxesLoading ? "—" : getInboxCount(domain.id)}
                          </TableCell>
                          <TableCell className="text-right align-middle">
                            {(() => {
                              const sendingProvider = domain.sending_provider ?? "sendgrid";
                              const isEmailInfraSending = sendingProvider === "email_infra";
                              const emailInfraReadyForSending =
                                emailInfraEnabledForUser &&
                                domain.email_infra?.enabled &&
                                ["ready", "verified"].includes((domain.email_infra?.status || "").toLowerCase());
                              const targetProvider = isEmailInfraSending ? "sendgrid" : "email_infra";
                              const canSwitch = isEmailInfraSending ? true : Boolean(emailInfraReadyForSending);
                              const sendgridVerifiedExtras = isSendGrid && domain.status === "verified";
                              const sendgridNeedsDnsSetup = isSendGrid && domain.status !== "verified";
                              // Receiving uses SendGrid Inbound Parse (webhook), so show it based on the UI's
                              // SendGrid mode rather than each row's outbound sending provider.
                              const canEnableReceiving = isSendGrid;
                              const showMenuDividerBeforeDelete =
                                emailInfraEnabledForUser || sendgridVerifiedExtras || sendgridNeedsDnsSetup;

                              return (
                                <div className="flex flex-col items-end gap-1 min-w-0">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-8 shrink-0 gap-1.5 px-2"
                                          onClick={async () => handleVerifyDomain(domain.id)}
                                          disabled={verifyingDomainId === domain.id}
                                          aria-label="Verify DNS"
                                        >
                                          <RefreshCw
                                            className={`h-3.5 w-3.5 ${verifyingDomainId === domain.id ? "animate-spin" : ""}`}
                                          />
                                          <span className="text-xs">Verify</span>
                                        </Button>
                                    <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-8 shrink-0 gap-1.5 px-2"
                                          onClick={() => {
                                            setSelectedDomain(domain);
                                          }}
                                          aria-label="View DNS records"
                                        >
                                          <Globe className="h-3.5 w-3.5" />
                                          <span className="text-xs">DNS</span>
                                        </Button>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-8 shrink-0 gap-1.5 px-2"
                                          aria-label="More domain actions"
                                        >
                                          <MoreVertical className="h-4 w-4" />
                                          <span className="text-xs">More</span>
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-56">
                                        <DropdownMenuItem
                                          onClick={() => handleSyncToProvider(domain.id)}
                                          disabled={syncingDomainId === domain.id}
                                        >
                                          {syncingDomainId === domain.id ? (
                                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                          ) : (
                                            <RefreshCw className="mr-2 h-4 w-4" />
                                          )}
                                          Sync
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        {emailInfraEnabledForUser && (
                                          <>
                                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                              Sending · {isEmailInfraSending ? "Email Infra" : "SendGrid"}
                                            </DropdownMenuLabel>
                                            <DropdownMenuItem
                                              onClick={() => handleSetSendingProvider(domain.id, targetProvider)}
                                              disabled={settingSendingProviderDomainId === domain.id || !canSwitch}
                                            >
                                              {settingSendingProviderDomainId === domain.id ? (
                                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                              ) : isEmailInfraSending ? (
                                                <Globe className="mr-2 h-4 w-4" />
                                              ) : (
                                                <Shield className="mr-2 h-4 w-4" />
                                              )}
                                              {isEmailInfraSending ? "Use SendGrid" : "Use Email Infra"}
                                            </DropdownMenuItem>
                                            {!domain.email_infra?.enabled && (
                                              <DropdownMenuItem
                                                onClick={() => handleCreateEmailInfra(domain.id)}
                                                disabled={creatingEmailInfraDomainId === domain.id}
                                              >
                                                {creatingEmailInfraDomainId === domain.id ? (
                                                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                  <Shield className="mr-2 h-4 w-4" />
                                                )}
                                                Create Pigeon DNS
                                              </DropdownMenuItem>
                                            )}
                                            {domain.email_infra?.enabled &&
                                              (domain.email_infra?.status || "").toLowerCase() === "pending" && (
                                                <DropdownMenuItem
                                                  onClick={() => handleCreateEmailInfra(domain.id)}
                                                  disabled={creatingEmailInfraDomainId === domain.id}
                                                >
                                                  <RefreshCw
                                                    className={`mr-2 h-4 w-4 ${creatingEmailInfraDomainId === domain.id ? "animate-spin" : ""}`}
                                                  />
                                                  Verify Pigeon DNS
                                                </DropdownMenuItem>
                                              )}
                                            {domain.email_infra?.enabled && (
                                              <>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                                  onClick={() => void handleDeleteEmailInfra(domain)}
                                                  disabled={deletingEmailInfraDomainId === domain.id}
                                                >
                                                  {deletingEmailInfraDomainId === domain.id ? (
                                                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                  ) : (
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                  )}
                                                  Delete Pigeon DNS
                                                </DropdownMenuItem>
                                              </>
                                            )}
                                            {(sendgridNeedsDnsSetup ||
                                              (sendgridVerifiedExtras && !row.isChild)) && <DropdownMenuSeparator />}
                                          </>
                                        )}
                                        {sendgridNeedsDnsSetup && (
                                          <>
                                            <DropdownMenuItem
                                              onClick={() => handleAutoDnsSetup(domain.id)}
                                              disabled={autoSetupDomainId === domain.id}
                                            >
                                              {autoSetupDomainId === domain.id ? (
                                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                              ) : (
                                                <Globe className="mr-2 h-4 w-4" />
                                              )}
                                              Auto DNS setup
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setDnsProviderDialogOpen(true)}>
                                              <Shield className="mr-2 h-4 w-4" />
                                              Connect DNS provider API
                                            </DropdownMenuItem>
                                          </>
                                        )}
                                        {canEnableReceiving && (
                                          <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                              Receiving mail
                                            </DropdownMenuLabel>
                                            {domain.inbound_parse_enabled ? (
                                              <DropdownMenuItem
                                                onClick={() => handleDisableReceiving(domain.id)}
                                                disabled={disablingReceivingDomainId === domain.id}
                                              >
                                                {disablingReceivingDomainId === domain.id ? (
                                                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                  <XCircle className="mr-2 h-4 w-4" />
                                                )}
                                                Disable receiving
                                              </DropdownMenuItem>
                                            ) : (
                                              <DropdownMenuItem
                                                onClick={() => setEnableReceivingDialogDomain(domain)}
                                                disabled={enablingReceivingDomainId === domain.id}
                                              >
                                                {enablingReceivingDomainId === domain.id ? (
                                                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                  <MessageSquare className="mr-2 h-4 w-4" />
                                                )}
                                                Enable receiving
                                              </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem
                                              onClick={() => handleDomainMailTest(domain)}
                                              disabled={testingDomainId === domain.id}
                                            >
                                              {testingDomainId === domain.id ? (
                                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                              ) : (
                                                <MessageSquare className="mr-2 h-4 w-4" />
                                              )}
                                              Test mode
                                            </DropdownMenuItem>
                                          </>
                                        )}
                                        {sendgridVerifiedExtras && !row.isChild && (
                                          <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                              Link tracking
                                            </DropdownMenuLabel>
                                            {domain.tracking_domain_verified ? (
                                              <>
                                                <DropdownMenuItem
                                                  onClick={() => openTrackingDomainDialog(domain)}
                                                  disabled={
                                                    savingTrackingDomainId === domain.id ||
                                                    verifyingTrackingDomainId === domain.id ||
                                                    disablingTrackingDomainId === domain.id
                                                  }
                                                >
                                                  {savingTrackingDomainId === domain.id ||
                                                  verifyingTrackingDomainId === domain.id ? (
                                                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                  ) : (
                                                    <Globe className="mr-2 h-4 w-4" />
                                                  )}
                                                  Manage tracking
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                  onClick={() => handleDisableTrackingDomain(domain.id)}
                                                  disabled={disablingTrackingDomainId === domain.id}
                                                >
                                                  {disablingTrackingDomainId === domain.id ? (
                                                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                  ) : (
                                                    <XCircle className="mr-2 h-4 w-4" />
                                                  )}
                                                  Disable tracking
                                                </DropdownMenuItem>
                                              </>
                                            ) : (
                                              <DropdownMenuItem
                                                onClick={() => openTrackingDomainDialog(domain)}
                                                disabled={
                                                  savingTrackingDomainId === domain.id ||
                                                  verifyingTrackingDomainId === domain.id
                                                }
                                              >
                                                {savingTrackingDomainId === domain.id ||
                                                verifyingTrackingDomainId === domain.id ? (
                                                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                  <MessageSquare className="mr-2 h-4 w-4" />
                                                )}
                                                Enable tracking
                                              </DropdownMenuItem>
                                            )}
                                          </>
                                        )}
                                        {showMenuDividerBeforeDelete && <DropdownMenuSeparator />}
                                        <DropdownMenuItem
                                          className="flex w-full items-center gap-2"
                                          disabled={bulkSubdomainsAtLimit}
                                          onClick={() => openBulkSubdomainDialog(domain)}
                                        >
                                          <Globe className="mr-2 h-4 w-4 shrink-0" />
                                          <span className="flex-1">Create domain or bulk sub domains</span>
                                          {bulkSubdomainsAtLimit ? (
                                            <span className="text-[10px] text-muted-foreground">
                                              Max {BULK_SUBDOMAIN_MAX_COUNT}
                                            </span>
                                          ) : null}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                          onClick={() => handleDeleteDomain(domain)}
                                        >
                                          <Trash2 className="mr-2 h-4 w-4" />
                                          Delete domain
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                  {canEnableReceiving &&
                                    (domain.inbound_parse_enabled ||
                                      (!row.isChild && domain.tracking_domain_verified)) && (
                                    <div className="flex flex-wrap justify-end gap-1 max-w-[11rem]">
                                      {domain.inbound_parse_enabled && (
                                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                                          Receiving on
                                        </Badge>
                                      )}
                                      {!row.isChild && domain.tracking_domain_verified && (
                                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                                          Tracking on
                                        </Badge>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </TableCell>
                        </TableRow>

                        {/* SendGrid DNS sub-row, shown only when Pigeon DNS is enabled for this domain */}
                        {domain.email_infra?.enabled && (
                          <TableRow key={`${domain.id}-sendgrid`} className="bg-muted/40">
                            <TableCell>
                              <div className="pl-6">
                                <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                  SendGrid DNS
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>{getStatusBadge(domain.status)}</TableCell>
                            <TableCell className="text-center">{getDnsStatus(domain.spf_verified)}</TableCell>
                            <TableCell className="text-center">{getDnsStatus(domain.dkim_verified)}</TableCell>
                            <TableCell className="text-center">{getDnsStatus(domain.dmarc_verified)}</TableCell>
                            <TableCell className="text-center">
                              {getDnsStatus(!!domain.mx_verified)}
                            </TableCell>
                            <TableCell className="text-center">
                              {domain.status === "verified" ? (
                                <div className="flex items-center justify-center gap-2">
                                  <Progress value={domain.health_score} className="w-16 h-2" />
                                  <span className={`font-medium ${getHealthColor(domain.health_score)}`}>
                                    {domain.health_score}%
                                  </span>
                                  <HealthScoreTooltip />
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                          </TableRow>
                        )}

                        {domain.email_infra?.enabled && (
                          <TableRow className="bg-muted/40">
                            <TableCell>
                              <div className="pl-6">
                                <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                  Pigeon DNS
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const infra = domain.email_infra as any;
                                const verify = infra?.last_verify_dns || {};
                                const spfOk = Boolean(verify?.spf?.ok ?? verify?.spf?.OK);
                                const dkimOk = Boolean(verify?.dkim?.ok ?? verify?.dkim?.OK);
                                const dmarcOk = Boolean(verify?.dmarc?.ok ?? verify?.dmarc?.OK);
                                const allOk = spfOk && dkimOk && dmarcOk;
                                const isReady = allOk || domain.email_infra?.status === "ready";

                                if (isReady) {
                                  return (
                                    <Badge className="text-[11px] bg-success text-success-foreground border-success hover:bg-success hover:text-success-foreground">
                                      Verified
                                    </Badge>
                                  );
                                }

                                if (domain.email_infra?.status) {
                                  return (
                                    <Badge variant="outline" className="text-[11px] capitalize">
                                      {domain.email_infra.status}
                                    </Badge>
                                  );
                                }

                                return <span className="text-xs text-muted-foreground">Not created</span>;
                              })()}
                            </TableCell>
                            <TableCell className="text-center">
                              {getDnsStatus(
                                Boolean(
                                  (domain.email_infra?.last_verify_dns as any)?.spf?.ok ??
                                    (domain.email_infra?.last_verify_dns as any)?.spf?.OK
                                )
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {getDnsStatus(
                                Boolean(
                                  (domain.email_infra?.last_verify_dns as any)?.dkim?.ok ??
                                    (domain.email_infra?.last_verify_dns as any)?.dkim?.OK
                                )
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {getDnsStatus(
                                Boolean(
                                  (domain.email_infra?.last_verify_dns as any)?.dmarc?.ok ??
                                    (domain.email_infra?.last_verify_dns as any)?.dmarc?.OK
                                )
                              )}
                            </TableCell>
                            <TableCell className="text-center text-xs text-muted-foreground">—</TableCell>
                            <TableCell className="text-center text-xs text-muted-foreground">—</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                className="justify-center gap-1.5 h-8"
                                onClick={() => {
                                  setSelectedDomain(domain);
                                }}
                                title="View Email Infra DNS records"
                              >
                                <Globe className="w-3.5 h-3.5 shrink-0" />
                                View DNS
                              </Button>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )})
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Dialog open={!!selectedDomain} onOpenChange={(open) => !open && setSelectedDomain(null)}>
            <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto p-0">
              <DialogHeader className="sr-only">
                <DialogTitle>
                  {selectedDomain ? `DNS Records for ${selectedDomain.domain}` : "DNS Records"}
                </DialogTitle>
                <DialogDescription>
                  Review and copy DNS records required to verify this domain.
                </DialogDescription>
              </DialogHeader>
              {selectedDomain ? (
              <Card className="rounded-none border-0 bg-card shadow-none">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <Shield className="h-5 w-5 text-primary" />
                    </span>
                    DNS Records for {selectedDomain.domain}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Add these records in your DNS provider. Name/Host is often auto-completed.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  {verifyingDomainId === selectedDomain?.id ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <RefreshCw className="w-8 h-8 text-primary animate-spin mb-4" />
                      <p className="text-muted-foreground">Verifying DNS records...</p>
                    </div>
                  ) : loadingDnsRecords ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <RefreshCw className="w-8 h-8 text-primary animate-spin mb-4" />
                      <p className="text-muted-foreground">Loading DNS records...</p>
                    </div>
                  ) : dnsRecords ? (
                    <>
                      <p className="text-muted-foreground">
                        Add these DNS records to your domain&apos;s DNS settings.{" "}
                        <span className="font-medium">
                          Use the full host names shown below. If your DNS provider asks for relative host labels, remove only the trailing
                          {" "}{selectedDomain?.domain}.
                        </span>
                      </p>
                      <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10">
                            <Clock className="h-4 w-4 text-warning" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-foreground">DNS propagation</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              DNS changes can take some time to propagate, after which your domain will be verified automatically. MX records can sometimes take a little longer than other records, which is completely normal.
                              If verification still does not complete, create a support ticket.
                            </p>
                            <Button
                              variant="default"
                              size="sm"
                              className="mt-3 no-underline"
                              onClick={handleCreateSupportTicket}
                              disabled={createTicket.isPending}
                            >
                              <MessageSquare className="w-4 h-4 mr-2" />
                              {createTicket.isPending ? "Creating…" : "Create support ticket"}
                            </Button>
                          </div>
                        </div>
                      </div>

                      {(() => {
                        return (
                          <Tabs defaultValue="guided" className="mt-4">
                            <TabsList>
                              <TabsTrigger value="guided">Guided view</TabsTrigger>
                              <TabsTrigger value="table">Table view</TabsTrigger>
                            </TabsList>

                            <TabsContent value="guided" className="mt-4">
                              <div className="space-y-4">
                                <div>
                                  <div className="flex items-center justify-between gap-2 mb-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      SendGrid DNS records
                                    </p>
                                    {selectedDomain?.sending_provider === "sendgrid" && (
                                      <Badge variant="secondary" className="text-[11px] font-normal">
                                        Active for sending
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">

                                    {/* SPF Record */}
                                    <Card className="overflow-hidden rounded-xl border border-border/60 shadow-none">
                                  <CardHeader className="pb-2 pt-4 px-4">
                                    <div className="flex items-center justify-between">
                                      <CardTitle className="text-sm font-semibold">SPF Record</CardTitle>
                                      {dnsRecords.spf.verified && (
                                        <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                                      )}
                                    </div>
                                  </CardHeader>
                                  <CardContent className="px-4 pb-4 pt-0 space-y-3">
                                    <div className="grid gap-1.5 text-xs">
                                      <div>
                                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Type</span>
                                        <p className="font-mono mt-0.5">{dnsRecords.spf.type}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Name</span>
                                        <p className="font-mono mt-0.5 break-all">{toFqdnHost(dnsRecords.spf.name, selectedDomain?.domain)}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Value</span>
                                        <div className="mt-1 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[11px] break-all">
                                          {dnsRecords.spf.value}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex gap-2">
                                      <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => copyToClipboard(toFqdnHost(dnsRecords.spf.name, selectedDomain?.domain))}>
                                        <Copy className="h-3 w-3 mr-1.5" /> Name
                                      </Button>
                                      <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => copyToClipboard(dnsRecords.spf.value)}>
                                        <Copy className="h-3 w-3 mr-1.5" /> Value
                                      </Button>
                                    </div>
                                  </CardContent>
                                    </Card>

                                    {/* DKIM Record */}
                                    <Card className="overflow-hidden rounded-xl border border-border/60 shadow-none">
                                  <CardHeader className="pb-2 pt-4 px-4">
                                    <div className="flex items-center justify-between">
                                      <CardTitle className="text-sm font-semibold">DKIM Record</CardTitle>
                                      {dnsRecords.dkim.verified && (
                                        <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                                      )}
                                    </div>
                                  </CardHeader>
                                  <CardContent className="px-4 pb-4 pt-0 space-y-3">
                                    <div className="grid gap-1.5 text-xs">
                                      <div>
                                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Type</span>
                                        <p className="font-mono mt-0.5">{dnsRecords.dkim.type}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Name</span>
                                        <p className="font-mono mt-0.5 break-all">{toFqdnHost(dnsRecords.dkim.name, selectedDomain?.domain)}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Value</span>
                                        <div className="mt-1 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[11px] break-all">
                                          {dnsRecords.dkim.value}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex gap-2">
                                      <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => copyToClipboard(toFqdnHost(dnsRecords.dkim.name, selectedDomain?.domain))}>
                                        <Copy className="h-3 w-3 mr-1.5" /> Name
                                      </Button>
                                      <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => copyToClipboard(dnsRecords.dkim.value)}>
                                        <Copy className="h-3 w-3 mr-1.5" /> Value
                                      </Button>
                                    </div>
                                  </CardContent>
                                    </Card>

                                    {/* DMARC Record */}
                                    <Card className="overflow-hidden rounded-xl border border-border/60 shadow-none">
                                  <CardHeader className="pb-2 pt-4 px-4">
                                    <div className="flex items-center justify-between">
                                      <CardTitle className="text-sm font-semibold">DMARC Record</CardTitle>
                                      {dnsRecords.dmarc.verified && (
                                        <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                                      )}
                                    </div>
                                  </CardHeader>
                                  <CardContent className="px-4 pb-4 pt-0 space-y-3">
                                    <div className="grid gap-1.5 text-xs">
                                      <div>
                                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Type</span>
                                        <p className="font-mono mt-0.5">{dnsRecords.dmarc.type}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Name</span>
                                        <p className="font-mono mt-0.5 break-all">{toFqdnHost(dnsRecords.dmarc.name, selectedDomain?.domain)}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Value</span>
                                        <div className="mt-1 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[11px] break-all">
                                          {dnsRecords.dmarc.value}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex gap-2">
                                      <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => copyToClipboard(toFqdnHost(dnsRecords.dmarc.name, selectedDomain?.domain))}>
                                        <Copy className="h-3 w-3 mr-1.5" /> Name
                                      </Button>
                                      <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => copyToClipboard(dnsRecords.dmarc.value)}>
                                        <Copy className="h-3 w-3 mr-1.5" /> Value
                                      </Button>
                                    </div>
                                  </CardContent>
                                    </Card>

                                    {/* CNAME Record */}
                                    {dnsRecords.provider_specific?.cname_records &&
                                      dnsRecords.provider_specific.cname_records.length > 0 && (
                                        <Card className="overflow-hidden rounded-xl border border-border/60 shadow-none">
                                      <CardHeader className="pb-2 pt-4 px-4">
                                        <div className="flex items-center justify-between">
                                          <CardTitle className="text-sm font-semibold">CNAME Record</CardTitle>
                                          {!!selectedDomain.cname_verified && (
                                            <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                                          )}
                                        </div>
                                      </CardHeader>
                                      <CardContent className="px-4 pb-4 pt-0 space-y-3">
                                        <div className="grid gap-1.5 text-xs">
                                          <div>
                                            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Type</span>
                                            <p className="font-mono mt-0.5">{dnsRecords.provider_specific.cname_records[0]?.type}</p>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Name</span>
                                            <p className="font-mono mt-0.5 break-all">{toFqdnHost(dnsRecords.provider_specific.cname_records[0]?.name, selectedDomain?.domain)}</p>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Value</span>
                                            <div className="mt-1 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[11px] break-all">
                                              {dnsRecords.provider_specific.cname_records[0]?.value}
                                            </div>
                                          </div>
                                        </div>
                                        <div className="flex gap-2">
                                          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => copyToClipboard(toFqdnHost(dnsRecords.provider_specific?.cname_records?.[0]?.name ?? "", selectedDomain?.domain))}>
                                            <Copy className="h-3 w-3 mr-1.5" /> Name
                                          </Button>
                                          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => copyToClipboard(dnsRecords.provider_specific?.cname_records?.[0]?.value ?? "")}>
                                            <Copy className="h-3 w-3 mr-1.5" /> Value
                                          </Button>
                                        </div>
                                      </CardContent>
                                        </Card>
                                      )}

                                    {/* MX Record */}
                                    {dnsRecords.provider_specific?.mx_records &&
                                      dnsRecords.provider_specific.mx_records.length > 0 && (
                                        <Card className="overflow-hidden rounded-xl border border-border/60 shadow-none">
                                      <CardHeader className="pb-2 pt-4 px-4">
                                        <div className="flex items-center justify-between">
                                          <CardTitle className="text-sm font-semibold">MX Record</CardTitle>
                                          {!!selectedDomain.mx_verified && (
                                            <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                                          )}
                                        </div>
                                      </CardHeader>
                                      <CardContent className="px-4 pb-4 pt-0 space-y-3">
                                        <div className="grid gap-1.5 text-xs">
                                          <div>
                                            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Type</span>
                                            <p className="font-mono mt-0.5">{dnsRecords.provider_specific.mx_records[0]?.type}</p>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Name</span>
                                            <p className="font-mono mt-0.5 break-all">{toFqdnHost(dnsRecords.provider_specific.mx_records[0]?.name, selectedDomain?.domain)}</p>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Priority</span>
                                            <p className="font-mono mt-0.5">{dnsRecords.provider_specific.mx_records[0]?.priority}</p>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Value</span>
                                            <div className="mt-1 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[11px] break-all">
                                              {dnsRecords.provider_specific.mx_records[0]?.value}
                                            </div>
                                          </div>
                                        </div>
                                        <div className="flex gap-2">
                                          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => copyToClipboard(toFqdnHost(dnsRecords.provider_specific?.mx_records?.[0]?.name ?? "", selectedDomain?.domain))}>
                                            <Copy className="h-3 w-3 mr-1.5" /> Name
                                          </Button>
                                          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => copyToClipboard(dnsRecords.provider_specific?.mx_records?.[0]?.value ?? "")}>
                                            <Copy className="h-3 w-3 mr-1.5" /> Value
                                          </Button>
                                        </div>
                                      </CardContent>
                                        </Card>
                                      )}
                                  </div>
                                </div>

                                {dnsRecords.email_infra?.enabled &&
                                  (dnsRecords.email_infra.spf ||
                                    dnsRecords.email_infra.dkim ||
                                    dnsRecords.email_infra.dmarc) && (
                                    <div>
                                      <div className="flex items-center justify-between gap-2 mb-2">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                          PIGEON DNS RECORDS
                                        </p>
                                        {selectedDomain?.sending_provider === "email_infra" && (
                                          <Badge variant="secondary" className="text-[11px] font-normal">
                                            Active for sending
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="grid gap-4 md:grid-cols-3">
                                        {dnsRecords.email_infra.spf && (
                                          <Card className="overflow-hidden rounded-xl border border-border/60 shadow-none">
                                            <CardHeader className="pb-2 pt-4 px-4">
                                              <div className="flex items-center justify-between">
                                                <CardTitle className="text-sm font-semibold">SPF TXT (Email Infra)</CardTitle>
                                                {dnsRecords.email_infra.last_verify_dns &&
                                                  ((dnsRecords.email_infra.last_verify_dns as any)?.spf?.ok ??
                                                    (dnsRecords.email_infra.last_verify_dns as any)?.spf?.OK) && (
                                                    <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                                                  )}
                                              </div>
                                            </CardHeader>
                                            <CardContent className="px-4 pb-4 pt-0 space-y-3">
                                              <div className="grid gap-1.5 text-xs">
                                                <div>
                                      <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
                                        Type
                                      </span>
                                      <p className="font-mono mt-0.5">TXT</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
                                        Name
                                      </span>
                                      <p className="font-mono mt-0.5 break-all">@</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
                                        Value
                                      </span>
                                      <div className="mt-1 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[11px] break-all">
                                        {dnsRecords.email_infra.spf}
                                      </div>
                                                </div>
                                              </div>
                                              <div className="flex gap-2">
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  className="flex-1 text-xs"
                                                  onClick={() => copyToClipboard(dnsRecords.email_infra?.spf ?? "")}
                                                >
                                                  <Copy className="h-3 w-3 mr-1.5" /> Copy value
                                                </Button>
                                              </div>
                                            </CardContent>
                                          </Card>
                                        )}
                                        {dnsRecords.email_infra.dkim && (
                                          <Card className="overflow-hidden rounded-xl border border-border/60 shadow-none">
                                            <CardHeader className="pb-2 pt-4 px-4">
                                              <div className="flex items-center justify-between">
                                                <CardTitle className="text-sm font-semibold">DKIM TXT (Email Infra)</CardTitle>
                                                {dnsRecords.email_infra.last_verify_dns &&
                                                  ((dnsRecords.email_infra.last_verify_dns as any)?.dkim?.ok ??
                                                    (dnsRecords.email_infra.last_verify_dns as any)?.dkim?.OK) && (
                                                    <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                                                  )}
                                              </div>
                                            </CardHeader>
                                            <CardContent className="px-4 pb-4 pt-0 space-y-3">
                                              <div className="grid gap-1.5 text-xs">
                                                <div>
                                                  <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
                                                    Type
                                                  </span>
                                                  <p className="font-mono mt-0.5">TXT</p>
                                                </div>
                                                <div>
                                                  <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
                                                    Name
                                                  </span>
                                                  <p className="font-mono mt-0.5 break-all">mail._domainkey</p>
                                                </div>
                                                <div>
                                                  <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
                                                    Value
                                                  </span>
                                                  <div className="mt-1 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[11px] break-all">
                                                    {dnsRecords.email_infra.dkim}
                                                  </div>
                                                </div>
                                              </div>
                                              <div className="flex gap-2">
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  className="flex-1 text-xs"
                                                  onClick={() => copyToClipboard(dnsRecords.email_infra?.dkim ?? "")}
                                                >
                                                  <Copy className="h-3 w-3 mr-1.5" /> Copy value
                                                </Button>
                                              </div>
                                            </CardContent>
                                          </Card>
                                        )}
                                        {dnsRecords.email_infra.dmarc && (
                                          <Card className="overflow-hidden rounded-xl border border-border/60 shadow-none">
                                            <CardHeader className="pb-2 pt-4 px-4">
                                              <div className="flex items-center justify-between">
                                                <CardTitle className="text-sm font-semibold">DMARC TXT (Email Infra)</CardTitle>
                                                {dnsRecords.email_infra.last_verify_dns &&
                                                  ((dnsRecords.email_infra.last_verify_dns as any)?.dmarc?.ok ??
                                                    (dnsRecords.email_infra.last_verify_dns as any)?.dmarc?.OK) && (
                                                    <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                                                  )}
                                              </div>
                                            </CardHeader>
                                            <CardContent className="px-4 pb-4 pt-0 space-y-3">
                                              <div className="grid gap-1.5 text-xs">
                                                <div>
                                                  <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
                                                    Type
                                                  </span>
                                                  <p className="font-mono mt-0.5">TXT</p>
                                                </div>
                                                <div>
                                                  <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
                                                    Name
                                                  </span>
                                                  <p className="font-mono mt-0.5 break-all">_dmarc</p>
                                                </div>
                                                <div>
                                                  <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
                                                    Value
                                                  </span>
                                                  <div className="mt-1 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[11px] break-all">
                                                    {dnsRecords.email_infra.dmarc}
                                                  </div>
                                                </div>
                                              </div>
                                              <div className="flex gap-2">
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  className="flex-1 text-xs"
                                                  onClick={() => copyToClipboard(dnsRecords.email_infra?.dmarc ?? "")}
                                                >
                                                  <Copy className="h-3 w-3 mr-1.5" /> Copy value
                                                </Button>
                                              </div>
                                            </CardContent>
                                          </Card>
                                        )}
                                      </div>
                                    </div>
                                  )}

                              </div>
                            </TabsContent>

                            <TabsContent value="table" className="mt-4">
                              <div className="space-y-4">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    SendGrid DNS records
                                  </p>
                                  {selectedDomain?.sending_provider === "sendgrid" && (
                                    <Badge variant="secondary" className="text-[11px] font-normal">
                                      Active for sending
                                    </Badge>
                                  )}
                                </div>
                                <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Record</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Name / Host</TableHead>
                                    <TableHead>Value</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  <TableRow>
                                    <TableCell>SPF</TableCell>
                                    <TableCell>{dnsRecords.spf.type}</TableCell>
                                    <TableCell className="font-mono text-xs">{toFqdnHost(dnsRecords.spf.name, selectedDomain?.domain)}</TableCell>
                                    <TableCell className="font-mono text-xs max-w-xs break-all">
                                      {dnsRecords.spf.value}
                                    </TableCell>
                                    <TableCell className="text-right space-x-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => copyToClipboard(toFqdnHost(dnsRecords.spf.name, selectedDomain?.domain))}
                                      >
                                        Copy name
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => copyToClipboard(dnsRecords.spf.value)}
                                      >
                                        Copy value
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell>DKIM</TableCell>
                                    <TableCell>{dnsRecords.dkim.type}</TableCell>
                                    <TableCell className="font-mono text-xs">{toFqdnHost(dnsRecords.dkim.name, selectedDomain?.domain)}</TableCell>
                                    <TableCell className="font-mono text-xs max-w-xs break-all">
                                      {dnsRecords.dkim.value}
                                    </TableCell>
                                    <TableCell className="text-right space-x-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => copyToClipboard(toFqdnHost(dnsRecords.dkim.name, selectedDomain?.domain))}
                                      >
                                        Copy name
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => copyToClipboard(dnsRecords.dkim.value)}
                                      >
                                        Copy value
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell>DMARC</TableCell>
                                    <TableCell>{dnsRecords.dmarc.type}</TableCell>
                                    <TableCell className="font-mono text-xs">{toFqdnHost(dnsRecords.dmarc.name, selectedDomain?.domain)}</TableCell>
                                    <TableCell className="font-mono text-xs max-w-xs break-all">
                                      {dnsRecords.dmarc.value}
                                    </TableCell>
                                    <TableCell className="text-right space-x-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => copyToClipboard(toFqdnHost(dnsRecords.dmarc.name, selectedDomain?.domain))}
                                      >
                                        Copy name
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => copyToClipboard(dnsRecords.dmarc.value)}
                                      >
                                        Copy value
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                  {dnsRecords.provider_specific?.cname_records &&
                                    dnsRecords.provider_specific.cname_records.length > 0 && (
                                      <TableRow>
                                        <TableCell>CNAME</TableCell>
                                        <TableCell>
                                          {dnsRecords.provider_specific.cname_records[0]?.type}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                          {toFqdnHost(dnsRecords.provider_specific.cname_records[0]?.name, selectedDomain?.domain)}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs max-w-xs break-all">
                                          {dnsRecords.provider_specific.cname_records[0]?.value}
                                        </TableCell>
                                        <TableCell className="text-right space-x-1">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                              copyToClipboard(
                                                toFqdnHost(dnsRecords.provider_specific?.cname_records?.[0]?.name ?? "", selectedDomain?.domain)
                                              )
                                            }
                                          >
                                            Copy name
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                              copyToClipboard(
                                                dnsRecords.provider_specific?.cname_records?.[0]?.value ?? ""
                                              )
                                            }
                                          >
                                            Copy value
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    )}
                                  {dnsRecords.provider_specific?.mx_records &&
                                    dnsRecords.provider_specific.mx_records.length > 0 && (
                                      <TableRow>
                                        <TableCell>MX</TableCell>
                                        <TableCell>
                                          {dnsRecords.provider_specific.mx_records[0]?.type}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                          {toFqdnHost(dnsRecords.provider_specific.mx_records[0]?.name, selectedDomain?.domain)}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs max-w-xs break-all">
                                          {dnsRecords.provider_specific.mx_records[0]?.value}
                                        </TableCell>
                                        <TableCell className="text-right space-x-1">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                              copyToClipboard(
                                                toFqdnHost(dnsRecords.provider_specific?.mx_records?.[0]?.name ?? "", selectedDomain?.domain)
                                              )
                                            }
                                          >
                                            Copy name
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                              copyToClipboard(
                                                dnsRecords.provider_specific?.mx_records?.[0]?.value ?? ""
                                              )
                                            }
                                          >
                                            Copy value
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    )}
                                </TableBody>
                              </Table>

                              {dnsRecords.email_infra?.enabled &&
                                (dnsRecords.email_infra.spf ||
                                  dnsRecords.email_infra.dkim ||
                                  dnsRecords.email_infra.dmarc) && (
                                  <>
                                    <div className="mt-4 flex items-center justify-between gap-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        PIGEON DNS RECORDS
                                      </p>
                                      {selectedDomain?.sending_provider === "email_infra" && (
                                        <Badge variant="secondary" className="text-[11px] font-normal">
                                          Active for sending
                                        </Badge>
                                      )}
                                    </div>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Record</TableHead>
                                          <TableHead>Type</TableHead>
                                          <TableHead>Name / Host</TableHead>
                                          <TableHead>Value</TableHead>
                                          <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {dnsRecords.email_infra.spf && (
                                          <TableRow>
                                            <TableCell>SPF (Email Infra)</TableCell>
                                            <TableCell>TXT</TableCell>
                                            <TableCell className="font-mono text-xs">@</TableCell>
                                            <TableCell className="font-mono text-xs max-w-xs break-all">
                                              {dnsRecords.email_infra.spf}
                                            </TableCell>
                                            <TableCell className="text-right space-x-1">
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => copyToClipboard(dnsRecords.email_infra?.spf ?? "")}
                                              >
                                                Copy value
                                              </Button>
                                            </TableCell>
                                          </TableRow>
                                        )}
                                        {dnsRecords.email_infra.dkim && (
                                          <TableRow>
                                            <TableCell>DKIM (Email Infra)</TableCell>
                                            <TableCell>TXT</TableCell>
                                            <TableCell className="font-mono text-xs">mail._domainkey</TableCell>
                                            <TableCell className="font-mono text-xs max-w-xs break-all">
                                              {dnsRecords.email_infra.dkim}
                                            </TableCell>
                                            <TableCell className="text-right space-x-1">
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => copyToClipboard(dnsRecords.email_infra?.dkim ?? "")}
                                              >
                                                Copy value
                                              </Button>
                                            </TableCell>
                                          </TableRow>
                                        )}
                                        {dnsRecords.email_infra.dmarc && (
                                          <TableRow>
                                            <TableCell>DMARC (Email Infra)</TableCell>
                                            <TableCell>TXT</TableCell>
                                            <TableCell className="font-mono text-xs">_dmarc</TableCell>
                                            <TableCell className="font-mono text-xs max-w-xs break-all">
                                              {dnsRecords.email_infra.dmarc}
                                            </TableCell>
                                            <TableCell className="text-right space-x-1">
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => copyToClipboard(dnsRecords.email_infra?.dmarc ?? "")}
                                              >
                                                Copy value
                                              </Button>
                                            </TableCell>
                                          </TableRow>
                                        )}
                                      </TableBody>
                                    </Table>
                                  </>
                                )}
                              </div>
                            </TabsContent>
                          </Tabs>
                        );

                      })()}

                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleVerifyDomain(selectedDomain.id)}
                          disabled={verifyingDomainId === selectedDomain.id}
                        >
                          <RefreshCw
                            className={`w-4 h-4 mr-2 ${verifyingDomainId === selectedDomain.id ? "animate-spin" : ""}`}
                          />
                          Verify DNS Records
                        </Button>
                        <Button variant="outline" onClick={() => setSelectedDomain(null)}>
                          Close
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12">
                      <p className="text-muted-foreground">No DNS records available</p>
                      <Button variant="outline" onClick={() => setSelectedDomain(null)} className="mt-4">
                        Close
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
              ) : null}
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!bulkSubdomainDialogDomain}
        onOpenChange={(open) => !open && !creatingBulkSubdomains && setBulkSubdomainDialogDomain(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create domain or bulk sub domains</DialogTitle>
            <DialogDescription>
              Generate multiple subdomains for <span className="font-medium">{bulkSubdomainDialogDomain?.domain}</span> in one step.
              {bulkSubdomainDialogDomain ? (
                <span className="mt-2 block text-xs text-muted-foreground">
                  {subdomainCountByParentId.get(bulkSubdomainDialogDomain.id) ?? 0} of {BULK_SUBDOMAIN_MAX_COUNT}{" "}
                  subdomains already exist for this domain
                  {bulkSubdomainRemainingSlots > 0
                    ? ` — you can add up to ${bulkSubdomainRemainingSlots} more.`
                    : ` — limit reached.`}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {creatingBulkSubdomains && bulkSubdomainLiveJob ? (
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                <p className="text-xs font-medium text-foreground">
                  Live status: {bulkSubdomainLiveJob.status}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Processed {bulkSubdomainLiveJob.processed_count ?? 0} / {bulkSubdomainLiveJob.total_count ?? 0}
                  {" · "}Created {bulkSubdomainLiveJob.created_count}
                  {" · "}Pending {bulkSubdomainLiveJob.pending_count ?? 0}
                  {" · "}Failed {bulkSubdomainLiveJob.failed_count}
                  {" · "}Skipped {bulkSubdomainLiveJob.skipped_count}
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">How many</label>
              <Input
                type="number"
                min={1}
                max={Math.max(1, bulkSubdomainRemainingSlots)}
                value={bulkSubdomainCount}
                disabled={creatingBulkSubdomains || bulkSubdomainRemainingSlots <= 0}
                onChange={(e) => {
                  const cap = Math.max(1, bulkSubdomainRemainingSlots);
                  const nextCount = Math.max(1, Math.min(cap, Number(e.target.value) || 1));
                  setBulkSubdomainCount(nextCount);
                  setBulkSubdomainSelections((prev) => {
                    if (prev.length === nextCount) return prev;
                    if (prev.length > nextCount) return prev.slice(0, nextCount);
                    const pool = BULK_SUBDOMAIN_RANDOM_POOL.filter((name) => !prev.includes(name));
                    const extras = [...pool].sort(() => Math.random() - 0.5).slice(0, nextCount - prev.length);
                    return [...prev, ...extras];
                  });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Batch size is limited to your remaining allowance (max {BULK_SUBDOMAIN_MAX_COUNT} subdomains per domain).
                Names are randomly selected from {BULK_SUBDOMAIN_RANDOM_POOL.length} preset options.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleShuffleBulkSubdomains}
                disabled={creatingBulkSubdomains || bulkSubdomainRemainingSlots <= 0}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Shuffle
              </Button>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Selected subdomains (editable)</label>
              <div className="max-h-52 space-y-2 overflow-auto rounded-md border border-border/60 p-2">
                {bulkSubdomainSelections.map((name, idx) => (
                  <Input
                    key={`${name}-${idx}`}
                    value={name}
                    onChange={(e) =>
                      setBulkSubdomainSelections((prev) =>
                        prev.map((item, itemIdx) => (itemIdx === idx ? e.target.value : item))
                      )
                    }
                    placeholder={`subdomain-${idx + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={creatingBulkSubdomains}
              onClick={() => setBulkSubdomainDialogDomain(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                !bulkSubdomainDialogDomain ||
                creatingBulkSubdomains ||
                bulkSubdomainRemainingSlots <= 0
              }
              onClick={handleCreateBulkSubdomains}
            >
              {creatingBulkSubdomains ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create subdomains
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!enableReceivingDialogDomain}
        onOpenChange={(open) => !open && setEnableReceivingDialogDomain(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>Add MX record for receiving</DialogTitle>
              <Listen componentId="AddMXRecordForReceiving" className="shrink-0" />
            </div>
            <DialogDescription>
              Add the following MX record to your domain&apos;s DNS settings so we can receive mail for{" "}
              {enableReceivingDialogDomain?.domain}. Then click the button below to verify and enable receiving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium">DNS record to add:</p>
            <div className="rounded-lg border bg-muted/30 p-3 font-mono text-sm">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Type</span>
                <span>{receivingMxRecord.type}</span>
                <span className="text-muted-foreground">Name</span>
                <span>{receivingMxRecord.name}</span>
                <span className="text-muted-foreground">Priority</span>
                <span>{receivingMxRecord.priority}</span>
                <span className="text-muted-foreground">Value</span>
                <span>{receivingMxRecord.value}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  void navigator.clipboard.writeText(receivingMxRecord.name);
                  toast.success("Name copied to clipboard");
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy name
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  void navigator.clipboard.writeText(receivingMxRecord.value);
                  toast.success("Value copied to clipboard");
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy value
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnableReceivingDialogDomain(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEnableReceivingDialogSubmit}
              disabled={!enableReceivingDialogDomain || enablingReceivingDomainId === enableReceivingDialogDomain?.id}
            >
              {enablingReceivingDomainId === enableReceivingDialogDomain?.id ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              I&apos;ve added the record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mailTestDialogOpen} onOpenChange={setMailTestDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Test mode verification</DialogTitle>
            <DialogDescription>
              {mailTestResult ? `Domain: ${mailTestResult.domain}` : "Running send/receive verification"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-md border p-3">
              <span>Sender check</span>
              {mailTestResult?.senderOk ? (
                <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle className="h-4 w-4" /> Passed</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground"><Clock className="h-4 w-4" /> Pending</span>
              )}
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <span>Recipient check</span>
              {mailTestResult?.recipientOk ? (
                <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle className="h-4 w-4" /> Passed</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground"><Clock className="h-4 w-4" /> Pending</span>
              )}
            </div>
            <div className="rounded-md border p-3">
              <div className="mb-1 flex items-center justify-between">
                <span>Receive signal</span>
                {mailTestResult?.receiveStatus === "success" ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle className="h-4 w-4" /> Success</span>
                  ) : mailTestResult?.receiveStatus === "failed" ? (
                    <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="h-4 w-4" /> Failed</span>
                ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600"><Clock className="h-4 w-4" /> Pending</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{mailTestResult?.receiveMessage || "Waiting..."}</p>
              {mailTestResult?.senderEmail || mailTestResult?.recipientEmail ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  From {mailTestResult.senderEmail || "domain inbox"} to {mailTestResult.recipientEmail || "recipient"}
                  {mailTestResult.recipientSource === "connected_gmail"
                    ? " (connected Gmail)"
                    : mailTestResult.recipientSource === "backend_receiver_pool"
                      ? " (backend receiver pool)"
                      : ""}
                </p>
              ) : null}
            </div>
            {mailTestResult?.reverseEnabled ? (
              <div className="rounded-md border p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span>Reverse signal</span>
                  {mailTestResult?.reverseStatus === "success" ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle className="h-4 w-4" /> Success</span>
                  ) : mailTestResult?.reverseStatus === "failed" ? (
                    <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="h-4 w-4" /> Failed</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600"><Clock className="h-4 w-4" /> Pending</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{mailTestResult?.reverseMessage || "Waiting..."}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  From {mailTestResult.recipientEmail || "recipient"} to {mailTestResult.senderEmail || "sender"}
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={() => setMailTestDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!trackingDomainDialogDomain}
        onOpenChange={(open) => !open && setTrackingDomainDialogDomain(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Custom tracking domain</DialogTitle>
            <DialogDescription>
              Set a branded tracking domain for <span className="font-medium">{trackingDomainDialogDomain?.domain}</span>.
              Add the CNAME below in your DNS, then verify.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-stretch">
              <Input
                placeholder={DEFAULT_TRACKING_SUBDOMAIN_LABEL}
                value={trackingSubdomainInput}
                onChange={(e) => setTrackingSubdomainInput(e.target.value)}
                className="rounded-r-none"
              />
              <div className="flex items-center rounded-l-none rounded-r-md border border-l-0 border-border/80 bg-muted/40 px-3 text-sm font-mono">
                .{trackingDomainDialogDomain?.domain?.replace(/\.$/, "") || "yourdomain.com"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={pickRandomTrackingSubdomain}
                disabled={savingTrackingDomainId === trackingDomainDialogDomain?.id || verifyingTrackingDomainId === trackingDomainDialogDomain?.id}
              >
                Random pick
              </Button>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 font-mono text-sm">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Type</span>
                <span>CNAME</span>
                <span className="text-muted-foreground">Name</span>
                <span>
                  {getTrackingCnameDnsRecordName(
                    trackingDomainDialogDomain?.domain?.replace(/\.$/, "") || "",
                    trackingSubdomainInput.trim() || DEFAULT_TRACKING_SUBDOMAIN_LABEL
                  )}
                </span>
                <span className="text-muted-foreground">Value</span>
                <span>{(dnsRecords?.tracking?.cname_target || "track.pigeon.com").replace(/\.$/, "")}</span>
              </div>
            </div>
            {(() => {
              const host = (trackingDomainDialogDomain?.domain || "").trim().replace(/\.$/, "");
              const parts = host.split(".").filter(Boolean);
              if (parts.length <= 2) return null;
              return (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Add this at the DNS zone for{" "}
                  <span className="font-medium text-foreground">{getRegistrableApexDomain(host)}</span>. If your
                  provider only has a zone for{" "}
                  <span className="font-mono text-[11px] text-foreground">{host}</span>, use{" "}
                  <span className="font-mono text-[11px] text-foreground">
                    {trackingSubdomainInput.trim() || DEFAULT_TRACKING_SUBDOMAIN_LABEL}
                  </span>{" "}
                  as the record name instead.
                </p>
              );
            })()}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    getTrackingCnameDnsRecordName(
                      trackingDomainDialogDomain?.domain?.replace(/\.$/, "") || "",
                      trackingSubdomainInput.trim() || DEFAULT_TRACKING_SUBDOMAIN_LABEL
                    )
                  );
                  toast.success("Name copied to clipboard");
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy name
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    (dnsRecords?.tracking?.cname_target || "track.pigeon.com").replace(/\.$/, "")
                  );
                  toast.success("Value copied to clipboard");
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy value
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrackingDomainDialogDomain(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleTrackingDomainDialogSubmit}
              disabled={
                !trackingDomainDialogDomain ||
                !trackingSubdomainInput.trim() ||
                savingTrackingDomainId === trackingDomainDialogDomain?.id ||
                verifyingTrackingDomainId === trackingDomainDialogDomain?.id
              }
            >
              {trackingDomainDialogDomain && (savingTrackingDomainId === trackingDomainDialogDomain.id || verifyingTrackingDomainId === trackingDomainDialogDomain.id) ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              I&apos;ve added the record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dnsProviderDialogOpen} onOpenChange={setDnsProviderDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect DNS provider API</DialogTitle>
            <DialogDescription>
              Connect your DNS provider so Pigeon can add SPF, DKIM, DMARC, MX, and CNAME records automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm font-medium">Provider</label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={dnsProvider}
              onChange={(e) => setDnsProvider(e.target.value as DNSProviderConnection["provider"])}
              disabled={savingDnsProvider}
            >
              <option value="cloudflare">Cloudflare</option>
              <option value="godaddy">GoDaddy</option>
              <option value="namecheap">Namecheap</option>
              <option value="clouddns">Google Cloud DNS</option>
            </select>
            {dnsProvider === "cloudflare" ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">API token</label>
                <Input
                  type="password"
                  value={dnsProviderCredentials.api_token || ""}
                  onChange={(e) => setDnsProviderCredentials((p) => ({ ...p, api_token: e.target.value }))}
                  placeholder="Cloudflare API token"
                  disabled={savingDnsProvider}
                />
              </div>
            ) : null}
            {dnsProvider === "godaddy" ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">API key</label>
                  <Input
                    value={dnsProviderCredentials.api_key || ""}
                    onChange={(e) => setDnsProviderCredentials((p) => ({ ...p, api_key: e.target.value }))}
                    placeholder="GoDaddy API key"
                    disabled={savingDnsProvider}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">API secret</label>
                  <Input
                    type="password"
                    value={dnsProviderCredentials.api_secret || ""}
                    onChange={(e) => setDnsProviderCredentials((p) => ({ ...p, api_secret: e.target.value }))}
                    placeholder="GoDaddy API secret"
                    disabled={savingDnsProvider}
                  />
                </div>
              </>
            ) : null}
            {dnsProvider === "namecheap" ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">API user</label>
                  <Input
                    value={dnsProviderCredentials.api_user || ""}
                    onChange={(e) => setDnsProviderCredentials((p) => ({ ...p, api_user: e.target.value }))}
                    placeholder="Namecheap account username"
                    disabled={savingDnsProvider}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">API key</label>
                  <Input
                    type="password"
                    value={dnsProviderCredentials.api_key || ""}
                    onChange={(e) => setDnsProviderCredentials((p) => ({ ...p, api_key: e.target.value }))}
                    placeholder="Namecheap API key"
                    disabled={savingDnsProvider}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Client IP (whitelisted)</label>
                  <Input
                    value={dnsProviderCredentials.client_ip || ""}
                    onChange={(e) => setDnsProviderCredentials((p) => ({ ...p, client_ip: e.target.value }))}
                    placeholder="x.x.x.x"
                    disabled={savingDnsProvider}
                  />
                </div>
              </>
            ) : null}
            {dnsProvider === "clouddns" ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Service account key (JSON)</label>
                  <textarea
                    value={dnsProviderCredentials.service_account_json || ""}
                    onChange={(e) =>
                      setDnsProviderCredentials((p) => ({ ...p, service_account_json: e.target.value }))
                    }
                    placeholder='{"type":"service_account","project_id":"...","private_key":"..."}'
                    rows={5}
                    disabled={savingDnsProvider}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y disabled:opacity-50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Needs the <span className="font-mono">roles/dns.admin</span> role on the project.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Project ID (optional)</label>
                  <Input
                    value={dnsProviderCredentials.project_id || ""}
                    onChange={(e) => setDnsProviderCredentials((p) => ({ ...p, project_id: e.target.value }))}
                    placeholder="Taken from the key when left blank"
                    disabled={savingDnsProvider}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Managed zone (optional)</label>
                  <Input
                    value={dnsProviderCredentials.managed_zone || ""}
                    onChange={(e) => setDnsProviderCredentials((p) => ({ ...p, managed_zone: e.target.value }))}
                    placeholder="Looked up by domain when left blank"
                    disabled={savingDnsProvider}
                  />
                </div>
              </>
            ) : null}
            {dnsProviderConnections.length > 0 ? (
              <div className="max-h-40 overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 text-xs">
                {dnsProviderConnections.map((item) => (
                  <div key={item.provider} className="flex flex-col gap-0.5 py-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="capitalize shrink-0">{item.provider}</span>
                    <span
                      className="max-w-full truncate text-muted-foreground sm:max-w-[260px]"
                      title={
                        item.connected
                          ? `Connected ${
                              item.credential_previews && Object.keys(item.credential_previews).length > 0
                                ? `(${Object.entries(item.credential_previews)
                                    .map(([k, v]) => `${k}:${v}`)
                                    .join(", ")})`
                                : ""
                            }`
                          : "Not connected"
                      }
                    >
                      {item.connected
                        ? `Connected ${
                            item.credential_previews && Object.keys(item.credential_previews).length > 0
                              ? `(${Object.entries(item.credential_previews)
                                  .map(([k, v]) => `${k}:${v}`)
                                  .join(", ")})`
                              : ""
                          }`
                        : "Not connected"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDnsProviderDialogOpen(false)} disabled={savingDnsProvider || disconnectingDnsProvider}>
              Cancel
            </Button>
            <Button variant="outline" onClick={handleDisconnectDnsProvider} disabled={savingDnsProvider || disconnectingDnsProvider}>
              {disconnectingDnsProvider ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
              Disconnect
            </Button>
            <Button onClick={handleConnectDnsProvider} disabled={savingDnsProvider || disconnectingDnsProvider}>
              {savingDnsProvider ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save connection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HelpLinks
        slugs={[
          "add-verify-sending-domain-pigeon",
          "add-smtp-inbox-accounts-domain",
          "add-first-gmail-smtp-inbox",
        ]}
        className="mt-6"
      />
    </div>
    </AppPageShell>
  );
}
