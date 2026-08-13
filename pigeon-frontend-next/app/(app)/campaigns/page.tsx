"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Plus,
  Play,
  Mail,
  Eye,
  MousePointerClick,
  MessageSquare,
  Filter,
  Loader2,
  Shield,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { usePaginatedCampaigns, useStartCampaign, usePauseCampaign, useCampaignComplianceStatus } from "@/hooks/useCampaigns";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useInboxes } from "@/hooks/useInboxes";
import { useDomains } from "@/hooks/useDomains";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CampaignRow } from "@/components/CampaignRow";
import { AppPageShell } from "@/components/AppPageShell";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlanGate } from "@/hooks/usePlanGate";
import { PremiumBadge } from "@/components/PremiumBadge";
import { UpgradeModal } from "@/components/UpgradeModal";
import { HelpLinks } from "@/components/HelpLinks";
import { FilterBar } from "@/components/FilterBar";
import { SortableTableHead, type SortDir } from "@/components/SortableTableHead";
import { Megaphone } from "lucide-react";
import type { Campaign } from "@/types/api";
import { differenceInCalendarDays, format } from "date-fns";
import { RetryBlock } from "@/components/feedback/RetryBlock";
import { TableState } from "@/components/states/TableState";
import { BillingSubscriptionStrip } from "@/components/BillingSubscriptionStrip";

const CAMPAIGN_STATUS_OPTIONS = [
  { value: "active", label: "Running" },
  { value: "paused", label: "Paused" },
  { value: "draft", label: "Draft" },
  { value: "completed", label: "Stopped" },
];

export default function CampaignsPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const confirmDialog = useConfirmDialog();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const queryClient = useQueryClient();

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);

  const archivedFilter = showArchived ? undefined : false;

  const {
    data: campaignsData,
    isLoading: campaignsLoading,
    isError: campaignsError,
    error: campaignsErrorMsg,
    isFetching: campaignsFetching,
    refetch: refetchCampaigns,
  } = usePaginatedCampaigns(userId, {
    archived: archivedFilter,
    skip: page * PAGE_SIZE,
    limit: PAGE_SIZE + 1, // fetch one extra to check if there's a next page
  });

  const campaignsPage = (campaignsData ?? []) as Campaign[];
  const hasNextPage = campaignsPage.length > PAGE_SIZE;
  const campaigns = campaignsPage.slice(0, PAGE_SIZE);
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 6); // inclusive range: 7 days ending today

  const [fromDate, setFromDate] = useState<Date>(defaultFrom);
  const [toDate, setToDate] = useState<Date>(today);

  const analyticsDays = useMemo(() => {
    const safeFrom = fromDate;
    const safeTo = toDate < fromDate ? fromDate : toDate;
    const diff = differenceInCalendarDays(safeTo, safeFrom) + 1;
    return Math.max(1, diff);
  }, [fromDate, toDate]);

  const { data: analytics, isLoading: analyticsLoading } = useAnalytics(
    userId,
    undefined,
    analyticsDays
  );
  const { data: inboxes = [], isLoading: inboxesLoading } = useInboxes(userId);
  const { data: domains = [], isLoading: domainsLoading } = useDomains();
  // Only block the table on campaigns; inbox/domain & stats hydrate progressively.
  const tableLoading = campaignsLoading;
  const startCampaign = useStartCampaign();
  const pauseCampaign = usePauseCampaign();
  const campaignGate = usePlanGate("campaigns");

  const deleteCampaign = useMutation({
    mutationFn: (campaignId: string) => api.campaigns.delete(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign deleted");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete campaign");
    },
  });

  const setArchivedCampaign = useMutation({
    mutationFn: ({ campaignId, archived }: { campaignId: string; archived: boolean }) =>
      api.campaigns.setArchived(campaignId, archived),
    onSuccess: (_, { archived }) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success(archived ? "Campaign archived" : "Campaign restored");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to update campaign");
    },
  });

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((campaign) => {
      if (!showArchived && campaign.archived) return false;
      const matchesSearch =
        !searchQuery ||
        campaign.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = !statusFilter || campaign.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [campaigns, searchQuery, statusFilter, showArchived]);

  const sortedCampaigns = useMemo(() => {
    const statusSortRank = (status: string | undefined) => {
      const s = (status || "").toLowerCase();
      if (s === "draft" || s === "pending") return 0;
      if (s === "active") return 1;
      if (s === "paused") return 2;
      return 3;
    };
    const byCreatedAtDesc = (a: Campaign, b: Campaign) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    };
    if (!sortKey) {
      return [...filteredCampaigns].sort((a, b) => {
        const ra = statusSortRank(a.status);
        const rb = statusSortRank(b.status);
        if (ra !== rb) return ra - rb;
        return byCreatedAtDesc(a, b);
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredCampaigns].sort((a, b) => {
      if (sortKey === "name") {
        return dir * (a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || 0);
      }
      if (sortKey === "status") {
        return dir * ((a.status || "").localeCompare(b.status || "", undefined, { sensitivity: "base" }) || 0);
      }
      return 0;
    });
  }, [filteredCampaigns, sortKey, sortDir]);

  const campaignIdsForCompliance = useMemo(
    () => sortedCampaigns.map((c) => c.id),
    [sortedCampaigns]
  );
  const { data: complianceStatus } = useCampaignComplianceStatus(campaignIdsForCompliance);

  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;
  const totalSent = analytics?.total_sent ?? 0;
  const avgOpenRate = analytics?.open_rate ?? 0;
  const avgClickRate = analytics?.click_rate ?? 0;
  const avgReplyRate = analytics?.reply_rate ?? 0;

  const stats = [
    { title: "Active Campaigns", value: activeCampaigns.toString(), icon: Play, usesAnalytics: false },
    { title: "Total Sent", value: totalSent.toLocaleString(), icon: Mail, usesAnalytics: true },
    { title: "Avg. Open Rate", value: `${avgOpenRate.toFixed(1)}%`, icon: Eye, usesAnalytics: true },
    { title: "Avg. Click Rate", value: `${avgClickRate.toFixed(1)}%`, icon: MousePointerClick, usesAnalytics: true },
    { title: "Avg. Reply Rate", value: `${avgReplyRate.toFixed(1)}%`, icon: MessageSquare, usesAnalytics: true },
  ];

  const handleCampaignToggle = (campaignId: string, currentStatus: string) => {
    if (currentStatus === "active") {
      pauseCampaign.mutate(campaignId);
    } else if (currentStatus === "paused" || currentStatus === "draft" || currentStatus === "pending") {
      startCampaign.mutate(campaignId);
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    const confirmed = await confirmDialog({
      title: "Delete campaign",
      description:
        "Deleting this campaign is permanent and cannot be undone. You will lose:\n• All tracking data (opens, clicks, replies)\n• All campaign links\n\nWe strongly recommend keeping campaigns instead of deleting them.",
      variant: "destructive",
    });
    if (confirmed) deleteCampaign.mutate(campaignId);
  };

  const duplicateCampaign = useMutation({
    mutationFn: (campaign: Campaign) => {
      const newCampaign: Campaign = {
        ...campaign,
        id: crypto.randomUUID(),
        name: `${campaign.name} (Copy)`,
        status: "draft",
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return api.campaigns.create(newCampaign);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign duplicated successfully");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to duplicate campaign");
    },
  });

  const hasActiveFilters = !!searchQuery || !!statusFilter || showArchived;

  return (
    <AppPageShell
      title="Campaigns"
      description="Manage and monitor your email campaigns"
      actions={
        <>
          {campaignGate.atLimit && <PremiumBadge featureKey="campaigns" />}
          <Button
            className="gradient-primary w-full sm:w-auto"
            asChild={!campaignGate.atLimit}
            onClick={() => campaignGate.atLimit && setUpgradeOpen(true)}
            disabled={campaignGate.atLimit && !campaignGate.canCreate}
            data-tour="campaigns-create"
          >
            {campaignGate.atLimit ? (
              <span className="flex items-center justify-center">
                <Plus className="w-4 h-4 mr-2" />
                Upgrade to add more
              </span>
            ) : (
              <Link href="/campaigns/new" className="flex items-center justify-center">
                <Plus className="w-4 h-4 mr-2" />
                New campaign
              </Link>
            )}
          </Button>
        </>
      }
    >
    <div className="space-y-6">

      <BillingSubscriptionStrip />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Showing stats for{" "}
          <span className="font-medium">
            {format(fromDate, "MMM d, yyyy")} – {format(toDate, "MMM d, yyyy")}
          </span>{" "}
          ({analyticsDays} days)
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">From</span>
            <input
              type="date"
              className="h-8 rounded-md border bg-background px-2 text-xs sm:text-sm"
              value={format(fromDate, "yyyy-MM-dd")}
              max={format(toDate, "yyyy-MM-dd")}
              onChange={(e) => {
                const value = e.target.value;
                if (!value) return;
                const next = new Date(value + "T00:00:00");
                setFromDate(next);
              }}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">To</span>
            <input
              type="date"
              className="h-8 rounded-md border bg-background px-2 text-xs sm:text-sm"
              value={format(toDate, "yyyy-MM-dd")}
              min={format(fromDate, "yyyy-MM-dd")}
              max={format(today, "yyyy-MM-dd")}
              onChange={(e) => {
                const value = e.target.value;
                if (!value) return;
                const next = new Date(value + "T00:00:00");
                setToDate(next);
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card>
              <CardContent className="p-3 flex items-center gap-3 sm:p-4 sm:gap-4">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg gradient-primary flex flex-shrink-0 items-center justify-center">
                  <stat.icon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-bold truncate sm:text-2xl flex items-center gap-2">
                    {stat.usesAnalytics && analyticsLoading ? (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      stat.value
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate sm:text-sm">{stat.title}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="truncate">All campaigns</CardTitle>
            <FilterBar
              searchPlaceholder="Search campaigns…"
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              statusFilter={statusFilter}
              statusOptions={CAMPAIGN_STATUS_OPTIONS}
              onStatusChange={setStatusFilter}
              showArchived={showArchived}
              onShowArchivedChange={setShowArchived}
              archivedLabel="Show archived"
              hideArchivedLabel="Hide archived"
              onClearFilters={() => {
                setSearchQuery("");
                setStatusFilter("");
                setShowArchived(false);
              }}
              filterTrigger={
                <Button variant="outline" size="icon" title="Filter by status" className="relative">
                  <Filter className="w-4 h-4" />
                  {statusFilter ? (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" />
                  ) : null}
                </Button>
              }
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchCampaigns()}
                disabled={campaignsFetching}
                title="Refresh"
              >
                <RefreshCw className={`h-4 w-4 mr-1.5 ${campaignsFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </FilterBar>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  sortKey="name"
                  currentSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={(key, dir) => {
                    setSortKey(key);
                    setSortDir(dir);
                  }}
                >
                  Campaign
                </SortableTableHead>
                <SortableTableHead
                  sortKey="status"
                  currentSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={(key, dir) => {
                    setSortKey(key);
                    setSortDir(dir);
                  }}
                >
                  Status
                </SortableTableHead>
                <TableHead>Inbox</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Open Rate</TableHead>
                <TableHead className="text-right">Click Rate</TableHead>
                <TableHead className="text-right">Reply Rate</TableHead>
                <TableHead className="text-center">Health</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableLoading ? (
                <>
                  {[1, 2, 3].map((i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-12 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-12 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-12 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-12 ml-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16 mx-auto" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-8 w-8 ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              ) : campaignsError ? (
                <TableState colSpan={9}>
                  <div className="py-8 text-center">
                    <RetryBlock
                      title="Failed to load campaigns"
                      description={
                        campaignsErrorMsg instanceof Error
                          ? campaignsErrorMsg.message
                          : "Please try again."
                      }
                      onRetry={() => void refetchCampaigns()}
                    />
                  </div>
                </TableState>
              ) : filteredCampaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-0">
                    <EmptyState
                      icon={Megaphone}
                      headline={hasActiveFilters ? "No campaigns match your filters" : "No campaigns yet"}
                      description={
                        hasActiveFilters
                          ? "Try clearing filters or creating a new campaign."
                          : "Create your first campaign to start reaching prospects."
                      }
                      primaryAction={
                        hasActiveFilters ? (
                          <Button
                            variant="outline"
                            onClick={() => {
                              setSearchQuery("");
                              setStatusFilter("");
                              setShowArchived(false);
                            }}
                          >
                            Clear filters
                          </Button>
                        ) : !campaignGate.atLimit ? (
                          <Button asChild className="gradient-primary">
                            <Link href="/campaigns/new" className="inline-flex items-center gap-2">
                              <Plus className="w-4 h-4" />
                              Create campaign
                            </Link>
                          </Button>
                        ) : null
                      }
                      className="rounded-none border-0 border-t border-dashed"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                sortedCampaigns.map((campaign) => {
                  const inbox =
                    inboxesLoading || domainsLoading
                      ? undefined
                      : inboxes.find((i) => campaign.sender_ids?.includes(i.id));
                  let defaultHealth = 95;
                  if (inbox?.domain_id) {
                    const domain = domains.find((d) => d.id === inbox.domain_id);
                    if (domain) defaultHealth = domain.health_score;
                  }
                  return (
                    <CampaignRow
                      key={campaign.id}
                      campaign={campaign}
                      inboxEmail={
                        campaign.sender_type === "gmail"
                          ? campaign.sender_name ?? "Gmail"
                          : inbox?.email
                      }
                      defaultHealth={defaultHealth}
                      inboxLoading={inboxesLoading || domainsLoading}
                      onToggle={handleCampaignToggle}
                      onDelete={handleDeleteCampaign}
                      onDuplicate={(c) => duplicateCampaign.mutate(c)}
                      onArchive={(campaignId, archived) =>
                        setArchivedCampaign.mutate({ campaignId, archived })
                      }
                      archivePending={setArchivedCampaign.isPending}
                      pausePending={pauseCampaign.isPending && pauseCampaign.variables === campaign.id}
                      startPending={startCampaign.isPending && startCampaign.variables === campaign.id}
                      complianceStatus={complianceStatus?.[campaign.id]}
                    />
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Page {page + 1}
          {campaignsFetching && " · Updating…"}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
            disabled={page === 0 || tableLoading || campaignsFetching}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNextPage || tableLoading || campaignsFetching}
          >
            Next
          </Button>
        </div>
      </div>
      <UpgradeModal
        featureKey="campaigns"
        gate={campaignGate}
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
      />

      <HelpLinks
        slugs={[
          "create-first-campaign-pigeon",
          "choose-gmail-vs-smtp-select-sending-inboxes",
          "set-daily-limits-send-time-windows",
          "edit-or-pause-campaign",
          "run-template-ab-tests-campaign",
          "view-manage-campaign-replies-inbox",
        ]}
        className="mt-6"
      />
    </div>
    </AppPageShell>
  );
}
