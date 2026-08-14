"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Mail, Users, MessageSquare } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useContacts } from "@/hooks/useContacts";
import { useInboxEmails } from "@/hooks/useInboxEmails";

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const router = useRouter();
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;

  const { data: campaigns = [] } = useCampaigns(userId, { archived: false });
  const { data: contactsData } = useContacts(userId);
  const contacts = contactsData?.contacts ?? [];
  const { data: inboxEmails = [] } = useInboxEmails(userId);

  const [search, setSearch] = useState("");

  // Ignore cmdk setting value to a CommandItem's value (e.g. on keyboard nav) so we don't show "No results for campaign-uuid-Name"
  const handleValueChange = (value: string) => {
    const isItemValue =
      value.startsWith("campaign-") || value.startsWith("contact-") || value.startsWith("email-");
    if (!isItemValue) setSearch(value);
  };

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const q = search.trim().toLowerCase();
  const filteredCampaigns = useMemo(
    () =>
      !q
        ? campaigns.slice(0, 5)
        : campaigns.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 5),
    [campaigns, q]
  );
  const filteredContacts = useMemo(
    () =>
      !q
        ? contacts.slice(0, 5)
        : contacts
            .filter(
              (c) =>
                c.email?.toLowerCase().includes(q) ||
                (c.first_name || "").toLowerCase().includes(q) ||
                (c.last_name || "").toLowerCase().includes(q) ||
                (c.company || "").toLowerCase().includes(q)
            )
            .slice(0, 5),
    [contacts, q]
  );
  const filteredEmails = useMemo(
    () =>
      !q
        ? inboxEmails.slice(0, 5)
        : inboxEmails
            .filter(
              (e) =>
                (e.subject ?? "").toLowerCase().includes(q) ||
                (e.senderEmail ?? "").toLowerCase().includes(q) ||
                (e.sender ?? "").toLowerCase().includes(q)
            )
            .slice(0, 5),
    [inboxEmails, q]
  );

  const hasResults =
    filteredCampaigns.length > 0 ||
    filteredContacts.length > 0 ||
    filteredEmails.length > 0;

  const handleSelect = (path: string) => {
    router.push(path);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="overflow-hidden p-0 shadow-lg gap-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5 [&_[cmdk-item][data-selected=true]]:bg-muted [&_[cmdk-item][data-selected=true]]:text-foreground"
          value={search}
          onValueChange={handleValueChange}
          shouldFilter={false}
        >
          <CommandInput placeholder="Search campaigns, contacts, emails…" />
          <CommandList>
            <CommandEmpty>
              {search.trim()
                ? `No results for "${search.trim()}"`
                : "Type to search campaigns, contacts, and emails."}
            </CommandEmpty>
            {hasResults && (
          <>
            {filteredCampaigns.length > 0 && (
              <CommandGroup heading="Campaigns">
                {filteredCampaigns.map((campaign) => (
                  <CommandItem
                    key={campaign.id}
                    value={`campaign-${campaign.id}-${campaign.name}`}
                    onSelect={() => handleSelect("/campaigns")}
                    className="gap-3"
                  >
                    <Mail className="h-4 w-4 shrink-0 text-primary" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{campaign.name}</span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {campaign.status}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filteredContacts.length > 0 && (
              <CommandGroup heading="Contacts">
                {filteredContacts.map((contact) => (
                  <CommandItem
                    key={contact.id}
                    value={`contact-${contact.id}-${contact.email}-${contact.first_name}-${contact.last_name}`}
                    onSelect={() => handleSelect("/contacts")}
                    className="gap-3"
                  >
                    <Users className="h-4 w-4 shrink-0 text-primary" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">
                        {[contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unnamed"}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {contact.email}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filteredEmails.length > 0 && (
              <CommandGroup heading="Emails">
                {filteredEmails.map((email) => (
                  <CommandItem
                    key={email.id}
                    value={`email-${email.id}-${email.subject}-${email.sender}`}
                    onSelect={() => handleSelect("/inbox/campaign-replies")}
                    className="gap-3"
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{email.subject || "(No subject)"}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        From: {email.sender || email.senderEmail}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
        </Command>
        </DialogContent>
      )}
    </Dialog>
  );
}
