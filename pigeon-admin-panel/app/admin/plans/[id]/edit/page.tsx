"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import {
  PlanForm,
  planToFormData,
  formDataToPayload,
  type PlanFormData,
} from "@/components/PlanForm";

export default function AdminPlanEditPage() {
  const router = useRouter();
  const params = useParams();
  const planId = params?.id as string;

  const [formData, setFormData] = useState<PlanFormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    adminApi
      .get(`/admin/plans/${encodeURIComponent(planId)}`)
      .then((res) => {
        if (!cancelled && res.data) {
          setFormData(planToFormData(res.data as Record<string, unknown>));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(getErrorMessage(err) || "Failed to load plan");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData || !planId) return;
    setError(null);
    setSaving(true);
    try {
      const payload = formDataToPayload(formData);
      await adminApi.put(`/admin/plans/${encodeURIComponent(planId)}`, payload);
      router.push("/admin/plans");
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to save plan");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    router.push("/admin/plans");
  };

  if (loadError) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-zinc-600">
          <button
            type="button"
            onClick={() => router.push("/admin/plans")}
            className="hover:underline"
          >
            Plans
          </button>
          <span>/</span>
          <span className="font-mono">{planId}</span>
        </div>
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => router.push("/admin/plans")}
          className="text-sm text-zinc-600 underline"
        >
          Back to plans
        </button>
      </div>
    );
  }

  if (!formData) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-zinc-500">Loading plan…</p>
      </div>
    );
  }

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
        <span className="font-mono">{planId}</span>
        <span>/</span>
        <span className="font-medium text-zinc-900">Edit</span>
      </div>
      <h1 className="text-xl font-semibold text-zinc-900">
        Edit plan: {formData.name}
      </h1>
      <p className="text-sm text-zinc-600">
        Update any plan fields. Changes are saved to the database and reflected
        on the pricing page.
      </p>
      <PlanForm
        data={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        isCreate={false}
        error={error}
        saving={saving}
      />
    </div>
  );
}
