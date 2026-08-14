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
import { Textarea } from "@/components/ui/textarea";
import { Bell } from "lucide-react";

type User = {
  id: string;
  email: string;
  name?: string;
};

export function SendAlertDialog({
  user,
  onSent,
  setError,
}: {
  user: User;
  onSent?: () => void;
  setError: (error: string | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sendEmail, setSendEmail] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      setError("Title and message are required");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await adminApi.post(`/admin/users/${user.id}/send-alert`, {
        title: title.trim(),
        message: message.trim(),
        send_email: sendEmail,
      });
      setTitle("");
      setMessage("");
      setIsOpen(false);
      onSent?.();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to send alert");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" title="Send alert and/or email to this user">
          <Bell className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Alert to User</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          Sending to: <strong>{user.email}</strong>
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="alert-title">Subject / Title</Label>
            <Input
              id="alert-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Alert subject"
              required
            />
          </div>
          <div>
            <Label htmlFor="alert-message">Message</Label>
            <Textarea
              id="alert-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Alert message content"
              rows={4}
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="send-email"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor="send-email" className="cursor-pointer">
              Also send via email
            </Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send Alert"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
