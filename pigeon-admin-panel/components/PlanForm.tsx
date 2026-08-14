"use client";

import { FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";

export type PlanFeature = { text: string; included: boolean };

export type PlanFormData = {
  id: string;
  name: string;
  price: string;
  annual_price?: string;
  description: string;
  badge?: string;
  best_for?: string;
  cta: string;
  cta_subtext?: string;
  popular: boolean;
  max_domains: number;
  max_subdomains: number;
  max_google_accounts: number;
  max_campaigns: number;
  max_monthly_smtp_emails: number;
  warmup: boolean;
  support: string;
  features: PlanFeature[];
  daily_limit_formula?: string;
  razorpay_plan_id_monthly?: string;
  razorpay_plan_id_annual?: string;
  lemon_squeezy_variant_id_monthly?: string;
  lemon_squeezy_variant_id_annual?: string;
  order: number;
  active: boolean;
  /** When true, /pricing/[planId] for this plan returns 404. Default false. */
  single_plan_page_disabled: boolean;
  created_at?: string;
  updated_at?: string;
};

const defaultFormData: PlanFormData = {
  id: "",
  name: "",
  price: "0",
  annual_price: "",
  description: "",
  badge: "",
  best_for: "",
  cta: "Get started",
  cta_subtext: "",
  popular: false,
  max_domains: 1,
  max_subdomains: 1,
  max_google_accounts: 0,
  max_campaigns: 1,
  max_monthly_smtp_emails: -1,
  warmup: false,
  support: "Community",
  features: [],
  daily_limit_formula: "",
  razorpay_plan_id_monthly: "",
  razorpay_plan_id_annual: "",
  lemon_squeezy_variant_id_monthly: "",
  lemon_squeezy_variant_id_annual: "",
  order: 0,
  active: true,
  single_plan_page_disabled: false,
};

export function getDefaultPlanFormData(): PlanFormData {
  return { ...defaultFormData };
}

export function planToFormData(plan: Record<string, unknown>): PlanFormData {
  return {
    id: (plan.id as string) ?? "",
    name: (plan.name as string) ?? "",
    price: (plan.price as string) ?? "0",
    annual_price: (plan.annual_price as string) ?? "",
    description: (plan.description as string) ?? "",
    badge: (plan.badge as string) ?? "",
    best_for: (plan.best_for as string) ?? "",
    cta: (plan.cta as string) ?? "Get started",
    cta_subtext: (plan.cta_subtext as string) ?? "",
    popular: Boolean(plan.popular),
    max_domains: Number(plan.max_domains) ?? 1,
    max_subdomains: Number(plan.max_subdomains) ?? 1,
    max_google_accounts: Number(plan.max_google_accounts) ?? 0,
    max_campaigns: Number(plan.max_campaigns) ?? 1,
    max_monthly_smtp_emails:
      typeof plan.max_monthly_smtp_emails === "number"
        ? (plan.max_monthly_smtp_emails as number)
        : plan.max_monthly_smtp_emails != null
          ? Number(plan.max_monthly_smtp_emails)
          : -1,
    warmup: Boolean(plan.warmup),
    support: (plan.support as string) ?? "Community",
    features: Array.isArray(plan.features)
      ? (plan.features as PlanFeature[]).map((f) => ({
          text: (f as PlanFeature).text ?? "",
          included: Boolean((f as PlanFeature).included),
        }))
      : [],
    daily_limit_formula: (plan.daily_limit_formula as string) ?? "",
    razorpay_plan_id_monthly: (plan.razorpay_plan_id_monthly as string) ?? "",
    razorpay_plan_id_annual: (plan.razorpay_plan_id_annual as string) ?? "",
    lemon_squeezy_variant_id_monthly: (plan.lemon_squeezy_variant_id_monthly as string) ?? "",
    lemon_squeezy_variant_id_annual: (plan.lemon_squeezy_variant_id_annual as string) ?? "",
    order: Number(plan.order) ?? 0,
    active: plan.active !== false,
    single_plan_page_disabled: Boolean(plan.single_plan_page_disabled),
    created_at: plan.created_at as string | undefined,
    updated_at: plan.updated_at as string | undefined,
  };
}

export function formDataToPayload(data: PlanFormData): Record<string, unknown> {
  return {
    id: data.id,
    name: data.name,
    price: data.price,
    annual_price: data.annual_price || undefined,
    description: data.description,
    badge: data.badge || undefined,
    best_for: data.best_for || undefined,
    cta: data.cta,
    cta_subtext: data.cta_subtext || undefined,
    popular: data.popular,
    max_domains: data.max_domains,
    max_subdomains: data.max_subdomains,
    max_google_accounts: data.max_google_accounts,
    max_campaigns: data.max_campaigns,
    max_monthly_smtp_emails: data.max_monthly_smtp_emails,
    warmup: data.warmup,
    support: data.support,
    features: data.features,
    daily_limit_formula: data.daily_limit_formula || undefined,
    razorpay_plan_id_monthly: (data.razorpay_plan_id_monthly || "").trim() || undefined,
    razorpay_plan_id_annual: (data.razorpay_plan_id_annual || "").trim() || undefined,
    lemon_squeezy_variant_id_monthly: (data.lemon_squeezy_variant_id_monthly || "").trim() || undefined,
    lemon_squeezy_variant_id_annual: (data.lemon_squeezy_variant_id_annual || "").trim() || undefined,
    order: data.order,
    active: data.active,
    single_plan_page_disabled: data.single_plan_page_disabled,
  };
}

type PlanFormProps = {
  data: PlanFormData;
  onChange: (data: PlanFormData) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  isCreate: boolean;
  error: string | null;
  saving?: boolean;
};

export function PlanForm({
  data,
  onChange,
  onSubmit,
  onCancel,
  isCreate,
  error,
  saving = false,
}: PlanFormProps) {
  const set = (updates: Partial<PlanFormData>) =>
    onChange({ ...data, ...updates });

  const updateFeature = (index: number, updates: Partial<PlanFeature>) => {
    const features = [...(data.features ?? [])];
    features[index] = { ...features[index], ...updates };
    set({ features });
  };

  const addFeature = () => {
    set({ features: [...(data.features ?? []), { text: "", included: true }] });
  };

  const removeFeature = (index: number) => {
    const features = data.features?.filter((_, i) => i !== index) ?? [];
    set({ features });
  };

  const moveFeatureUp = (index: number) => {
    if (index <= 0) return;
    const features = [...(data.features ?? [])];
    [features[index - 1], features[index]] = [features[index], features[index - 1]];
    set({ features });
  };

  const moveFeatureDown = (index: number) => {
    const list = data.features ?? [];
    if (index >= list.length - 1) return;
    const features = [...list];
    [features[index], features[index + 1]] = [features[index + 1], features[index]];
    set({ features });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6 text-sm">
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          {error}
        </p>
      )}

      {/* Identity */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
        <h3 className="mb-3 font-semibold text-zinc-800">Identity</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="plan-id" className="text-zinc-700">
              ID (slug, e.g. free, starter)
            </Label>
            <Input
              id="plan-id"
              value={data.id}
              onChange={(e) => set({ id: e.target.value.trim() })}
              required
              disabled={!isCreate}
              placeholder="free"
              className="mt-1 font-mono"
            />
            {!isCreate && (
              <p className="mt-1 text-xs text-zinc-500">ID cannot be changed after creation.</p>
            )}
          </div>
          <div>
            <Label htmlFor="plan-name" className="text-zinc-700">
              Name
            </Label>
            <Input
              id="plan-name"
              value={data.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              placeholder="Free"
              className="mt-1"
            />
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
        <h3 className="mb-3 font-semibold text-zinc-800">Pricing</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="plan-price" className="text-zinc-700">
              Price (e.g. 0, 10, Custom)
            </Label>
            <Input
              id="plan-price"
              value={data.price}
              onChange={(e) => set({ price: e.target.value })}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="plan-annual-price" className="text-zinc-700">
              Annual price (optional)
            </Label>
            <Input
              id="plan-annual-price"
              value={data.annual_price ?? ""}
              onChange={(e) => set({ annual_price: e.target.value || undefined })}
              placeholder=""
              className="mt-1"
            />
          </div>
        </div>
      </div>

      {/* Copy / Marketing */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
        <h3 className="mb-3 font-semibold text-zinc-800">Copy &amp; marketing</h3>
        <div className="space-y-3">
          <div>
            <Label htmlFor="plan-description" className="text-zinc-700">
              Description (use {"{{domains}}"}, {"{{subdomains}}"}, {"{{campaigns}}"}, {"{{googleAccounts}}"}, {"{{dailyEmails}}"} for placeholders)
            </Label>
            <Input
              id="plan-description"
              value={data.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Get started with 1 domain..."
              className="mt-1"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="plan-badge" className="text-zinc-700">
                Badge (e.g. Most popular)
              </Label>
              <Input
                id="plan-badge"
                value={data.badge ?? ""}
                onChange={(e) => set({ badge: e.target.value || undefined })}
                placeholder=""
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="plan-best-for" className="text-zinc-700">
                Best for
              </Label>
              <Input
                id="plan-best-for"
                value={data.best_for ?? ""}
                onChange={(e) => set({ best_for: e.target.value || undefined })}
                placeholder="Small teams"
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="plan-cta" className="text-zinc-700">
                CTA button text
              </Label>
              <Input
                id="plan-cta"
                value={data.cta}
                onChange={(e) => set({ cta: e.target.value })}
                placeholder="Get started"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="plan-cta-subtext" className="text-zinc-700">
                CTA subtext
              </Label>
              <Input
                id="plan-cta-subtext"
                value={data.cta_subtext ?? ""}
                onChange={(e) => set({ cta_subtext: e.target.value || undefined })}
                placeholder="No credit card required"
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="plan-popular"
              checked={data.popular}
              onChange={(e) => set({ popular: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-300"
            />
            <Label htmlFor="plan-popular" className="text-zinc-700">
              Mark as &quot;Popular&quot; on pricing page
            </Label>
          </div>
        </div>
      </div>

      {/* Limits */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
        <h3 className="mb-3 font-semibold text-zinc-800">Limits (use -1 for Custom/unlimited)</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="plan-max-domains" className="text-zinc-700">
              Max domains
            </Label>
            <Input
              id="plan-max-domains"
              type="number"
              min={-1}
              value={data.max_domains}
              onChange={(e) =>
                set({ max_domains: parseInt(e.target.value, 10) ?? 1 })
              }
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="plan-max-subdomains" className="text-zinc-700">
              Max subdomains
            </Label>
            <Input
              id="plan-max-subdomains"
              type="number"
              min={-1}
              value={data.max_subdomains}
              onChange={(e) =>
                set({ max_subdomains: parseInt(e.target.value, 10) ?? 1 })
              }
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="plan-max-google-accounts" className="text-zinc-700">
              Max Google accounts (0 = no Gmail)
            </Label>
            <Input
              id="plan-max-google-accounts"
              type="number"
              min={-1}
              value={data.max_google_accounts}
              onChange={(e) =>
                set({
                  max_google_accounts: parseInt(e.target.value, 10) ?? 0,
                })
              }
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="plan-max-campaigns" className="text-zinc-700">
              Max campaigns
            </Label>
            <Input
              id="plan-max-campaigns"
              type="number"
              min={-1}
              value={data.max_campaigns}
              onChange={(e) =>
                set({ max_campaigns: parseInt(e.target.value, 10) ?? 1 })
              }
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="plan-max-monthly-smtp-emails" className="text-zinc-700">
              Max monthly SMTP emails (-1 = unlimited)
            </Label>
            <Input
              id="plan-max-monthly-smtp-emails"
              type="number"
              min={-1}
              value={data.max_monthly_smtp_emails}
              onChange={(e) =>
                set({
                  max_monthly_smtp_emails: parseInt(e.target.value, 10) ?? -1,
                })
              }
              className="mt-1"
            />
          </div>
        </div>
      </div>

      {/* Razorpay (India) */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
        <h3 className="mb-3 font-semibold text-zinc-800">Razorpay (India)</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Optional. If set, these override RAZORPAY_PLAN_* env vars for this plan. Create monthly and annual plans in Razorpay Dashboard and paste the plan IDs here.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="plan-razorpay-monthly" className="text-zinc-700">
              Razorpay plan ID (monthly)
            </Label>
            <Input
              id="plan-razorpay-monthly"
              value={data.razorpay_plan_id_monthly ?? ""}
              onChange={(e) => set({ razorpay_plan_id_monthly: e.target.value || undefined })}
              placeholder="e.g. plan_xxxx"
              className="mt-1 font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="plan-razorpay-annual" className="text-zinc-700">
              Razorpay plan ID (annual)
            </Label>
            <Input
              id="plan-razorpay-annual"
              value={data.razorpay_plan_id_annual ?? ""}
              onChange={(e) => set({ razorpay_plan_id_annual: e.target.value || undefined })}
              placeholder="e.g. plan_yyyy"
              className="mt-1 font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* Lemon Squeezy (International) */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
        <h3 className="mb-3 font-semibold text-zinc-800">Lemon Squeezy (International)</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Optional. If set, these override LEMONSQUEEZY_VARIANT_* env vars for this plan. Create products/variants in Lemon Squeezy Dashboard and paste the variant IDs here (numeric).
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="plan-lemonsqueezy-monthly" className="text-zinc-700">
              Lemon Squeezy variant ID (monthly)
            </Label>
            <Input
              id="plan-lemonsqueezy-monthly"
              value={data.lemon_squeezy_variant_id_monthly ?? ""}
              onChange={(e) => set({ lemon_squeezy_variant_id_monthly: e.target.value || undefined })}
              placeholder="e.g. 123456"
              className="mt-1 font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="plan-lemonsqueezy-annual" className="text-zinc-700">
              Lemon Squeezy variant ID (annual)
            </Label>
            <Input
              id="plan-lemonsqueezy-annual"
              value={data.lemon_squeezy_variant_id_annual ?? ""}
              onChange={(e) => set({ lemon_squeezy_variant_id_annual: e.target.value || undefined })}
              placeholder="e.g. 123460"
              className="mt-1 font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* Options */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
        <h3 className="mb-3 font-semibold text-zinc-800">Options</h3>
        <div className="space-y-3">
          <div>
            <Label htmlFor="plan-support" className="text-zinc-700">
              Support label
            </Label>
            <Input
              id="plan-support"
              value={data.support}
              onChange={(e) => set({ support: e.target.value })}
              placeholder="Community, Basic, Priority, Dedicated"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="plan-daily-limit-formula" className="text-zinc-700">
              Daily limit formula (e.g. 3×50 subdomains)
            </Label>
            <Input
              id="plan-daily-limit-formula"
              value={data.daily_limit_formula ?? ""}
              onChange={(e) =>
                set({ daily_limit_formula: e.target.value || undefined })
              }
              placeholder=""
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="plan-order" className="text-zinc-700">
              Display order (lower = first)
            </Label>
            <Input
              id="plan-order"
              type="number"
              min={0}
              value={data.order}
              onChange={(e) =>
                set({ order: parseInt(e.target.value, 10) ?? 0 })
              }
              className="mt-1 w-24"
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="plan-active"
                checked={data.active}
                onChange={(e) => set({ active: e.target.checked })}
                className="h-4 w-4 rounded border-zinc-300"
              />
              <Label htmlFor="plan-active" className="text-zinc-700">
                Active (show on pricing page)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="plan-warmup"
                checked={data.warmup}
                onChange={(e) => set({ warmup: e.target.checked })}
                className="h-4 w-4 rounded border-zinc-300"
              />
              <Label htmlFor="plan-warmup" className="text-zinc-700">
                Domain warmup included
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="plan-single-plan-page-disabled"
                checked={data.single_plan_page_disabled}
                onChange={(e) =>
                  set({ single_plan_page_disabled: e.target.checked })
                }
                className="h-4 w-4 rounded border-zinc-300"
              />
              <Label
                htmlFor="plan-single-plan-page-disabled"
                className="text-zinc-700"
              >
                Disable single-plan page (<code className="text-xs">/pricing/{data.id || "plan-id"}</code>)
              </Label>
            </div>
          </div>
        </div>
      </div>

      {/* Features list */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4">
        <h3 className="mb-3 font-semibold text-zinc-800">
          Feature list (shown on pricing cards)
        </h3>
        <p className="mb-3 text-xs text-zinc-500">
          Each line appears on the plan card with a check or dash. Use the arrows to change order. &quot;Domain warmup&quot; is synced with the warmup checkbox above.
        </p>
        <div className="space-y-2">
          {(data.features ?? []).map((f, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 bg-white p-2"
            >
              <div className="flex shrink-0 flex-col gap-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => moveFeatureUp(i)}
                  disabled={i === 0}
                  aria-label="Move up"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => moveFeatureDown(i)}
                  disabled={i === (data.features?.length ?? 0) - 1}
                  aria-label="Move down"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
              <Input
                value={f.text}
                onChange={(e) => updateFeature(i, { text: e.target.value })}
                placeholder="e.g. 1 domain, 1 subdomain"
                className="min-w-[200px] flex-1"
              />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-zinc-600">
                <input
                  type="checkbox"
                  checked={f.included}
                  onChange={(e) =>
                    updateFeature(i, { included: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-zinc-300"
                />
                Included
              </label>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => removeFeature(i)}
                aria-label="Remove feature"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={addFeature}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add feature
        </Button>
      </div>

      {/* Read-only metadata (edit only) */}
      {!isCreate && (data.created_at || data.updated_at) && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-100/50 p-4 text-xs text-zinc-500">
          <h3 className="mb-2 font-semibold text-zinc-600">Metadata</h3>
          {data.created_at && <p>Created: {data.created_at}</p>}
          {data.updated_at && <p>Updated: {data.updated_at}</p>}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : isCreate ? "Create plan" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
