"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ReceiverAccount = {
  id: string;
  provider: string;
  email: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  is_active: boolean;
  last_used_at: string | null;
  daily_reply_cap: number | null;
  auth_method?: string;
  oauth_connected?: boolean;
};

const PROVIDERS = ["gmail", "outlook", "yahoo", "custom"];

const PROVIDER_PRESETS: Record<string, { imapHost: string; imapPort: string; smtpHost: string; smtpPort: string }> = {
  gmail: { imapHost: "imap.gmail.com", imapPort: "993", smtpHost: "smtp.gmail.com", smtpPort: "587" },
  outlook: { imapHost: "outlook.office365.com", imapPort: "993", smtpHost: "smtp.office365.com", smtpPort: "587" },
  yahoo: { imapHost: "imap.mail.yahoo.com", imapPort: "993", smtpHost: "smtp.mail.yahoo.com", smtpPort: "587" },
  custom: { imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "587" },
};

export default function AdminWarmupReceiverAccountsPage() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<ReceiverAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outlookMessage, setOutlookMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [gmailMessage, setGmailMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);
  const [testConfirmOpen, setTestConfirmOpen] = useState(false);
  const [testConfirmAccount, setTestConfirmAccount] = useState<ReceiverAccount | null>(null);
  const [testSendEmail, setTestSendEmail] = useState(true);
  const [testRunning, setTestRunning] = useState(false);
  const [outlookConnecting, setOutlookConnecting] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailRedirectUri, setGmailRedirectUri] = useState<string>("");
  const [gmailRedirectUriCopied, setGmailRedirectUriCopied] = useState(false);

  const [provider, setProvider] = useState("gmail");
  const [gmailAuthMethod, setGmailAuthMethod] = useState<"password" | "oauth">("password");
  const [email, setEmail] = useState("");
  const [imapHost, setImapHost] = useState("imap.gmail.com");
  const [imapPort, setImapPort] = useState("993");
  const [imapUsername, setImapUsername] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [dailyReplyCap, setDailyReplyCap] = useState("");

  const loadAccounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<ReceiverAccount[]>("/admin/warmup/receiver-accounts");
      setAccounts(Array.isArray(res.data) ? res.data : []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load receiver accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (dialogOpen && provider === "gmail" && gmailAuthMethod === "oauth") {
      adminApi.get<{ redirect_uri: string }>("/admin/warmup/gmail-receiver/redirect-uri")
        .then((res) => setGmailRedirectUri(res.data?.redirect_uri ?? ""))
        .catch(() => setGmailRedirectUri(""));
    }
  }, [dialogOpen, provider, gmailAuthMethod]);

  const copyGmailRedirectUri = () => {
    if (!gmailRedirectUri) return;
    navigator.clipboard.writeText(gmailRedirectUri).then(() => {
      setGmailRedirectUriCopied(true);
      setTimeout(() => setGmailRedirectUriCopied(false), 2000);
    });
  };

  // Handle Outlook / Gmail OAuth callback query params
  useEffect(() => {
    const outlook = searchParams.get("outlook");
    const message = searchParams.get("message");
    const gmail = searchParams.get("gmail");

    let shouldReplace = false;

    if (outlook === "success") {
      setOutlookMessage({ type: "success", text: "Outlook account connected successfully." });
      setError(null);
      loadAccounts();
      shouldReplace = true;
    } else if (outlook === "error") {
      const msg = message === "email_already_exists" ? "An account with this email already exists."
        : message === "invalid_or_expired_state" ? "Link expired or invalid. Try again."
        : message === "no_refresh_token" ? "Microsoft did not return a refresh token. Try again."
        : message ? decodeURIComponent(message) : "Outlook connection failed.";
      setOutlookMessage({ type: "error", text: msg });
      shouldReplace = true;
    }

    if (gmail === "success") {
      setGmailMessage({ type: "success", text: "Gmail account connected successfully." });
      setError(null);
      loadAccounts();
      shouldReplace = true;
    } else if (gmail === "error") {
      const msg = message === "email_already_exists" ? "An account with this email already exists."
        : message === "invalid_or_expired_state" ? "Link expired or invalid. Try again."
        : message === "no_refresh_token" ? "Google did not return a refresh token. Try again."
        : message === "oauth_not_configured" ? "Google OAuth is not configured for receiver accounts."
        : message ? decodeURIComponent(message) : "Gmail connection failed.";
      setGmailMessage({ type: "error", text: msg });
      shouldReplace = true;
    }

    if (shouldReplace) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [searchParams]);

  const resetForm = () => {
    setEditingId(null);
    setProvider("gmail");
    setGmailAuthMethod("password");
    setEmail("");
    setImapHost("imap.gmail.com");
    setImapPort("993");
    setImapUsername("");
    setImapPassword("");
    setSmtpHost("smtp.gmail.com");
    setSmtpPort("587");
    setSmtpUsername("");
    setSmtpPassword("");
    setIsActive(true);
    setDailyReplyCap("");
    setDialogOpen(false);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (a: ReceiverAccount) => {
    setEditingId(a.id);
    setProvider(a.provider);
    setEmail(a.email);
    setImapHost(a.imap_host);
    setImapPort(String(a.imap_port));
    setImapUsername(a.imap_username);
    setImapPassword("");
    setSmtpHost(a.smtp_host);
    setSmtpPort(String(a.smtp_port));
    setSmtpUsername(a.smtp_username);
    setSmtpPassword("");
    setIsActive(a.is_active);
    setDailyReplyCap(a.daily_reply_cap != null ? String(a.daily_reply_cap) : "");
    if (a.provider === "gmail" && a.auth_method === "oauth") {
      setGmailAuthMethod("oauth");
    } else {
      setGmailAuthMethod("password");
    }
    setDialogOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        provider,
        email,
        imap_host: imapHost,
        imap_port: parseInt(imapPort, 10),
        imap_username: imapUsername,
        smtp_host: smtpHost,
        smtp_port: parseInt(smtpPort, 10),
        smtp_username: smtpUsername,
        is_active: isActive,
        daily_reply_cap: dailyReplyCap ? parseInt(dailyReplyCap, 10) : undefined,
      };
      if (imapPassword) payload.imap_password = imapPassword;
      if (smtpPassword) payload.smtp_password = smtpPassword;

      if (editingId) {
        await adminApi.put(`/admin/warmup/receiver-accounts/${editingId}`, payload);
      } else {
        if (!imapPassword || !smtpPassword) {
          setError("IMAP and SMTP passwords are required when creating");
          return;
        }
        await adminApi.post("/admin/warmup/receiver-accounts", payload);
      }
      resetForm();
      await loadAccounts();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to save");
    }
  };

  const openTestConfirm = (account: ReceiverAccount) => {
    setTestConfirmAccount(account);
    setTestSendEmail(true);
    setTestConfirmOpen(true);
  };

  const handleTest = async () => {
    const account = testConfirmAccount;
    if (!account) return;
    const id = account.id;
    setTestResult(null);
    setTestRunning(true);
    try {
      const params = new URLSearchParams();
      params.set("send_test_email", testSendEmail ? "true" : "false");
      const res = await adminApi.post<{ ok: boolean; message: string; provider?: string; email?: string }>(
        `/admin/warmup/receiver-accounts/${id}/test?${params.toString()}`
      );
      setTestResult({ id, ok: res.data?.ok ?? false, message: res.data?.message ?? "" });
      setTestConfirmOpen(false);
      setTestConfirmAccount(null);
    } catch (err: unknown) {
      setTestResult({ id, ok: false, message: getErrorMessage(err) || "Test failed" });
    } finally {
      setTestRunning(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this receiver account?")) return;
    try {
      await adminApi.delete(`/admin/warmup/receiver-accounts/${id}`);
      await loadAccounts();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete");
    }
  };

  const handleConnectMicrosoft = async (accountId?: string) => {
    setOutlookConnecting(true);
    setError(null);
    try {
      const url = accountId
        ? `/admin/warmup/outlook-receiver/auth-url?account_id=${encodeURIComponent(accountId)}`
        : "/admin/warmup/outlook-receiver/auth-url";
      const res = await adminApi.get<{ auth_url: string }>(url);
      const authUrl = res.data?.auth_url;
      if (authUrl) {
        window.location.href = authUrl;
        return;
      }
      setError("Could not get Microsoft sign-in URL.");
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to start Microsoft sign-in");
    } finally {
      setOutlookConnecting(false);
    }
  };

  const handleConnectGmail = async (clientId: string, clientSecret: string, accountId?: string) => {
    setGmailConnecting(true);
    setError(null);
    try {
      if (!clientId || !clientSecret) {
        setError("Google Client ID and Client Secret are required to connect via OAuth.");
        return;
      }
      const payload: { client_id: string; client_secret: string; account_id?: string } = {
        client_id: clientId,
        client_secret: clientSecret,
      };
      if (accountId) {
        payload.account_id = accountId;
      }
      const res = await adminApi.post<{ auth_url: string }>("/admin/warmup/gmail-receiver/auth-url", payload);
      const authUrl = res.data?.auth_url;
      if (authUrl) {
        window.location.href = authUrl;
        return;
      }
      setError("Could not get Google sign-in URL.");
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to start Google sign-in");
    } finally {
      setGmailConnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Warm-up receiver accounts</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadAccounts}>
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            Add receiver account
          </Button>
        </div>
      </div>
      <p className="text-xs text-zinc-600">
        Platform-level external accounts (Gmail, Outlook, Yahoo) that receive warm-up emails and
        auto open, reply, and mark not spam. All warming inboxes use this pool.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {outlookMessage && (
        <p className={`text-xs ${outlookMessage.type === "success" ? "text-green-600" : "text-red-600"}`}>
          {outlookMessage.text}
        </p>
      )}
      {gmailMessage && (
        <p className={`text-xs ${gmailMessage.type === "success" ? "text-green-600" : "text-red-600"}`}>
          {gmailMessage.text}
        </p>
      )}
      {testResult && (
        <p className={`text-xs ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
          Test: {testResult.message}
        </p>
      )}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-zinc-50">
            <tr>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Email</th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Provider</th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Status</th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Last used</th>
              <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-zinc-500">
                  No receiver accounts. Add one to enable warm-up replies.
                </td>
              </tr>
            )}
            {accounts.map((a) => (
              <tr key={a.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2">{a.email}</td>
                <td className="border-b px-2 py-2">
                  {a.provider}
                  {a.oauth_connected && (
                    <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">OAuth</span>
                  )}
                </td>
                <td className="border-b px-2 py-2">{a.is_active ? "Active" : "Inactive"}</td>
                <td className="border-b px-2 py-2">
                  {a.last_used_at
                    ? new Date(a.last_used_at).toLocaleString()
                    : "—"}
                </td>
                <td className="border-b px-2 py-2 text-right space-x-1">
                  <Button variant="outline" size="sm" onClick={() => openEdit(a)}>
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openTestConfirm(a)}>
                    Test
                  </Button>
                  <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDelete(a.id)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="text-xs text-zinc-500">Loading...</p>}

      <Dialog open={testConfirmOpen} onOpenChange={(open) => { setTestConfirmOpen(open); if (!open) setTestConfirmAccount(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Run receiver test</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm text-zinc-600">
                <p>
                  This checks mail access (IMAP, Microsoft Graph, or Gmail API) and can verify outbound delivery
                  {testConfirmAccount ? (
                    <> for <span className="font-medium text-zinc-800">{testConfirmAccount.email}</span>.</>
                  ) : (
                    "."
                  )}
                </p>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50/80 p-3">
                  <input
                    type="checkbox"
                    id="test-send-email"
                    checked={testSendEmail}
                    onChange={(e) => setTestSendEmail(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                  />
                  <span>
                    <span className="font-medium text-zinc-800">Send test email</span>
                    <span className="block text-xs font-normal text-zinc-500">
                      When enabled, the server sends one test message to the platform test inbox. Turn off to only verify
                      connection and login without sending mail.
                    </span>
                  </span>
                </label>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setTestConfirmOpen(false)} disabled={testRunning}>
              Cancel
            </Button>
            <Button type="button" onClick={handleTest} disabled={testRunning}>
              {testRunning ? "Running…" : "Run test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit receiver account" : "Add receiver account"}</DialogTitle>
            <DialogDescription>
              {provider === "outlook"
                ? "Outlook requires Microsoft sign-in (OAuth). Gmail and Yahoo use app passwords unless you choose Gmail OAuth below."
                : provider === "gmail" && gmailAuthMethod === "oauth"
                  ? "Gmail OAuth connects using Google sign-in. IMAP/SMTP passwords are not stored."
                  : "IMAP is used to read and mark messages; SMTP is used to send replies. Use app passwords for Gmail, or switch to Gmail OAuth."}
            </DialogDescription>
          </DialogHeader>
          {provider === "gmail" && gmailAuthMethod === "oauth" && !editingId ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-zinc-600">
                Add a Gmail receiver account by signing in with Google. We use OAuth tokens to access your mailbox;
                IMAP/SMTP passwords are not stored.
              </p>
              {gmailRedirectUri && (
                <div className="space-y-1">
                  <Label className="text-xs">Redirect URI (add in Google Cloud Console)</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={gmailRedirectUri}
                      className="text-xs font-mono flex-1"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={copyGmailRedirectUri}>
                      {gmailRedirectUriCopied ? "Copied" : "Copy redirect URL"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label>Google Client ID</Label>
                  <Input
                    type="text"
                    value={imapUsername}
                    onChange={(e) => setImapUsername(e.target.value)}
                    placeholder="Your Google OAuth client ID"
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Google Client Secret</Label>
                  <Input
                    type="password"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                    placeholder="Your Google OAuth client secret"
                    className="text-sm"
                  />
                </div>
              </div>
              <Button
                type="button"
                onClick={() => handleConnectGmail(imapUsername, smtpPassword)}
                disabled={gmailConnecting}
                className="w-full"
              >
                {gmailConnecting ? "Redirecting…" : "Connect with Google"}
              </Button>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </div>
          ) : provider === "gmail" && gmailAuthMethod === "oauth" && editingId && accounts.find((a) => a.id === editingId)?.oauth_connected ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-zinc-600">
                Gmail OAuth is connected. Reconnect with Google to refresh tokens or update the Google Cloud client.
              </p>
              {gmailRedirectUri && (
                <div className="space-y-1">
                  <Label className="text-xs">Redirect URI (add in Google Cloud Console)</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={gmailRedirectUri}
                      className="text-xs font-mono flex-1"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={copyGmailRedirectUri}>
                      {gmailRedirectUriCopied ? "Copied" : "Copy redirect URL"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label>Google Client ID</Label>
                  <Input
                    type="text"
                    value={imapUsername}
                    onChange={(e) => setImapUsername(e.target.value)}
                    placeholder="Your Google OAuth client ID"
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Google Client Secret</Label>
                  <Input
                    type="password"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                    placeholder="Your Google OAuth client secret"
                    className="text-sm"
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleConnectGmail(imapUsername, smtpPassword, editingId)}
                disabled={gmailConnecting}
              >
                {gmailConnecting ? "Redirecting…" : "Reconnect with Google"}
              </Button>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <Label>Email (Gmail address)</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. you@gmail.com"
                    className="text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_active_gmail_oauth"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <Label htmlFor="is_active_gmail_oauth">Active</Label>
                </div>
                <div className="space-y-1">
                  <Label>Daily reply cap (optional)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={dailyReplyCap}
                    onChange={(e) => setDailyReplyCap(e.target.value)}
                    placeholder="Leave empty for no cap"
                    className="text-sm"
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Update</Button>
                </DialogFooter>
              </form>
            </div>
          ) : provider === "outlook" && !editingId ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-zinc-600">
                Add an Outlook receiver account by signing in with Microsoft. Your email will be read from your Microsoft account.
              </p>
              <Button
                type="button"
                onClick={() => handleConnectMicrosoft()}
                disabled={outlookConnecting}
                className="w-full"
              >
                {outlookConnecting ? "Redirecting…" : "Connect with Microsoft"}
              </Button>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </div>
          ) : provider === "outlook" && editingId && accounts.find((a) => a.id === editingId)?.oauth_connected ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-zinc-600">
                Microsoft sign-in is connected. Reconnect to refresh tokens.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleConnectMicrosoft(editingId)}
                disabled={outlookConnecting}
              >
                {outlookConnecting ? "Redirecting…" : "Reconnect with Microsoft"}
              </Button>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <Label>Email (Outlook mailbox address)</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. you@outlook.com"
                    className="text-sm"
                  />
                  <p className="text-xs text-zinc-500">
                    Use your Outlook mailbox address (e.g. you.name@outlook.com), not the sign-in email, if they differ.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_active_oauth"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <Label htmlFor="is_active_oauth">Active</Label>
                </div>
                <div className="space-y-1">
                  <Label>Daily reply cap (optional)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={dailyReplyCap}
                    onChange={(e) => setDailyReplyCap(e.target.value)}
                    placeholder="Leave empty for no cap"
                    className="text-sm"
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Update</Button>
                </DialogFooter>
              </form>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Provider</Label>
                <select
                  value={provider}
                  onChange={(e) => {
                    const next = e.target.value;
                    setProvider(next);
                    if (next !== "gmail") {
                      setGmailAuthMethod("password");
                    }
                    const preset = PROVIDER_PRESETS[next];
                    if (preset) {
                      setImapHost(preset.imapHost);
                      setImapPort(preset.imapPort);
                      setSmtpHost(preset.smtpHost);
                      setSmtpPort(preset.smtpPort);
                    }
                  }}
                  className="w-full rounded border px-2 py-1.5 text-sm"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="text-sm"
                />
              </div>
            </div>
            {provider === "gmail" && (
              <div className="space-y-1">
                <Label>Gmail auth method</Label>
                <select
                  value={gmailAuthMethod}
                  onChange={(e) => setGmailAuthMethod(e.target.value === "oauth" ? "oauth" : "password")}
                  className="w-full rounded border px-2 py-1.5 text-sm"
                >
                  <option value="password">App password (IMAP/SMTP)</option>
                  <option value="oauth">Gmail OAuth (Google sign-in)</option>
                </select>
                <p className="text-xs text-zinc-500">
                  Choose Gmail OAuth to connect using Google sign-in instead of storing an app password.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>IMAP host</Label>
                <Input value={imapHost} onChange={(e) => setImapHost(e.target.value)} required className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label>IMAP port</Label>
                <Input value={imapPort} onChange={(e) => setImapPort(e.target.value)} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>IMAP username</Label>
              <Input value={imapUsername} onChange={(e) => setImapUsername(e.target.value)} required className="text-sm" />
            </div>
            {provider !== "outlook" && gmailAuthMethod === "password" && (
              <>
                {!editingId && (
                  <div className="space-y-1">
                    <Label>IMAP password</Label>
                    <Input
                      type="password"
                      value={imapPassword}
                      onChange={(e) => setImapPassword(e.target.value)}
                      placeholder={editingId ? "Leave blank to keep" : "Required"}
                      className="text-sm"
                    />
                  </div>
                )}
                {editingId && (
                  <div className="space-y-1">
                    <Label>IMAP password (leave blank to keep current)</Label>
                    <Input
                      type="password"
                      value={imapPassword}
                      onChange={(e) => setImapPassword(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                )}
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>SMTP host</Label>
                <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} required className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label>SMTP port</Label>
                <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>SMTP username</Label>
              <Input value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} required className="text-sm" />
            </div>
            {provider !== "outlook" && gmailAuthMethod === "password" && (
              <div className="space-y-1">
                <Label>SMTP password {editingId && "(leave blank to keep)"}</Label>
                <Input
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder={editingId ? "Leave blank to keep" : "Required"}
                  className="text-sm"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
            <div className="space-y-1">
              <Label>Daily reply cap (optional)</Label>
              <Input
                type="number"
                min={0}
                value={dailyReplyCap}
                onChange={(e) => setDailyReplyCap(e.target.value)}
                placeholder="Leave empty for no cap"
                className="text-sm"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">{editingId ? "Update" : "Create"}</Button>
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
