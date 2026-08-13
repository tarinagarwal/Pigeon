"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, Unlock, Search, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import {
  useContacts,
  useBlockContacts,
  useUnblockContacts,
} from "@/hooks/useContacts";
import { HelpLinks } from "@/components/HelpLinks";
import type { Contact } from "@/types/api";

const UNBLOCK_WARNING =
  "Unblocking lets these contacts receive campaigns again. Sending to repeatedly unengaged contacts can hurt your sender reputation. Only unblock if you have a good reason.";

type ViewFilter = "manual_unblock" | "blocked";

export default function ManualBlockUnblockPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const confirmDialog = useConfirmDialog();
  const [viewFilter, setViewFilter] = useState<ViewFilter>("manual_unblock");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: contactsData, isLoading } = useContacts(userId, 0, 5000);
  const allContacts = contactsData?.contacts || [];
  const blockContacts = useBlockContacts();
  const unblockContacts = useUnblockContacts();

  const filteredContacts = allContacts.filter((c) => {
    const matchesView =
      (viewFilter === "manual_unblock" && c.manual_unblock === true) ||
      (viewFilter === "blocked" && c.blocked === true);
    if (!matchesView) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim().toLowerCase();
    return (
      c.email.toLowerCase().includes(q) ||
      name.includes(q) ||
      (c.company || "").toLowerCase().includes(q)
    );
  });

  const manuallyUnblockedCount = allContacts.filter((c) => c.manual_unblock === true).length;
  const blockedCount = allContacts.filter((c) => c.blocked === true).length;

  const handleBlock = async (contact: Contact) => {
    if (!contact.manual_unblock) return;
    const confirmed = await confirmDialog({
      title: "Block contact",
      description: `Block ${contact.email}? They will be excluded from campaigns again (if they meet the block criteria).`,
      variant: "default",
    });
    if (confirmed) blockContacts.mutate({ userId, contactIds: [contact.id] });
  };

  const handleUnblock = async (contact: Contact) => {
    if (!contact.blocked) return;
    const confirmed = await confirmDialog({
      title: "Unblock contact",
      description: `Unblock ${contact.email}? ${UNBLOCK_WARNING}`,
      variant: "default",
    });
    if (confirmed) unblockContacts.mutate({ userId, contactIds: [contact.id] });
  };

  const blockableSelected = selectedIds.filter((id) => {
    const c = allContacts.find((x) => x.id === id);
    return c?.manual_unblock === true;
  });
  const unblockableSelected = selectedIds.filter((id) => {
    const c = allContacts.find((x) => x.id === id);
    return c?.blocked === true;
  });

  const handleBlockSelected = async () => {
    if (blockableSelected.length === 0) return;
    const confirmed = await confirmDialog({
      title: "Block contacts",
      description: `Block ${blockableSelected.length} contact(s)? They will be excluded from campaigns again if they meet the block criteria.`,
      variant: "default",
    });
    if (confirmed) blockContacts.mutate({ userId, contactIds: blockableSelected });
    setSelectedIds([]);
  };

  const handleUnblockSelected = async () => {
    if (unblockableSelected.length === 0) return;
    const confirmed = await confirmDialog({
      title: "Unblock contacts",
      description: UNBLOCK_WARNING,
      variant: "default",
    });
    if (confirmed) unblockContacts.mutate({ userId, contactIds: unblockableSelected });
    setSelectedIds([]);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const selectAll = () => {
    if (selectedIds.length === filteredContacts.length) setSelectedIds([]);
    else setSelectedIds(filteredContacts.map((c) => c.id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/contacts">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Manual Block / Unblock</h1>
          <p className="text-muted-foreground">
            Manage contacts that are manually unblocked or currently blocked. Block or unblock by email to control campaign eligibility.
          </p>
        </div>
      </div>

      <Card className="border border-destructive/30 bg-destructive/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
            <div className="text-sm text-destructive/90 [&_strong]:font-semibold [&_strong]:text-destructive">
              <strong>Manually unblocked</strong> contacts can receive campaigns even after hitting the engagement threshold. Use <strong>Block</strong> here to turn that off. <strong>Blocked</strong> contacts are excluded from campaigns. Once you block someone here, they follow our actual system (engagement and sent-count rules) and no longer bypass them. Use <strong>Unblock</strong> to allow them again (use with care to protect sender reputation).
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle>Contacts</CardTitle>
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by email or name..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={viewFilter} onValueChange={(v) => setViewFilter(v as ViewFilter)} className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="manual_unblock">
                Manually unblocked ({manuallyUnblockedCount})
              </TabsTrigger>
              <TabsTrigger value="blocked">
                Blocked ({blockedCount})
              </TabsTrigger>
            </TabsList>
            <div className="mt-4">
              {selectedIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <span className="text-sm font-medium">{selectedIds.length} selected</span>
                  {blockableSelected.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBlockSelected}
                      disabled={blockContacts.isPending}
                    >
                      <Lock className="w-4 h-4 mr-2" />
                      Block ({blockableSelected.length})
                    </Button>
                  )}
                  {unblockableSelected.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUnblockSelected}
                      disabled={unblockContacts.isPending}
                    >
                      <Unlock className="w-4 h-4 mr-2" />
                      Unblock ({unblockableSelected.length})
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                    Clear selection
                  </Button>
                </div>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      {filteredContacts.length > 0 && (
                        <input
                          type="checkbox"
                          checked={
                            selectedIds.length === filteredContacts.length &&
                            filteredContacts.length > 0
                          }
                          onChange={selectAll}
                          className="rounded border-input"
                        />
                      )}
                    </TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : filteredContacts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        {viewFilter === "manual_unblock"
                          ? "No manually unblocked contacts."
                          : "No blocked contacts."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredContacts.map((contact) => {
                      const name =
                        `${contact.first_name || ""} ${contact.last_name || ""}`.trim() || "—";
                      return (
                        <TableRow key={contact.id} className="hover:bg-secondary/50">
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(contact.id)}
                              onChange={() => toggleSelect(contact.id)}
                              className="rounded border-input"
                            />
                          </TableCell>
                          <TableCell className="font-medium">{contact.email}</TableCell>
                          <TableCell>{name}</TableCell>
                          <TableCell>
                            {contact.manual_unblock && (
                              <Badge className="bg-success text-success-foreground border-success hover:bg-success hover:text-success-foreground text-xs">
                                Manually unblocked
                              </Badge>
                            )}
                            {contact.blocked && !contact.manual_unblock && (
                              <Badge variant="secondary" className="text-xs">
                                {contact.status === "unsubscribed" ? "Unsubscribed" : "Blocked"}
                              </Badge>
                            )}
                            {!contact.blocked && !contact.manual_unblock && (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {contact.manual_unblock && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleBlock(contact)}
                                disabled={blockContacts.isPending}
                              >
                                <Lock className="w-4 h-4 mr-2" />
                                Block
                              </Button>
                            )}
                            {contact.blocked && !contact.manual_unblock && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleUnblock(contact)}
                                disabled={unblockContacts.isPending}
                              >
                                <Unlock className="w-4 h-4 mr-2" />
                                Unblock
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Tabs>
        </CardContent>
      </Card>

      <HelpLinks slugs={["manually-block-unblock-contacts", "create-manage-contact-lists"]} className="mt-6" />
    </div>
  );
}
