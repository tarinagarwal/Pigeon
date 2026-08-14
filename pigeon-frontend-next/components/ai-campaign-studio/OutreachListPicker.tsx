"use client";

import { Users } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ContactList } from "@/types/api";

interface OutreachListPickerProps {
  lists: ContactList[];
  selectedListId: string | null;
  onSelect: (listId: string) => void;
}

export function OutreachListPicker({
  lists,
  selectedListId,
  onSelect,
}: OutreachListPickerProps) {
  return (
    <Card className="w-full max-w-md rounded-xl border border-border/60 bg-card/80 shadow-sm text-foreground overflow-hidden">
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-sm text-foreground">Pick who to email</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pb-3 text-foreground">
        {lists.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No contact lists yet. Create one in Contacts.
          </p>
        ) : (
          lists.map((list) => {
            const count =
              list.contact_count ?? list.contact_ids?.length ?? 0;
            const isSelected = list.id === selectedListId;
            return (
              <Button
                key={list.id}
                variant={isSelected ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start font-normal text-foreground rounded-lg h-8"
                onClick={() => onSelect(list.id)}
              >
                {list.name} ({count} contacts)
              </Button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
