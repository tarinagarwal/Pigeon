"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Plus,
  Search,
  Upload,
  Download,
  MoreHorizontal,
  Mail,
  Building,
  MapPin,
  CheckCircle,
  XCircle,
  AlertCircle,
  Trash2,
  Pencil,
  Tag,
  List,
  Users as UsersIcon,
  Loader2,
  MailMinus,
  History,
  MousePointerClick,
  MessageSquare,
  ExternalLink,
  HelpCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import {
  useContacts,
  useContactLists,
  useDeleteContact,
  useDeleteContacts,
  useContactHistory,
  useRemoveRiskyContacts,
  useRemoveRiskyEmailsStatus,
  useRemoveRiskyEmailsLatestJob,
  useStopRiskyEmailsJob,
} from "@/hooks/useContacts";
import { useZeroBounceSettings } from "@/hooks/useSettings";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { AddContactDialog } from "@/components/AddContactDialog";
import { AddToListDialog } from "@/components/AddToListDialog";
import { HelpLinks } from "@/components/HelpLinks";
import { PremiumBadge } from "@/components/PremiumBadge";
import { EmptyState } from "@/components/EmptyState";
import type { Contact, ContactHistoryEvent } from "@/types/api";

function isContactInList(
  contactId: string,
  listId: string,
  allContactLists: { id: string; contact_ids?: string[] }[]
) {
  if (!listId) return true;
  const list = allContactLists.find((l) => l.id === listId);
  if (!list) return false;
  const ids = Array.isArray(list.contact_ids) ? list.contact_ids : [];
  return ids.includes(contactId);
}

function getStatusBadge(contact: Contact) {
  const status = contact.status || "";
  const manualUnblockBadge = contact.manual_unblock ? (
    <Badge
      variant="outline"
      className="bg-success/10 text-success border-success/20 text-xs"
    >
      Manually unblocked
    </Badge>
  ) : null;
  if (contact.blocked) {
    const isUnsubscribed = status === "unsubscribed";
    return (
      <div className="flex flex-wrap items-center gap-1">
        <Badge
          variant="outline"
          className="bg-destructive/10 text-destructive border-destructive/20"
        >
          <XCircle className="w-3 h-3 mr-1" />
          {isUnsubscribed ? "Unsubscribed" : "Blocked"}
        </Badge>
        {status && status !== "sent" && !isUnsubscribed && (
          <Badge variant="secondary" className="text-xs">
            {status}
          </Badge>
        )}
      </div>
    );
  }
  let main: React.ReactNode;
  switch (status) {
    case "sent":
    case "opened":
    case "clicked":
    case "replied":
      main = (
        <Badge
          variant="outline"
          className="bg-success/10 text-success border-success/20"
        >
          <CheckCircle className="w-3 h-3 mr-1" />
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
      );
      break;
    case "pending":
      main = (
        <Badge
          variant="outline"
          className="bg-warning/10 text-warning border-warning/20"
        >
          <AlertCircle className="w-3 h-3 mr-1" />
          Pending
        </Badge>
      );
      break;
    default:
      main = <Badge variant="secondary">{status || "—"}</Badge>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {main}
      {manualUnblockBadge}
    </div>
  );
}

export default function ContactsPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const confirmDialog = useConfirmDialog();
  const queryClient = useQueryClient();
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [listFilterId, setListFilterId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"contacts" | "lists">("contacts");
  const [editingList, setEditingList] = useState<{
    id: string;
    name: string;
    description?: string;
  } | null>(null);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListDescription, setNewListDescription] = useState("");
  const [addContactDialogOpen, setAddContactDialogOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [addToListDialogOpen, setAddToListDialogOpen] = useState(false);
  const [contactsToAddToList, setContactsToAddToList] = useState<string[]>([]);
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [contactsLimit, setContactsLimit] = useState(10000);
  const [historyContactId, setHistoryContactId] = useState<string | null>(null);
  const [activitySectionOpen, setActivitySectionOpen] = useState(false);
  const [linkClickedSectionOpen, setLinkClickedSectionOpen] = useState(true);
  const [riskyJobId, setRiskyJobId] = useState<string | null>(null);
  const [riskyEmailsDialogOpen, setRiskyEmailsDialogOpen] = useState(false);
  const [riskyEmailsListId, setRiskyEmailsListId] = useState<string>("__all__");
  const [riskyEmailsIncludeCatchAll, setRiskyEmailsIncludeCatchAll] = useState(false);

  const { data: contactsData, isLoading: contactsLoading } = useContacts(
    userId,
    0,
    contactsLimit
  );
  const allContacts = contactsData?.contacts || [];
  const totalContacts = contactsData?.total || 0;
  const { data: allContactLists = [] } = useContactLists(userId);
  const { data: contactHistory, isLoading: historyLoading } = useContactHistory(historyContactId);

  useEffect(() => {
    if (!contactHistory?.events) return;
    const hasLinkClicks = contactHistory.events.some((e: ContactHistoryEvent) => e.type === "link_clicked");
    if (!hasLinkClicks) setActivitySectionOpen(true);
  }, [contactHistory?.events]);

  const deleteContact = useDeleteContact();
  const deleteContacts = useDeleteContacts();
  const removeRiskyContacts = useRemoveRiskyContacts();
  const stopRiskyEmailsJob = useStopRiskyEmailsJob();
  const { data: zerobounceSettings } = useZeroBounceSettings();
  const { data: riskyJobStatus } = useRemoveRiskyEmailsStatus(riskyJobId);
  const { data: latestRiskyJob } = useRemoveRiskyEmailsLatestJob(userId);

  // Restore running job on load/refresh so progress shows and button stays disabled
  useEffect(() => {
    if (!userId || !latestRiskyJob || typeof latestRiskyJob !== "object") return;
    if ("status" in latestRiskyJob && latestRiskyJob.status === "running" && "job_id" in latestRiskyJob && latestRiskyJob.job_id) {
      setRiskyJobId(latestRiskyJob.job_id);
    }
  }, [userId, latestRiskyJob]);

  useEffect(() => {
    if (!riskyJobId || !riskyJobStatus || "status" in riskyJobStatus === false) return;
    const status = "status" in riskyJobStatus ? riskyJobStatus.status : (riskyJobStatus as { status?: string }).status;
    if (status === "cancelled") {
      toast.info("Job cancelled.");
      setRiskyJobId(null);
      return;
    }
    if (status === "completed" || status === "failed") {
      queryClient.invalidateQueries({ queryKey: ["contacts", userId] });
      queryClient.invalidateQueries({ queryKey: ["contact-lists", userId] });
      if (status === "failed") {
        const err = (riskyJobStatus as { error?: string }).error;
        toast.error(err || "Remove risky emails failed");
      } else {
        const d = riskyJobStatus as { deleted?: number; total_to_check?: number };
        if ((d.deleted ?? 0) > 0) {
          toast.success(`Deleted ${d.deleted} risky contact(s) out of ${d.total_to_check ?? 0} checked`);
        } else {
          toast.success("No risky emails found. All contacts passed validation.");
        }
      }
      setRiskyJobId(null);
    }
  }, [riskyJobId, riskyJobStatus, queryClient, userId]);

  const filteredContacts = allContacts.filter((c) => {
    if (listFilterId && !isContactInList(c.id, listFilterId, allContactLists))
      return false;
    const matchesStatus =
      !statusFilter ||
      (statusFilter === "blocked"
        ? c.blocked === true
        : (c.status || "") === statusFilter);
    if (!matchesStatus) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim().toLowerCase();
    return (
      c.email.toLowerCase().includes(q) ||
      name.includes(q) ||
      (c.company || "").toLowerCase().includes(q) ||
      (c.industry || "").toLowerCase().includes(q) ||
      (c.status || "").toLowerCase().includes(q)
    );
  });

  const handleToggleShowAll = () => {
    setLoadingAll(true);
    setShowAllContacts((prev) => {
      const next = !prev;
      if (next && totalContacts && totalContacts > allContacts.length) {
        setContactsLimit(totalContacts);
      }
      return next;
    });
    // Small timeout so the spinner is visible during the UI update
    setTimeout(() => setLoadingAll(false), 300);
  };

  const visibleContacts = showAllContacts
    ? filteredContacts
    : filteredContacts.slice(0, 20);

  const filteredLists = allContactLists.filter((list) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      list.name.toLowerCase().includes(q) ||
      (list.description || "").toLowerCase().includes(q)
    );
  });

  const createList = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      api.contactLists.create(userId, data.name, [], data.description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-lists", userId] });
      toast.success("List created successfully");
      setListDialogOpen(false);
      setNewListName("");
      setNewListDescription("");
      setEditingList(null);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to create list");
    },
  });

  const updateList = useMutation({
    mutationFn: (data: {
      id: string;
      name: string;
      description?: string;
    }) =>
      api.contactLists.update(data.id, {
        name: data.name,
        description: data.description,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-lists", userId] });
      toast.success("List updated successfully");
      setListDialogOpen(false);
      setEditingList(null);
      setNewListName("");
      setNewListDescription("");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to update list");
    },
  });

  const deleteList = useMutation({
    mutationFn: (listId: string) => api.contactLists.delete(listId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-lists", userId] });
      toast.success("List deleted successfully");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete list");
    },
  });

  const verifiedCount = allContacts.filter((c) =>
    ["opened", "clicked", "replied"].includes(c.status || "")
  ).length;
  const blockedCount = allContacts.filter((c) => c.blocked === true).length;
  const unsubscribedCount = allContacts.filter(
    (c) => (c.status || "").toLowerCase() === "unsubscribed"
  ).length;
  const pendingCount = allContacts.filter((c) =>
    ["pending", "sent", "failed", ""].includes(c.status || "") && !c.blocked
  ).length;

  const stats = [
    { title: "Total Contacts", value: totalContacts.toLocaleString(), icon: UsersIcon },
    { title: "Verified", value: verifiedCount.toLocaleString(), icon: CheckCircle, status: "success" as const },
    { title: "Pending", value: pendingCount.toLocaleString(), icon: AlertCircle, status: "warning" as const },
    { title: "Blocked", value: blockedCount.toLocaleString(), icon: XCircle, status: "error" as const },
    { title: "Unsubscribed", value: unsubscribedCount.toLocaleString(), icon: MailMinus, status: "error" as const },
  ];

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    const visibleIds = visibleContacts.map((c) => c.id);
    const allVisibleSelected = visibleIds.every((id) =>
      selectedContacts.includes(id)
    );

    if (allVisibleSelected) {
      setSelectedContacts((prev) =>
        prev.filter((id) => !visibleIds.includes(id))
      );
    } else {
      setSelectedContacts((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleAddContact = () => {
    setEditContact(null);
    setAddContactDialogOpen(true);
  };

  const handleFilterStatus = (status: string) => {
    setStatusFilter(status);
  };

  const handleExport = () => {
    if (filteredContacts.length === 0) {
      toast.error("No contacts to export");
      return;
    }
    const headers = [
      "Email",
      "First Name",
      "Last Name",
      "Company",
      "Industry",
      "Status",
      "Lists",
    ];
    const csvContent = [
      headers.join(","),
      ...filteredContacts.map((contact) =>
        (() => {
          const contactLists = allContactLists.filter(
            (cl) =>
              Array.isArray(cl.contact_ids) && cl.contact_ids.includes(contact.id)
          );
          const listNames = contactLists.map((cl) => cl.name).join("; ");

          return [
            contact.email,
            contact.first_name || "",
            contact.last_name || "",
            contact.company || "",
            contact.industry || "",
            contact.status || "",
            listNames,
          ]
            .map((field) =>
              `"${String(field).replace(/"/g, '""')}"`
            )
            .join(",");
        })()
      ),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success("Contacts exported successfully");
  };

  const handleAddToList = (contactIds?: string[]) => {
    const idsToAdd = contactIds || selectedContacts;
    if (idsToAdd.length === 0) {
      toast.error("Please select contacts to add to list");
      return;
    }
    setContactsToAddToList(idsToAdd);
    setAddToListDialogOpen(true);
  };

  const handleDeleteSelected = async () => {
    if (selectedContacts.length === 0) {
      toast.error("Please select contacts to delete");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Delete contacts",
      description: `Are you sure you want to delete ${selectedContacts.length} contact(s)?`,
      variant: "destructive",
    });
    if (confirmed) {
      deleteContacts.mutate(
        { userId, contactIds: selectedContacts },
        { onSuccess: () => setSelectedContacts([]) }
      );
    }
  };

  const handleEditContact = (contact: Contact) => {
    setEditContact(contact);
    setAddContactDialogOpen(true);
  };

  const handleDeleteContact = async (contactId: string) => {
    const confirmed = await confirmDialog({
      title: "Delete contact",
      description: "Are you sure you want to delete this contact?",
      variant: "destructive",
    });
    if (confirmed) deleteContact.mutate({ contactId, userId });
  };

  const handleCreateList = () => {
    setEditingList(null);
    setNewListName("");
    setNewListDescription("");
    setListDialogOpen(true);
  };

  const handleEditList = (list: {
    id: string;
    name: string;
    description?: string;
  }) => {
    setEditingList(list);
    setNewListName(list.name);
    setNewListDescription(list.description || "");
    setListDialogOpen(true);
  };

  const handleSaveList = () => {
    if (!newListName.trim()) {
      toast.error("List name is required");
      return;
    }
    if (editingList) {
      updateList.mutate({
        id: editingList.id,
        name: newListName.trim(),
        description: newListDescription.trim() || undefined,
      });
    } else {
      createList.mutate({
        name: newListName.trim(),
        description: newListDescription.trim() || undefined,
      });
    }
  };

  const handleDeleteList = async (
    listId: string,
    listName: string
  ) => {
    const confirmed = await confirmDialog({
      title: "Delete list",
      description: `Are you sure you want to delete the list "${listName}"? This will not delete the contacts.`,
      variant: "destructive",
    });
    if (confirmed) deleteList.mutate(listId);
  };

  const handleDeleteOrphanedContacts = async () => {
    const allContactIdsInLists = new Set<string>();
    allContactLists.forEach((list) => {
      (list.contact_ids || []).forEach((id) => allContactIdsInLists.add(id));
    });
    const orphanedContacts = allContacts.filter(
      (contact) => !allContactIdsInLists.has(contact.id)
    );
    if (orphanedContacts.length === 0) {
      toast.info("No contacts found without lists");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Delete contacts without lists",
      description: `Found ${orphanedContacts.length} contact(s) that don't belong to any list. Are you sure you want to delete them? This action cannot be undone.`,
      variant: "destructive",
    });
    if (confirmed) {
      const orphanedIds = orphanedContacts.map((c) => c.id);
      deleteContacts.mutate(
        { userId, contactIds: orphanedIds },
        {
          onSuccess: () =>
            toast.success(`Deleted ${orphanedIds.length} contact(s) without lists`),
        }
      );
    }
  };

  const handleRemoveRiskyEmails = async () => {
    if (!userId) {
      toast.error("You must be logged in to remove risky emails");
      return;
    }
    setRiskyEmailsListId("__all__");
    setRiskyEmailsIncludeCatchAll(false);
    setRiskyEmailsDialogOpen(true);
  };

  const handleStartRemoveRiskyEmails = async () => {
    if (!userId) {
      toast.error("You must be logged in to remove risky emails");
      return;
    }
    const selectedListId =
      riskyEmailsListId === "__all__" ? undefined : riskyEmailsListId;
    const selectedListName = selectedListId
      ? allContactLists.find((l) => l.id === selectedListId)?.name || "selected list"
      : null;
    const catchAllLine = riskyEmailsIncludeCatchAll
      ? " Catch‑all check on (via ZeroBounce): addresses on catch‑all domains will also be removed."
      : " Catch‑all off: format, domain, and spam list only.";
    const confirmed = await confirmDialog({
      title: "Remove risky emails",
      description:
        selectedListId
          ? `This will validate emails in "${selectedListName}".${catchAllLine} Deletes risky contacts and removes them from campaigns. Runs in the background.`
          : `This will validate all contact emails.${catchAllLine} Deletes risky contacts and removes them from campaigns. Runs in the background.`,
      variant: "destructive",
    });
    if (!confirmed) return;
    setRiskyEmailsDialogOpen(false);
    removeRiskyContacts.mutate(
      { userId, listId: selectedListId, includeCatchAll: riskyEmailsIncludeCatchAll },
      {
        onSuccess: (data) => {
          if (data.job_id) setRiskyJobId(data.job_id);
          else if (data.status === "completed")
            toast.success(data.message || "No contacts to check.");
        },
      }
    );
  };

  const escapeCsv = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const handleExportHistory = () => {
    if (!contactHistory) return;
    const c = contactHistory.contact;
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "—";
    const rows: string[] = [];

    rows.push("Contact Details");
    rows.push(["Field", "Value"].map(escapeCsv).join(","));
    rows.push([escapeCsv("Name"), escapeCsv(name)].join(","));
    rows.push([escapeCsv("Email"), escapeCsv(c.email)].join(","));
    rows.push([escapeCsv("Company"), escapeCsv(c.company || "—")].join(","));
    rows.push([escapeCsv("Industry"), escapeCsv(c.industry || "—")].join(","));
    rows.push([escapeCsv("Status"), escapeCsv(c.status || "—")].join(","));
    rows.push([escapeCsv("Blocked"), escapeCsv(c.blocked ? "Yes" : "No")].join(","));
    if (c.custom_fields && typeof c.custom_fields === "object") {
      for (const [k, v] of Object.entries(c.custom_fields)) {
        const label = k.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
        rows.push([escapeCsv(label), escapeCsv(v != null && typeof v === "object" ? String(v) : v)].join(","));
      }
    }
    rows.push("");

    rows.push("Engagement Summary");
    rows.push(["Emails sent", "Opened", "Clicked", "Replied", "Link clicks"].map(escapeCsv).join(","));
    rows.push(
      [
        contactHistory.stats.total_sent,
        contactHistory.stats.total_opened,
        contactHistory.stats.total_clicked,
        contactHistory.stats.total_replied,
        contactHistory.stats.total_link_clicks,
      ].map(escapeCsv).join(",")
    );
    rows.push("");

    rows.push("Activity");
    rows.push(["Event Type", "Timestamp", "Campaign", "Subject", "URL", "Click Count"].map(escapeCsv).join(","));
    for (const e of contactHistory.events) {
      const typeLabel = e.type === "link_clicked" ? "Link clicked" : e.type.charAt(0).toUpperCase() + e.type.slice(1);
      const ts = e.timestamp ? new Date(e.timestamp).toLocaleString() : "";
      rows.push(
        [
          escapeCsv(typeLabel),
          escapeCsv(ts),
          escapeCsv(e.campaign_name ?? ""),
          escapeCsv(e.subject ?? ""),
          escapeCsv(e.url ?? ""),
          escapeCsv(e.click_count ?? ""),
        ].join(",")
      );
    }

    const csv = rows.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeEmail = (c.email || "contact").replace(/[^a-z0-9@.-]/gi, "_");
    a.download = `contact-history-${safeEmail}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success("History exported");
  };

  const getHistoryEventIcon = (type: string) => {
    switch (type) {
      case "sent":
        return <Mail className="w-4 h-4 text-primary" />;
      case "opened":
        return <MousePointerClick className="w-4 h-4 text-green-500" />;
      case "clicked":
      case "link_clicked":
        return <ExternalLink className="w-4 h-4 text-primary" />;
      case "replied":
        return <MessageSquare className="w-4 h-4 text-primary" />;
      case "unsubscribed":
        return <MailMinus className="w-4 h-4 text-destructive" />;
      default:
        return <History className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-muted-foreground">
            Manage your contact lists and email recipients
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild data-tour="contacts-import">
            <Link href="/contacts/import">
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" data-tour="contacts-manual-block-unblock">
            <Link href="/contacts/manual-block-unblock">
              Block / Unblock
            </Link>
          </Button>
          <Button className="gradient-primary" onClick={handleAddContact} data-tour="contacts-add-contact">
            <Plus className="w-4 h-4 mr-2" />
            Add Contact
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  {"status" in stat && stat.status === "success" && (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  )}
                  {"status" in stat && stat.status === "error" && (
                    <XCircle className="w-4 h-4 text-destructive" />
                  )}
                  {"status" in stat && stat.status === "warning" && (
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                  )}
                </div>
                <p className="text-2xl font-bold mt-3 tabular-nums">{stat.value}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card
        className="border border-border bg-card shadow-sm overflow-hidden"
        data-tour="contacts-status-card"
      >
        <CardContent className="p-0">
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <AlertCircle className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-foreground mb-1">
                  Contact Status & Campaign Eligibility
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  We track engagement globally to ensure high deliverability.
                </p>
                <div className="space-y-4 text-sm">
                  <div className="flex items-start gap-3">
                    <Badge
                      variant="outline"
                      className="shrink-0 bg-success/10 text-success border-success/20 text-xs"
                    >
                      Verified
                    </Badge>
                    <p className="text-foreground">
                      <strong>Engaged:</strong> Contacts who have opened, clicked, or
                      replied. They are always eligible for campaigns.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge
                      variant="outline"
                      className="shrink-0 bg-warning/10 text-warning border-warning/20 text-xs"
                    >
                      Pending
                    </Badge>
                    <p className="text-foreground">
                      <strong>Not yet engaged:</strong> Contacts who haven&apos;t
                      interacted yet but have received fewer than 3 emails globally.
                      They will receive your campaigns.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge
                      variant="outline"
                      className="shrink-0 bg-destructive/10 text-destructive border-destructive/20 text-xs"
                    >
                      Blocked
                    </Badge>
                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="text-foreground">
                        <strong>Threshold reached:</strong> Contacts who
                        haven&apos;t engaged after receiving 3+ emails globally.
                        They are automatically excluded from campaigns to protect
                        your sender reputation.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-border bg-muted/50 px-5 py-3">
            <p className="text-sm font-medium text-foreground">
              If you manually unblock a blocked contact (from Manual Block/Unblock),
              they will bypass this status in the next campaign.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "contacts" | "lists")}
      >
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="contacts" className="flex items-center gap-2">
            <UsersIcon className="w-4 h-4" />
            Contacts ({totalContacts})
          </TabsTrigger>
          <TabsTrigger value="lists" className="flex items-center gap-2">
            <List className="w-4 h-4" />
            Lists ({allContactLists.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="mt-4">
          {riskyJobId &&
            riskyJobStatus &&
            typeof riskyJobStatus === "object" &&
            "status" in riskyJobStatus &&
            riskyJobStatus.status === "running" && (
              <Card className="mb-4 border-primary/30 bg-primary/5">
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        Checking emails…{" "}
                        <span className="tabular-nums">
                          {riskyJobStatus.checked_so_far.toLocaleString()} /{" "}
                          {riskyJobStatus.total_to_check.toLocaleString()}
                        </span>{" "}
                        checked
                        {riskyJobStatus.risky_count > 0 && (
                          <span className="text-destructive font-medium">
                            {" "}
                            · {riskyJobStatus.risky_count} risky found (will delete in bulk when done)
                          </span>
                        )}
                      </p>
                      <div className="flex items-start gap-2 mt-1 mb-1.5">
                        <span className="inline-block">
                          <svg className="w-4 h-4 text-primary/70 mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24"><path d="M12 19V6m0 0L5 12m7-6 7 6" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                        </span>
                        <span className="text-xs text-muted-foreground leading-relaxed max-w-xs">
                          You do <span className="font-semibold text-foreground">not</span> need to keep this page open.<br />
                          The check will continue in the background and you'll receive an email notification when it's complete.
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full max-w-xs rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{
                            width: `${
                              riskyJobStatus.total_to_check
                                ? Math.min(
                                    100,
                                    (100 * riskyJobStatus.checked_so_far) / riskyJobStatus.total_to_check
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10"
                      onClick={() => stopRiskyEmailsJob.mutate(riskyJobId)}
                      disabled={stopRiskyEmailsJob.isPending}
                    >
                      {stopRiskyEmailsJob.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Stop"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          <Card>
            <CardHeader className="pb-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-xl">
                  All Contacts
                  {(searchQuery || statusFilter || listFilterId || filteredContacts.length > 20 || totalContacts > allContacts.length) && (
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                      ({visibleContacts.length} of {searchQuery || statusFilter || listFilterId ? filteredContacts.length : totalContacts} shown)
                    </span>
                  )}
                </CardTitle>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <div className="relative flex-1 min-w-[200px] sm:min-w-[240px] max-w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground shrink-0" />
                    <Input
                      placeholder="Search contacts..."
                      className="pl-9 w-full"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <Separator orientation="vertical" className="h-8 hidden sm:block" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground shrink-0 hidden sm:inline">Status:</span>
                    <Button
                      variant={!statusFilter ? "default" : "outline"}
                      onClick={() => handleFilterStatus("")}
                      size="sm"
                    >
                      All
                    </Button>
                    <Button
                      variant={statusFilter === "blocked" ? "default" : "outline"}
                      onClick={() => handleFilterStatus("blocked")}
                      size="sm"
                    >
                      Blocked
                    </Button>
                    <Button
                      variant={statusFilter === "pending" ? "default" : "outline"}
                      onClick={() => handleFilterStatus("pending")}
                      size="sm"
                    >
                      Pending
                    </Button>
                    <Button
                      variant={statusFilter === "sent" ? "default" : "outline"}
                      onClick={() => handleFilterStatus("sent")}
                      size="sm"
                    >
                      Sent
                    </Button>
                    <Button
                      variant={statusFilter === "opened" ? "default" : "outline"}
                      onClick={() => handleFilterStatus("opened")}
                      size="sm"
                    >
                      Opened
                    </Button>
                    <Button
                      variant={statusFilter === "clicked" ? "default" : "outline"}
                      onClick={() => handleFilterStatus("clicked")}
                      size="sm"
                    >
                      Clicked
                    </Button>
                    <Button
                      variant={statusFilter === "replied" ? "default" : "outline"}
                      onClick={() => handleFilterStatus("replied")}
                      size="sm"
                    >
                      Replied
                    </Button>
                  </div>
                  <Separator orientation="vertical" className="h-8 hidden sm:block" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground shrink-0 hidden sm:inline">List:</span>
                    <Select
                      value={listFilterId || "__all__"}
                      onValueChange={(v) =>
                        setListFilterId(v === "__all__" ? "" : v)
                      }
                    >
                      <SelectTrigger className="w-full sm:w-[180px] min-w-[140px]">
                        <SelectValue placeholder="All lists" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All lists</SelectItem>
                        {allContactLists.map((list) => (
                          <SelectItem key={list.id} value={list.id}>
                            {list.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Separator className="sm:hidden" />
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <Button variant="outline" size="sm" onClick={handleExport} className="shrink-0">
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>
                  <Button variant="outline" size="sm" asChild className="shrink-0">
                    <Link href="/contacts/risky-email-history">
                      <History className="w-4 h-4 mr-2" />
                      Risky History
                    </Link>
                  </Button>
                  <Separator orientation="vertical" className="h-6 hidden sm:block" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                    onClick={handleDeleteOrphanedContacts}
                    title="Delete contacts that don't belong to any list"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Orphaned
                  </Button>
                  {filteredContacts.length > 20 && (
                    <>
                      <Separator orientation="vertical" className="h-6 hidden sm:block" />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleToggleShowAll}
                        className="shrink-0 inline-flex items-center gap-2"
                        disabled={loadingAll}
                      >
                        {loadingAll ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading
                          </>
                        ) : showAllContacts ? (
                          "Show first 20"
                        ) : (
                          "Load all"
                        )}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 inline-flex items-center gap-2 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleRemoveRiskyEmails}
                    disabled={removeRiskyContacts.isPending || !userId || !!riskyJobId}
                    title="Validate all contacts and delete those with risky emails"
                  >
                    {removeRiskyContacts.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Removing risky emails
                      </>
                    ) : (
                      <>
                        <MailMinus className="w-4 h-4 mr-1" />
                        Remove risky emails
                        <PremiumBadge label="Pro" className="ml-1.5" variant="foil" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {selectedContacts.length > 0 && (
                <div className="flex items-center gap-4 mb-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <span className="text-sm font-medium">
                    {selectedContacts.length} selected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddToList()}
                  >
                    <Tag className="w-4 h-4 mr-2" />
                    Add to List
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={handleDeleteSelected}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={
                          visibleContacts.length > 0 &&
                          visibleContacts.every((c) =>
                            selectedContacts.includes(c.id)
                          )
                        }
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Global sent</TableHead>
                    <TableHead>Lists</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contactsLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Loading contacts...
                      </TableCell>
                    </TableRow>
                  ) : filteredContacts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="p-0">
                        <EmptyState
                          icon={UsersIcon}
                          headline={searchQuery ? "No contacts found" : "No contacts yet"}
                          description={
                            searchQuery
                              ? `No contacts match "${searchQuery}". Try a broader term or clear search.`
                              : "Import contacts to start building your first outreach audience."
                          }
                          primaryAction={
                            searchQuery ? (
                              <Button variant="outline" size="sm" onClick={() => setSearchQuery("")}>
                                Clear search
                              </Button>
                            ) : (
                              <Button asChild size="sm" className="gradient-primary">
                                <Link href="/contacts/import">Import contacts</Link>
                              </Button>
                            )
                          }
                          secondaryLink={
                            !searchQuery ? (
                              <Button variant="ghost" size="sm" onClick={() => setAddContactDialogOpen(true)}>
                                Add contact manually
                              </Button>
                            ) : undefined
                          }
                          className="rounded-none border-0 border-t border-dashed"
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleContacts.map((contact) => {
                      const contactName =
                        `${contact.first_name || ""} ${contact.last_name || ""}`.trim() ||
                        contact.email;
                      const contactLists = allContactLists.filter(
                        (cl) =>
                          Array.isArray(cl.contact_ids) &&
                          cl.contact_ids.includes(contact.id)
                      );
                      return (
                        <TableRow
                          key={contact.id}
                          className="group hover:bg-secondary/50"
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedContacts.includes(contact.id)}
                              onCheckedChange={() => toggleContact(contact.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-white font-semibold">
                                {contactName.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-medium">{contactName}</p>
                                <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                                  {contact.email}
                                </p>
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-xs text-primary mt-0.5"
                                  onClick={() => setHistoryContactId(contact.id)}
                                >
                                  <History className="w-3.5 h-3.5 mr-1" />
                                  View History
                                </Button>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Building className="w-4 h-4 text-muted-foreground" />
                              <div>
                                <p>{contact.company || "-"}</p>
                                {contact.industry && (
                                  <p className="text-sm text-muted-foreground">
                                    {contact.industry}
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <MapPin className="w-4 h-4" />
                              {(contact.custom_fields as Record<string, string> | undefined)?.location || "-"}
                            </div>
                          </TableCell>
                          <TableCell>{getStatusBadge(contact)}</TableCell>
                          <TableCell className="text-center">
                            <span className="text-sm tabular-nums">
                              {(contact.sent_count ?? 0).toLocaleString()}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {contactLists.map((list) => (
                                <Badge
                                  key={list.id}
                                  variant="secondary"
                                  className="text-xs"
                                >
                                  {list.name}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => handleEditContact(contact)}
                                >
                                  <Pencil className="w-4 h-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleAddToList([contact.id])}
                                >
                                  <Tag className="w-4 h-4 mr-2" />
                                  Add to List
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="cursor-pointer text-destructive focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                                  onClick={() => handleDeleteContact(contact.id)}
                                  disabled={deleteContact.isPending}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              {filteredContacts.length > 20 && !showAllContacts && (
                <div className="flex justify-center pt-4 pb-2 border-t border-border mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToggleShowAll}
                    className="inline-flex items-center gap-2"
                    disabled={loadingAll}
                  >
                    {loadingAll ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading
                      </>
                    ) : (
                      <>
                        Load all ({totalContacts.toLocaleString()} contacts)
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lists" className="mt-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <CardTitle>
                  Contact Lists
                  {searchQuery && (
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                      ({filteredLists.length} of {allContactLists.length} shown)
                    </span>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search lists..."
                      className="pl-9 w-64"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <Button className="gradient-primary" onClick={handleCreateList}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create List
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredLists.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <List className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="font-medium">No lists found</p>
                    <p className="text-sm mt-1">
                      {searchQuery
                        ? `No lists matching "${searchQuery}"`
                        : "Create a list to organize your contacts"}
                    </p>
                  </div>
                ) : (
                  filteredLists.map((list) => (
                    <div
                      key={list.id}
                      className="group flex items-center justify-between p-4 border rounded-lg hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <List className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                          <h3 className="font-medium">{list.name}</h3>
                          <Badge variant="secondary" className="text-xs">
                            {list.contact_count ??
                              list.contact_ids?.length ??
                              0}{" "}
                            contacts
                          </Badge>
                        </div>
                        {list.description && (
                          <p className="text-sm text-muted-foreground group-hover:text-foreground mt-1 ml-6 transition-colors">
                            {list.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground group-hover:text-foreground mt-1 ml-6 transition-colors">
                          Created{" "}
                          {list.created_at
                            ? new Date(list.created_at).toLocaleDateString()
                            : "—"}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              handleEditList({
                                id: list.id,
                                name: list.name,
                                description: list.description,
                              })
                            }
                          >
                            <Pencil className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="cursor-pointer text-destructive focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                            onClick={() => handleDeleteList(list.id, list.name)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={riskyEmailsDialogOpen}
        onOpenChange={(open) => {
          setRiskyEmailsDialogOpen(open);
          if (!open) {
            setRiskyEmailsListId("__all__");
            setRiskyEmailsIncludeCatchAll(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove risky emails</DialogTitle>
            <DialogDescription>
              Choose whether to run this on all contacts or only one list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="risky-email-list-scope">Scope</Label>
            <Select
              value={riskyEmailsListId}
              onValueChange={setRiskyEmailsListId}
            >
              <SelectTrigger id="risky-email-list-scope">
                <SelectValue placeholder="Select list scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All contacts</SelectItem>
                {allContactLists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div
              className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${
                zerobounceSettings?.zerobounce_configured
                  ? "border-border/80 bg-muted/30"
                  : "border-border bg-muted/25"
              }`}
            >
              <Checkbox
                id="risky-email-catch-all"
                checked={riskyEmailsIncludeCatchAll}
                onCheckedChange={(v) => setRiskyEmailsIncludeCatchAll(v === true)}
                className="mt-0.5"
                disabled={!zerobounceSettings?.zerobounce_configured}
              />
              <div className="grid gap-1.5 min-w-0">
                <Label
                  htmlFor="risky-email-catch-all"
                  className={`font-medium leading-snug text-foreground ${zerobounceSettings?.zerobounce_configured ? "cursor-pointer" : "cursor-not-allowed text-foreground/90"}`}
                >
                  Detect catch‑all domains (optional)
                </Label>
                {zerobounceSettings?.zerobounce_configured ? (
                  <p className="text-sm text-foreground/90 leading-snug">
                    <span className="font-medium text-foreground">Off by default.</span> If on, catch‑all domains are detected
                    via <span className="font-semibold text-foreground">ZeroBounce</span> — addresses on those domains will also be removed.
                  </p>
                ) : (
                  <p className="text-sm text-foreground/85 leading-snug">
                    Requires a ZeroBounce API key.{" "}
                    <Link
                      href="/settings?tab=integrations#zerobounce"
                      className="font-medium text-primary underline underline-offset-2 hover:text-primary/90"
                    >
                      Add it in Settings → Integrations
                    </Link>
                    .
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setRiskyEmailsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleStartRemoveRiskyEmails}
              disabled={removeRiskyContacts.isPending || !userId || !!riskyJobId}
            >
              {removeRiskyContacts.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Starting...
                </>
              ) : (
                "Run"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={listDialogOpen}
        onOpenChange={(open) => {
          setListDialogOpen(open);
          if (!open) {
            setEditingList(null);
            setNewListName("");
            setNewListDescription("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingList ? "Edit List" : "Create New List"}
            </DialogTitle>
            <DialogDescription>
              {editingList
                ? "Update list information"
                : "Create a new list to organize your contacts"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="list-name">List Name *</Label>
              <Input
                id="list-name"
                placeholder="e.g., Tech Leads, Q1 Prospects"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="list-description">Description (Optional)</Label>
              <Input
                id="list-description"
                placeholder="Describe the purpose of this list"
                value={newListDescription}
                onChange={(e) => setNewListDescription(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setListDialogOpen(false);
                setEditingList(null);
                setNewListName("");
                setNewListDescription("");
              }}
            >
              Cancel
            </Button>
            <Button
              className="gradient-primary"
              onClick={handleSaveList}
              disabled={
                createList.isPending ||
                updateList.isPending ||
                !newListName.trim()
              }
            >
              {createList.isPending || updateList.isPending
                ? "Saving..."
                : editingList
                  ? "Update"
                  : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AddContactDialog
        open={addContactDialogOpen}
        onOpenChange={setAddContactDialogOpen}
        userId={userId}
        contact={editContact}
      />

      <AddToListDialog
        open={addToListDialogOpen}
        onOpenChange={setAddToListDialogOpen}
        userId={userId}
        contactIds={contactsToAddToList}
      />

      <HelpLinks
        slugs={[
          "import-contacts-csv-excel",
          "map-columns-when-importing-contacts",
          "create-manage-contact-lists",
          "manually-block-unblock-contacts",
          "use-verified-leads-pro",
        ]}
        className="mt-6"
      />

      <Sheet open={!!historyContactId} onOpenChange={(open) => !open && setHistoryContactId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <div className="flex items-center justify-between gap-2 pr-8">
              <SheetTitle>Contact History</SheetTitle>
              {contactHistory && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportHistory}
                  className="shrink-0"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export history
                </Button>
              )}
            </div>
          </SheetHeader>
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : contactHistory ? (
            <div className="mt-6 space-y-6">
              {/* Biodata */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Contact Details</h3>
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center text-white font-semibold text-lg">
                      {`${contactHistory.contact.first_name || ""} ${contactHistory.contact.last_name || ""}`.trim().charAt(0).toUpperCase() || contactHistory.contact.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold">
                        {`${contactHistory.contact.first_name || ""} ${contactHistory.contact.last_name || ""}`.trim() || "—"}
                      </p>
                      <p className="text-sm text-muted-foreground">{contactHistory.contact.email}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Company:</span>{" "}
                      {contactHistory.contact.company || "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Industry:</span>{" "}
                      {contactHistory.contact.industry || "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status:</span>{" "}
                      {getStatusBadge(contactHistory.contact)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Blocked:</span>{" "}
                      {contactHistory.contact.blocked ? "Yes" : "No"}
                    </div>
                  </div>
                  {contactHistory.contact.custom_fields && Object.keys(contactHistory.contact.custom_fields).length > 0 && (
                    <>
                      <Separator />
                      <div className="text-sm space-y-1.5">
                        <span className="text-muted-foreground block mb-1">Custom fields</span>
                        {Object.entries(contactHistory.contact.custom_fields).map(([key, value]) => (
                          <div key={key} className="flex gap-2">
                            <span className="text-muted-foreground shrink-0">
                              {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}:
                            </span>
                            <span className="text-foreground break-words">
                              {value != null && typeof value === "object" ? String(value) : String(value ?? "—")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Engagement Summary</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold tabular-nums">{contactHistory.stats.total_sent}</p>
                    <p className="text-xs text-muted-foreground">Emails sent</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold tabular-nums">{contactHistory.stats.total_opened}</p>
                    <p className="text-xs text-muted-foreground">Opened</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold tabular-nums">{contactHistory.stats.total_clicked}</p>
                    <p className="text-xs text-muted-foreground">Clicked</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold tabular-nums">{contactHistory.stats.total_replied}</p>
                    <p className="text-xs text-muted-foreground">Replied</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center col-span-2 sm:col-span-1">
                    <p className="text-2xl font-bold tabular-nums">{contactHistory.stats.total_link_clicks}</p>
                    <p className="text-xs text-muted-foreground">Link clicks</p>
                  </div>
                </div>
              </div>

              {/* Activity Timeline */}
              <Collapsible open={activitySectionOpen} onOpenChange={setActivitySectionOpen}>
                <div className="flex items-center gap-1.5 mb-3">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-w-0"
                    >
                      {activitySectionOpen ? (
                        <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Activity Timeline</h3>
                    </button>
                  </CollapsibleTrigger>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation transition-colors"
                        aria-label="What clicked and link clicked mean"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className="max-w-[280px] text-left p-3">
                      <p className="font-medium mb-1.5">Clicked vs Link clicked</p>
                      <p className="text-muted-foreground text-xs leading-relaxed mb-2">
                        <strong className="text-foreground">Clicked:</strong> They opened your email and clicked a link in it. We record when that happened.
                      </p>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        <strong className="text-foreground">Link clicked:</strong> The exact link they clicked and how many times. Same action, just showing the URL and count.
                      </p>
                    </PopoverContent>
                  </Popover>
                </div>
                <CollapsibleContent>
                  {(() => {
                    const timelineEvents = contactHistory.events.filter((e: ContactHistoryEvent) => e.type !== "link_clicked");
                    return timelineEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">No activity yet</p>
                    ) : (
                      <div className="space-y-4">
                        {timelineEvents.map((event: ContactHistoryEvent, idx: number) => (
                          <div
                            key={`timeline-${idx}`}
                            className="flex gap-3 items-start border-l-2 border-muted pl-4 relative"
                          >
                            <div className="absolute -left-[9px] top-1 bg-background p-0.5 rounded-full border border-muted">
                              {getHistoryEventIcon(event.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium capitalize">
                                {event.type.charAt(0).toUpperCase() + event.type.slice(1)}
                              </p>
                              {event.timestamp && (
                                <p className="text-xs text-muted-foreground">
                                  {new Date(event.timestamp).toLocaleString()}
                                </p>
                              )}
                              {event.campaign_name && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Campaign: {event.campaign_name}
                                </p>
                              )}
                              {event.subject && (
                                <p className="text-xs text-primary mt-1 truncate max-w-full" title={event.subject}>
                                  {event.subject}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </CollapsibleContent>
              </Collapsible>

              {/* Link Clicked */}
              <Collapsible open={linkClickedSectionOpen} onOpenChange={setLinkClickedSectionOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 mb-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {linkClickedSectionOpen ? (
                      <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Link Clicked</h3>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {(() => {
                    const linkClickedEvents = contactHistory.events.filter((e: ContactHistoryEvent) => e.type === "link_clicked");
                    return linkClickedEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">No link clicks yet</p>
                    ) : (
                      <div className="space-y-4">
                        {linkClickedEvents.map((event: ContactHistoryEvent, idx: number) => (
                          <div
                            key={`link-${idx}`}
                            className="flex gap-3 items-start border-l-2 border-muted pl-4 relative"
                          >
                            <div className="absolute -left-[9px] top-1 bg-background p-0.5 rounded-full border border-muted">
                              {getHistoryEventIcon(event.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                              {event.timestamp && (
                                <p className="text-xs text-muted-foreground mb-0.5">
                                  Clicked: {new Date(event.timestamp).toLocaleString()}
                                </p>
                              )}
                              {event.campaign_name && (
                                <p className="text-xs text-muted-foreground mb-0.5">
                                  Campaign: {event.campaign_name}
                                </p>
                              )}
                              {event.url && (
                                <a
                                  href={event.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary block truncate max-w-full hover:underline"
                                  title={event.url}
                                >
                                  {event.url}
                                </a>
                              )}
                              {event.click_count != null && event.click_count > 0 && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {event.click_count} click{event.click_count !== 1 ? "s" : ""}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8">No history available</p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
