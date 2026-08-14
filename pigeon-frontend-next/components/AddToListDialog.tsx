"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { ContactList } from "@/types/api";

interface AddToListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  contactIds: string[];
}

export function AddToListDialog({
  open,
  onOpenChange,
  userId,
  contactIds,
}: AddToListDialogProps) {
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [newListName, setNewListName] = useState("");
  const [createNewList, setCreateNewList] = useState(false);
  const queryClient = useQueryClient();

  const { data: lists = [], isLoading: listsLoading } = useQuery({
    queryKey: ["contact-lists", userId],
    queryFn: () => api.contactLists.list(userId),
    enabled: !!userId && open,
  });

  const addToExistingList = useMutation({
    mutationFn: (listId: string) =>
      api.contactLists.addContacts(listId, contactIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-lists", userId] });
      queryClient.invalidateQueries({ queryKey: ["contacts", userId] });
      toast.success(`${contactIds.length} contact(s) added to list`);
      onOpenChange(false);
      setSelectedListId("");
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to add contacts to list"
      );
    },
  });

  const createList = useMutation({
    mutationFn: (name: string) =>
      api.contactLists.create(userId, name, contactIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-lists", userId] });
      queryClient.invalidateQueries({ queryKey: ["contacts", userId] });
      toast.success(`New list created with ${contactIds.length} contact(s)`);
      onOpenChange(false);
      setNewListName("");
      setCreateNewList(false);
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create list"
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (createNewList) {
      if (!newListName.trim()) {
        toast.error("List name is required");
        return;
      }
      createList.mutate(newListName.trim());
    } else {
      if (!selectedListId) {
        toast.error("Please select a list");
        return;
      }
      addToExistingList.mutate(selectedListId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to List</DialogTitle>
          <DialogDescription>
            Add {contactIds.length} contact(s) to an existing list or create a new
            one
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Add to existing list or create new?</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={!createNewList ? "default" : "outline"}
                onClick={() => setCreateNewList(false)}
              >
                Existing List
              </Button>
              <Button
                type="button"
                variant={createNewList ? "default" : "outline"}
                onClick={() => setCreateNewList(true)}
              >
                Create New
              </Button>
            </div>
          </div>

          {!createNewList ? (
            <div className="space-y-2">
              <Label htmlFor="list">Select List</Label>
              <Select
                value={selectedListId}
                onValueChange={setSelectedListId}
                disabled={listsLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      listsLoading ? "Loading lists..." : "Choose a list"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {listsLoading ? (
                    <div className="py-2 px-2 text-sm text-muted-foreground">
                      Loading lists...
                    </div>
                  ) : (
                    lists.map((list: ContactList) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name} ({list.contact_ids?.length || 0} contacts)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="newListName">New List Name</Label>
              <Input
                id="newListName"
                placeholder="e.g., Tech Leads"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                required
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="gradient-primary"
              disabled={addToExistingList.isPending || createList.isPending}
            >
              {addToExistingList.isPending || createList.isPending
                ? "Processing..."
                : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
