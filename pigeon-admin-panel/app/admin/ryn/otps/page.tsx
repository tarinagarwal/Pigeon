"use client";

import { useEffect, useState, useCallback } from "react";
import { KeyRound, RefreshCw, Clock, Trash2, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

interface RYNOtp {
  email: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  provider?: string;
  mx_ok?: boolean;
}

function timeRemaining(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function isExpired(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}

export default function AdminRYNOTPsPage() {
  const [otps, setOtps] = useState<RYNOtp[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);
  const [banner, setBanner] = useState<{ type: "error"; text: string } | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setBanner(null);
    try {
      const { data } = await adminApi.get<{ otps: RYNOtp[]; total: number }>("/admin/ryn/otps?limit=100");
      setOtps(data.otps);
      setTotal(data.total);
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  async function handleRevoke(email: string) {
    if (!confirm(`Revoke OTP for ${email}?`)) return;
    setBanner(null);
    try {
      await adminApi.delete(`/admin/ryn/otps/${encodeURIComponent(email)}`);
      load(true);
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    }
  }

  const activeOtps = otps.filter((o) => !isExpired(o.expires_at));
  const expiredOtps = otps.filter((o) => isExpired(o.expires_at));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">RYN OTPs</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {total} OTP records · {activeOtps.length} active
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5 shrink-0">
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {banner && (
        <p className="text-sm rounded-lg border border-red-200 bg-red-50 text-red-900 px-3 py-2 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {banner.text}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : otps.length === 0 ? (
        <Card className="border-border/80 border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">No OTP records.</CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {activeOtps.length > 0 && (
            <Card className="border-border/80 shadow-sm overflow-hidden py-0">
              <CardHeader className="p-4 pb-3 border-b border-border/80">
                <CardTitle className="text-base">Active ({activeOtps.length})</CardTitle>
                <CardDescription>Verification codes not yet used or expired</CardDescription>
              </CardHeader>
              <div className="divide-y divide-border/80">
                {activeOtps.map((otp) => {
                  const remaining = timeRemaining(otp.expires_at);
                  const progress = Math.max(
                    0,
                    Math.min(
                      100,
                      ((new Date(otp.expires_at).getTime() - Date.now()) /
                        (new Date(otp.expires_at).getTime() - new Date(otp.created_at).getTime())) *
                        100
                    )
                  );
                  return (
                    <div key={otp.email} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <KeyRound className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium break-all">{otp.email}</p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 shrink-0" />
                              {new Date(otp.created_at).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            {otp.provider ? <span className="text-muted-foreground">· {otp.provider}</span> : null}
                          </div>
                          <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden max-w-md">
                            <div className="h-full rounded-full bg-primary/40 transition-all duration-1000" style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0 flex flex-col items-end gap-1">
                          <span className="text-xs font-medium tabular-nums inline-flex items-center gap-1 text-foreground">
                            <Timer className="w-3 h-3 text-muted-foreground" />
                            {remaining}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Expires {new Date(otp.expires_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs mt-1 text-destructive border-destructive/20 hover:bg-destructive/10"
                            onClick={() => handleRevoke(otp.email)}
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            Revoke
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {expiredOtps.length > 0 && (
            <Card className="border-border/80 shadow-sm overflow-hidden py-0 opacity-90">
              <CardHeader className="p-4 pb-3 border-b border-border/80">
                <CardTitle className="text-base text-muted-foreground">Expired ({expiredOtps.length})</CardTitle>
                <CardDescription>Waiting for TTL cleanup</CardDescription>
              </CardHeader>
              <div className="divide-y divide-border/80">
                {expiredOtps.map((otp) => (
                  <div key={otp.email} className="flex items-start gap-3 px-4 py-3">
                    <KeyRound className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-muted-foreground break-all">{otp.email}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(otp.expires_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => handleRevoke(otp.email)} title="Delete record">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      <Card className="border-border/80 bg-muted/20">
        <CardContent className="p-4 text-xs text-muted-foreground leading-relaxed">
          OTPs expire after 15 minutes and are removed automatically (TTL). Verification codes are never shown here — you can only revoke pending OTPs
          early.
        </CardContent>
      </Card>
    </div>
  );
}
