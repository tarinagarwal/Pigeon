"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import {
  PlanForm,
  getDefaultPlanFormData,
  formDataToPayload,
  planToFormData,
  type PlanFormData,
} from "@/components/PlanForm";

type PlanOption = { id: string; name: string };

export default function AdminPlanNewPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<PlanFormData>(getDefaultPlanFormData());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [existingPlans, setExistingPlans] = useState<PlanOption[]>([]);
  const [importLoading, setImportLoading] = useState(false);

  useEffect(() => {
    adminApi
      .get<{ plans: PlanOption[] }>("/admin/plans")
      .then((res) => setExistingPlans(res.data.plans ?? []))
      .catch(() => setExistingPlans([]));
  }, []);

  const handleImportFromPlan = async (planId: string) => {
    if (!planId) return;
    setImportLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<Record<string, unknown>>(
        `/admin/plans/${encodeURIComponent(planId)}`
      );
      const plan = res.data as Record<string, unknown>;
      const imported = planToFormData(plan);
      setFormData({
        ...imported,
        id: "",
        name: imported.name ? `${imported.name} (copy)` : "",
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load plan");
    } finally {
      setImportLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = formDataToPayload(formData);
      await adminApi.post("/admin/plans", payload);
      router.push("/admin/plans");
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to create plan");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    router.push("/admin/plans");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-zinc-600">
        <button
          type="button"
          onClick={() => router.push("/admin/plans")}
          className="hover:underline"
        >
          Plans
        </button>
        <span>/</span>
        <span className="font-medium text-zinc-900">Add plan</span>
      </div>
      <h1 className="text-xl font-semibold text-zinc-900">Add plan</h1>
      <p className="text-sm text-zinc-600">
        Create a new subscription plan. All fields match the database schema.
      </p>

      {existingPlans.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
          <label
            htmlFor="import-plan"
            className="mb-2 block text-sm font-medium text-zinc-700"
          >
            Import from existing plan
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="import-plan"
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              value=""
              onChange={(e) => handleImportFromPlan(e.target.value)}
              disabled={importLoading}
            >
              <option value="">— Choose a plan to copy —</option>
              {existingPlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </select>
            {importLoading && (
              <span className="text-xs text-zinc-500">Loading…</span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">
            Pre-fill the form with the selected plan. ID is cleared and name gets
            &quot;(copy)&quot; so you can set a new plan id and name.
          </p>
        </div>
      )}

      <PlanForm
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        isCreate={true}
        error={error}
        saving={saving}
      />
    </div>
  );
}
