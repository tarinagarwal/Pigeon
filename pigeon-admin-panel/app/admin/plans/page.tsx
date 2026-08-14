"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { RefreshCw, Zap } from "lucide-react";

type Plan = {
  id: string;
  name: string;
  price: string;
  order?: number;
  max_domains?: number;
  max_subdomains?: number;
  max_google_accounts?: number;
  max_campaigns?: number;
  warmup?: boolean;
  active?: boolean;
  domains_display?: string;
  subdomains_display?: string;
  google_accounts_display?: string;
};

export default function AdminPlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [revalidateResult, setRevalidateResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadPlans = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ plans: Plan[] }>("/admin/plans");
      setPlans(res.data.plans ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load plans");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, []);

  const handleDeactivate = async (planId: string) => {
    if (
      !confirm(
        "Deactivate this plan? It will no longer appear in the public list."
      )
    )
      return;
    setError(null);
    try {
      await adminApi.delete(`/admin/plans/${encodeURIComponent(planId)}`);
      await loadPlans();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to deactivate plan");
    }
  };

  const handleRevalidateCache = async () => {
    setRevalidating(true);
    setRevalidateResult(null);
    try {
      const res = await fetch("/api/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: ["plans"], paths: ["/pricing"] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRevalidateResult({ success: false, message: data.error ?? "Revalidation failed" });
      } else {
        setRevalidateResult({
          success: true,
          message: `Cache cleared for tags: [${data.tags?.join(", ")}] and paths: [${data.paths?.join(", ")}]`,
        });
      }
    } catch (err) {
      setRevalidateResult({ success: false, message: err instanceof Error ? err.message : "Request failed" });
    } finally {
      setRevalidating(false);
    }
  };

  const handleDeletePermanent = async (planId: string, planName: string) => {
    if (
      !confirm(
        `Permanently delete the plan "${planName}" (${planId})? This cannot be undone. Users on this plan may need to be reassigned.`
      )
    )
      return;
    setError(null);
    try {
      await adminApi.delete(
        `/admin/plans/${encodeURIComponent(planId)}/permanent`
      );
      await loadPlans();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete plan");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">
          Subscription Plans
        </h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadPlans}
            disabled={loading}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => router.push("/admin/plans/new")}
            className="bg-zinc-900 text-white hover:bg-zinc-800"
          >
            Add plan
          </Button>
        </div>
      </div>
      <p className="text-xs text-zinc-600">
        Manage plans shown on the pricing page. Limits are enforced when users
        create domains, subdomains, campaigns, and inboxes. Use the edit page to
        change all plan fields.
      </p>

      {/* Cache revalidation panel */}
      <div className="rounded border bg-white px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium text-zinc-800">Pricing page cache</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              After editing plans, force-refresh the pricing page cache so visitors see the latest data immediately.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRevalidateCache}
            disabled={revalidating}
            className="shrink-0 gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            <Zap className={`h-3.5 w-3.5 ${revalidating ? "animate-pulse" : ""}`} />
            {revalidating ? "Revalidating…" : "Revalidate pricing cache"}
          </Button>
        </div>
        {revalidateResult && (
          <p
            className={`mt-2 rounded px-2 py-1.5 text-[11px] ${
              revalidateResult.success
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-600 border border-red-200"
            }`}
          >
            {revalidateResult.success ? "✓ " : "✗ "}
            {revalidateResult.message}
          </p>
        )}
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded border bg-white text-xs">
        <table className="min-w-full border-collapse">
          <thead className="bg-zinc-50">
            <tr>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Order
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                ID
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Name
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Price
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Domains
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Subdomains
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Google accounts
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Campaigns
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Warmup
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Active
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={11}
                  className="px-2 py-4 text-center text-zinc-500"
                >
                  No plans. Add one or run backend to seed defaults.
                </td>
              </tr>
            )}
            {plans.map((plan) => (
              <tr key={plan.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2">{plan.order ?? 0}</td>
                <td className="border-b px-2 py-2 font-mono">{plan.id}</td>
                <td className="border-b px-2 py-2">{plan.name}</td>
                <td className="border-b px-2 py-2">{plan.price}</td>
                <td className="border-b px-2 py-2">
                  {plan.max_domains ?? plan.domains_display ?? "—"}
                </td>
                <td className="border-b px-2 py-2">
                  {plan.max_subdomains ?? plan.subdomains_display ?? "—"}
                </td>
                <td className="border-b px-2 py-2">
                  {plan.max_google_accounts ??
                    plan.google_accounts_display ??
                    "—"}
                </td>
                <td className="border-b px-2 py-2">
                  {plan.max_campaigns ?? "—"}
                </td>
                <td className="border-b px-2 py-2">
                  {plan.warmup ? "Yes" : "No"}
                </td>
                <td className="border-b px-2 py-2">
                  {plan.active ? "Yes" : "No"}
                </td>
                <td className="border-b px-2 py-2">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-zinc-600 underline"
                    onClick={() =>
                      router.push(`/admin/plans/${encodeURIComponent(plan.id)}/edit`)
                    }
                  >
                    Edit
                  </Button>
                  {plan.active && (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={() => handleDeactivate(plan.id)}
                        className="text-amber-600 hover:underline"
                      >
                        Deactivate
                      </button>
                    </>
                  )}
                  {" "}
                  <button
                    type="button"
                    onClick={() =>
                      handleDeletePermanent(plan.id, plan.name ?? plan.id)
                    }
                    className="text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && (
        <p className="text-xs text-zinc-500">Loading plans…</p>
      )}
    </div>
  );
}
