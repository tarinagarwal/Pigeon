"use client";

import { useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LogIn } from "lucide-react";

type User = {
  id: string;
  email: string;
  name?: string;
};

export function ImpersonateUserDialog({
  user,
  open,
  onOpenChange,
  setError,
}: {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setError: (error: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [sendNotification, setSendNotification] = useState<"yes" | "no">("yes");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Reason is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (sendNotification === "yes") {
        const title = "Admin has accessed your account";
        const message = `An administrator has accessed your account for the following reason:\n\n"${reason.trim()}"\n\nIf you did not request this, please contact support.`;
        await adminApi.post(`/admin/users/${user.id}/send-alert`, {
          title,
          message,
          send_email: true,
        });
      }
      const res = await adminApi.post<{ token: string }>(
        `/admin/users/${user.id}/impersonate`
      );
      const mainUrl = (
        process.env.NEXT_PUBLIC_MAIN_SITE_URL || "https://www.pigeon.com"
      ).replace(/\/$/, "");
      window.open(
        `${mainUrl}/auth/impersonate?token=${encodeURIComponent(res.data.token)}`,
        "_blank"
      );
      setReason("");
      onOpenChange(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to login as user");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setReason("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5" />
            Login as User
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          Accessing account: <strong>{user.email}</strong>
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="impersonate-reason">
              Reason for accessing this account <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="impersonate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Troubleshooting support ticket #123, investigating billing query..."
              rows={3}
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label className="mb-2 block">Notify user about admin access?</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="send-notification"
                  checked={sendNotification === "yes"}
                  onChange={() => setSendNotification("yes")}
                  className="h-4 w-4"
                />
                <span className="text-sm">Yes – send alert and email</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="send-notification"
                  checked={sendNotification === "no"}
                  onChange={() => setSendNotification("no")}
                  className="h-4 w-4"
                />
                <span className="text-sm">No – login directly</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Logging in..." : "Proceed to Login"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
