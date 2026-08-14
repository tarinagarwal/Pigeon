"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateDomain } from "@/hooks/useDomains";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Domain } from "@/types/api";
import { usePlanGate } from "@/hooks/usePlanGate";
import { PremiumBadge } from "@/components/PremiumBadge";
import { UpgradeModal } from "@/components/UpgradeModal";

interface AddDomainDialogProps {
  userId: string;
  onSuccess?: (domain: Domain) => void;
}

export function AddDomainDialog({ userId, onSuccess }: AddDomainDialogProps) {
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const isSubmittingRef = useRef(false);
  const createDomain = useCreateDomain();
  const domainGate = usePlanGate("domains");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    if (domainGate.atLimit) {
      toast.error(domainGate.upgradeLine || "Your current plan does not allow adding more domains.");
      setUpgradeOpen(true);
      return;
    }
    isSubmittingRef.current = true;
    if (!domain.trim()) {
      isSubmittingRef.current = false;
      toast.error("Please enter a domain name");
      return;
    }

    try {
      const normalized = domain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
      const createdDomain = await createDomain.mutateAsync({
        user_id: userId,
        domain: normalized,
      });
      setDomain("");
      setOpen(false);
      onSuccess?.(createdDomain as Domain);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to add domain");
    } finally {
      isSubmittingRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="gradient-primary"
          onClick={(e) => {
            if (domainGate.atLimit) {
              e.preventDefault();
              toast.error(domainGate.upgradeLine || "Your current plan does not allow adding more domains.");
              setUpgradeOpen(true);
              return;
            }
          }}
        >
          Add Domain
          {domainGate.atLimit && <span className="ml-2"><PremiumBadge featureKey="domains" /></span>}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Domain</DialogTitle>
            <DialogDescription>
              Add a new domain to start sending emails. You&apos;ll need to configure DNS records after adding.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="domain">Domain Name</Label>
              <Input
                id="domain"
                placeholder="example.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                disabled={createDomain.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Enter your domain without www or http://
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createDomain.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createDomain.isPending} className="gradient-primary">
              {createDomain.isPending ? "Adding..." : "Add Domain"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <UpgradeModal featureKey="domains" gate={domainGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </Dialog>
  );
}
