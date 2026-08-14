"use client";

import { useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Coins } from "lucide-react";

type User = {
  id: string;
  email: string;
};

export function AddCreditsDialog({
  user,
  onAdded,
  setError,
}: {
  user: User;
  onAdded?: (newBalance: number) => void;
  setError: (error: string | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ amount_added: number; new_balance: number } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(amount, 10);
    if (!parsed || parsed <= 0) {
      setError("Enter a valid positive number of credits");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await adminApi.post(`/admin/users/${user.id}/add-credits`, {
        amount: parsed,
        note: note.trim(),
      });
      setResult(res.data);
      onAdded?.(res.data.new_balance);
      setAmount("");
      setNote("");
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to add credits");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = (open: boolean) => {
    setIsOpen(open);
    if (!open) setResult(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" title="Add warmup credits to this user">
          <Coins className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Warmup Credits</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          Adding credits to: <strong>{user.email}</strong>
        </p>
        <p className="text-xs text-gray-500">
          Credits are added directly — no payment required. Logged as{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">admin_topup</code>.
        </p>

        {result ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 space-y-1">
            <p className="font-semibold">✓ {result.amount_added} credits added</p>
            <p>New balance: <strong>{result.new_balance} credits</strong></p>
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={() => setIsOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="credit-amount">Number of credits</Label>
              <Input
                id="credit-amount"
                type="number"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 100"
                required
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="credit-note">
                Note <span className="text-gray-400 font-normal">(optional)</span>
              </Label>
              <Input
                id="credit-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Compensation for downtime"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Adding..." : "Add Credits"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
