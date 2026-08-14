"use client";

import { useState, useEffect } from "react";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useContactLists } from "@/hooks/useContacts";
import { toast } from "sonner";
import type { Contact } from "@/types/api";
import { Loader2 } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormFieldError } from "@/components/forms/FormFieldError";

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  contact?: Contact | null;
}

export function AddContactDialog({
  open,
  onOpenChange,
  userId,
  contact,
}: AddContactDialogProps) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [addToListMode, setAddToListMode] = useState<"existing" | "new">("existing");
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [newListName, setNewListName] = useState("");
  const [errors, setErrors] = useState<{
    email?: string;
    list?: string;
    listName?: string;
  }>({});
  const queryClient = useQueryClient();
  const { data: contactLists = [] } = useContactLists(userId);

  useEffect(() => {
    if (open && contact) {
      setEmail(contact.email || "");
      setFirstName(contact.first_name || "");
      setLastName(contact.last_name || "");
      setCompany(contact.company || "");
      setIndustry(contact.industry || "");
      setLocation(contact.custom_fields?.location || "");
    } else if (open && !contact) {
      setEmail("");
      setFirstName("");
      setLastName("");
      setCompany("");
      setIndustry("");
      setLocation("");
      setAddToListMode("existing");
      setSelectedListId("");
      setNewListName("");
      setErrors({});
    }
  }, [open, contact]);

  const createListMutation = useMutation({
    mutationFn: (name: string) =>
      api.contactLists.create(userId, name, [], undefined),
  });

  const createContact = useMutation({
    mutationFn: async (payload: {
      data: Partial<Contact>;
      listId: string;
    }) => {
      const created = await api.contacts.create(userId, payload.data);
      await api.contactLists.addContacts(payload.listId, [created.id]);
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", userId] });
      queryClient.invalidateQueries({ queryKey: ["contact-lists", userId] });
      toast.success("Contact created successfully");
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to save contact");
    },
  });

  const updateContact = useMutation({
    mutationFn: (data: Partial<Contact>) =>
      api.contacts.update(contact!.id, userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", userId] });
      toast.success("Contact updated successfully");
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to update contact");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: { email?: string; list?: string; listName?: string } = {};
    if (!email.trim()) {
      nextErrors.email = "Email is required.";
    }

    const data: Partial<Contact> = {
      email: email.trim(),
      first_name: firstName.trim() || undefined,
      last_name: lastName.trim() || undefined,
      company: company.trim() || undefined,
      industry: industry.trim() || undefined,
      custom_fields: location.trim() ? { location: location.trim() } : {},
    };

    if (contact) {
      updateContact.mutate(data);
      return;
    }

    if (addToListMode === "existing" && !selectedListId) {
      nextErrors.list = "Please select a list.";
    }
    if (addToListMode === "new" && !newListName.trim()) {
      nextErrors.listName = "Please enter a name for the new list.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error("Please fix the highlighted fields.");
      return;
    }

    let listId = selectedListId;
    if (addToListMode === "new") {
      try {
        const newList = await createListMutation.mutateAsync(newListName.trim());
        listId = newList.id;
      } catch {
        return;
      }
    }
    createContact.mutate({ data, listId: listId! });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add New Contact"}</DialogTitle>
          <DialogDescription>
            {contact
              ? "Update contact information"
              : "Add a new contact to your list"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              placeholder="contact@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrors((prev) => ({ ...prev, email: undefined }));
              }}
              required
              aria-invalid={!!errors.email}
            />
            <FormFieldError message={errors.email} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="company">Company</Label>
            <Input
              id="company"
              placeholder="Acme Corp"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="industry">Industry</Label>
            <Input
              id="industry"
              placeholder="Technology"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              placeholder="San Francisco, CA"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          {!contact && (
            <div className="space-y-4 pt-4 border-t">
              <div>
                <Label className="text-base font-medium">Add to List (Required)</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Contacts must be added to a list. Choose an existing list or create a new one.
                </p>
              </div>
              <div className="space-y-3">
                <RadioGroup
                  value={addToListMode}
                  onValueChange={(value) => {
                    setAddToListMode(value as "existing" | "new");
                    setErrors((prev) => ({ ...prev, list: undefined, listName: undefined }));
                  }}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="list-existing" value="existing" />
                    <Label htmlFor="list-existing" className="cursor-pointer font-normal">
                      Add to existing list
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="list-new" value="new" />
                    <Label htmlFor="list-new" className="cursor-pointer font-normal">
                      Create new list
                    </Label>
                  </div>
                </RadioGroup>
                {addToListMode === "existing" && (
                  <div className="ml-6 space-y-2">
                    <Select
                      value={selectedListId}
                      onValueChange={(value) => {
                        setSelectedListId(value);
                        setErrors((prev) => ({ ...prev, list: undefined }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a list" />
                      </SelectTrigger>
                      <SelectContent>
                        {contactLists.map((list) => (
                          <SelectItem key={list.id} value={list.id}>
                            {list.name} (
                            {list.contact_count ?? list.contact_ids?.length ?? 0}{" "}
                            contacts)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormFieldError message={errors.list} />
                  </div>
                )}
                {addToListMode === "new" && (
                  <div className="ml-6 space-y-2">
                    <Input
                      placeholder="e.g., Q1 Prospects, Tech Leads"
                      value={newListName}
                      onChange={(e) => {
                        setNewListName(e.target.value);
                        setErrors((prev) => ({ ...prev, listName: undefined }));
                      }}
                    />
                    <FormFieldError message={errors.listName} />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="gradient-primary"
              disabled={
                createContact.isPending ||
                updateContact.isPending ||
                createListMutation.isPending ||
                (!contact &&
                  ((addToListMode === "existing" && !selectedListId) ||
                    (addToListMode === "new" && !newListName.trim())))
              }
            >
              {createContact.isPending ||
              updateContact.isPending ||
              createListMutation.isPending
                ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                )
                : contact
                  ? "Update"
                  : "Add Contact"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
