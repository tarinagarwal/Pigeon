"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type Domain = {
  id: string;
  domain: string;
  user_id?: string;
  status?: string;
  health_score?: number;
  spf_record?: string | null;
  dkim_selector?: string | null;
  dkim_public_key?: string | null;
  dmarc_record?: string | null;
  dns_records?: Record<string, unknown> | null;
};

export default function AdminDomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncDomainOverrides, setSyncDomainOverrides] = useState<Record<string, string>>({});
  const [editingDomainId, setEditingDomainId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editDomain, setEditDomain] = useState("");
  const [editStatus, setEditStatus] = useState("pending");
  const [editSpfRecord, setEditSpfRecord] = useState("");
  const [editDkimSelector, setEditDkimSelector] = useState("");
  const [editDkimPublicKey, setEditDkimPublicKey] = useState("");
  const [editDmarcRecord, setEditDmarcRecord] = useState("");
  const [editSpfName, setEditSpfName] = useState("");
  const [editSpfValue, setEditSpfValue] = useState("");
  const [editDkimName, setEditDkimName] = useState("");
  const [editDkimValue, setEditDkimValue] = useState("");
  const [editDmarcName, setEditDmarcName] = useState("");
  const [editDmarcValue, setEditDmarcValue] = useState("");
  const [editMxName, setEditMxName] = useState("");
  const [editMxValue, setEditMxValue] = useState("");
  const [editDnsRecordsJson, setEditDnsRecordsJson] = useState("{}");

  const fetchDomains = async () => {
    setLoading(true);
    setError(null);
    try {
      const limit = 200;
      let skip = 0;
      let total = 0;
      const allDomains: Domain[] = [];

      do {
        const res = await adminApi.get<{ domains: Domain[]; total?: number }>(
          "/admin/domains",
          { params: { limit, skip } },
        );
        const page = res.data.domains ?? [];
        total = res.data.total ?? page.length;
        allDomains.push(...page);
        skip += page.length;
        if (page.length === 0) break;
      } while (allDomains.length < total);

      setDomains(allDomains);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load domains");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDomains();
  }, []);

  const openEdit = async (id: string) => {
    setError(null);
    setSuccess(null);
    setSavingEdit(false);
    try {
      const res = await adminApi.get<Domain>(`/admin/domains/${id}`);
      const d = res.data;
      setEditingDomainId(d.id);
      setEditDomain(d.domain ?? "");
      setEditStatus(d.status ?? "pending");
      setEditSpfRecord(d.spf_record ?? "");
      setEditDkimSelector(d.dkim_selector ?? "");
      setEditDkimPublicKey(d.dkim_public_key ?? "");
      setEditDmarcRecord(d.dmarc_record ?? "");
      const dns = ((d.dns_records ?? {}) as Record<string, unknown>) || {};
      const dnsObj = dns as {
        spf?: { name?: string; value?: string };
        dkim?: { name?: string; value?: string };
        dmarc?: { name?: string; value?: string };
        provider_specific?: {
          txt_records?: Array<{ name?: string; value?: string }>;
          mx_records?: Array<{ name?: string; value?: string }>;
        };
      };

      const providerTxtRecords = dnsObj.provider_specific?.txt_records ?? [];
      const providerSpf = providerTxtRecords.find((r) =>
        (r.value ?? "").toLowerCase().includes("v=spf1"),
      );
      const providerDkim = providerTxtRecords.find((r) => {
        const value = (r.value ?? "").toLowerCase();
        const name = (r.name ?? "").toLowerCase();
        return (
          value.includes("v=dkim1") ||
          value.includes("k=rsa") ||
          (value.includes("p=") && name.includes("_domainkey"))
        );
      });
      const providerDmarc = providerTxtRecords.find((r) =>
        (r.value ?? "").toLowerCase().includes("v=dmarc1"),
      );

      setEditSpfName(dnsObj.spf?.name ?? providerSpf?.name ?? "");
      setEditSpfValue(dnsObj.spf?.value ?? providerSpf?.value ?? "");
      setEditDkimName(dnsObj.dkim?.name ?? providerDkim?.name ?? "");
      setEditDkimValue(dnsObj.dkim?.value ?? providerDkim?.value ?? "");
      setEditDmarcName(dnsObj.dmarc?.name ?? providerDmarc?.name ?? "");
      setEditDmarcValue(dnsObj.dmarc?.value ?? providerDmarc?.value ?? "");
      setEditMxName(dnsObj.provider_specific?.mx_records?.[0]?.name ?? "");
      setEditMxValue(
        dnsObj.provider_specific?.mx_records?.[0]?.value ?? "",
      );
      setEditDnsRecordsJson(JSON.stringify(dns, null, 2));
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load domain for edit");
    }
  };

  const closeEdit = () => {
    setEditingDomainId(null);
    setEditDomain("");
    setEditStatus("pending");
    setEditSpfRecord("");
    setEditDkimSelector("");
    setEditDkimPublicKey("");
    setEditDmarcRecord("");
    setEditSpfName("");
    setEditSpfValue("");
    setEditDkimName("");
    setEditDkimValue("");
    setEditDmarcName("");
    setEditDmarcValue("");
    setEditMxName("");
    setEditMxValue("");
    setEditDnsRecordsJson("{}");
    setSavingEdit(false);
  };

  const handleSaveEdit = async () => {
    if (!editingDomainId) return;
    setSavingEdit(true);
    setError(null);
    setSuccess(null);
    try {
      let parsedDnsRecords: Record<string, unknown> | null = null;
      const trimmedDns = editDnsRecordsJson.trim();
      if (trimmedDns.length > 0) {
        const parsed = JSON.parse(trimmedDns);
        if (parsed !== null && typeof parsed !== "object") {
          throw new Error("Saved DNS record must be a JSON object");
        }
        parsedDnsRecords = parsed as Record<string, unknown> | null;
      }

      const dnsObject = (parsedDnsRecords ?? {}) as {
        spf?: { name?: string; value?: string };
        dkim?: { name?: string; value?: string };
        dmarc?: { name?: string; value?: string };
        provider_specific?: { mx_records?: Array<{ name?: string; value?: string }> };
      };

      dnsObject.spf = dnsObject.spf ?? {};
      dnsObject.dkim = dnsObject.dkim ?? {};
      dnsObject.dmarc = dnsObject.dmarc ?? {};
      dnsObject.provider_specific = dnsObject.provider_specific ?? {};
      dnsObject.provider_specific.mx_records =
        dnsObject.provider_specific.mx_records ?? [{}];
      dnsObject.provider_specific.mx_records[0] =
        dnsObject.provider_specific.mx_records[0] ?? {};

      dnsObject.spf.name = editSpfName.trim();
      dnsObject.spf.value = editSpfValue.trim();
      dnsObject.dkim.name = editDkimName.trim();
      dnsObject.dkim.value = editDkimValue.trim();
      dnsObject.dmarc.name = editDmarcName.trim();
      dnsObject.dmarc.value = editDmarcValue.trim();
      dnsObject.provider_specific.mx_records[0].name = editMxName.trim();
      dnsObject.provider_specific.mx_records[0].value = editMxValue.trim();

      await adminApi.put(`/admin/domains/${editingDomainId}`, {
        domain: editDomain.trim(),
        status: editStatus.trim() || "pending",
        spf_record: editSpfRecord.trim() || null,
        dkim_selector: editDkimSelector.trim() || null,
        dkim_public_key: editDkimPublicKey.trim() || null,
        dmarc_record: editDmarcRecord.trim() || null,
        dns_records: dnsObject,
      });
      closeEdit();
      setSuccess("Domain updated successfully.");
      await fetchDomains();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to update domain");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        "Delete this domain? Ensure there are no dependent inboxes or campaigns.",
      )
    )
      return;
    try {
      await adminApi.delete(`/admin/domains/${id}`);
      setSuccess("Domain deleted successfully.");
      await fetchDomains();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete");
    }
  };

  const handleVerify = async (id: string) => {
    setVerifyingId(id);
    setError(null);
    setSuccess(null);
    try {
      await adminApi.post(`/admin/domains/${id}/verify`);
      setSuccess("Domain verification completed.");
      await fetchDomains();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to verify domain");
    } finally {
      setVerifyingId(null);
    }
  };

  const handleSync = async (id: string) => {
    setSyncingId(id);
    setError(null);
    setSuccess(null);
    try {
      const sendgridDomain = (syncDomainOverrides[id] || "").trim().toLowerCase();
      const res = await adminApi.post<{
        message?: string;
        no_changes?: boolean;
        matched_sendgrid_domain?: string;
      }>(`/admin/domains/${id}/sync-to-provider`, {
        ...(sendgridDomain ? { sendgrid_domain: sendgridDomain } : {}),
      });
      const msg = res.data?.message || "Domain synced to provider.";
      const matched = res.data?.matched_sendgrid_domain;
      setSuccess(matched ? `${msg} (using ${matched})` : msg);
      await fetchDomains();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to sync domain");
    } finally {
      setSyncingId(null);
    }
  };

  const getSyncLookupPreview = (baseDomain: string, overrideValue: string) => {
    const normalizedBase = (baseDomain || "").trim().toLowerCase().replace(/\.$/, "");
    const normalizedOverride = (overrideValue || "").trim().toLowerCase().replace(/\.$/, "");
    if (!normalizedOverride) return normalizedBase;
    if (normalizedOverride.includes(".")) return normalizedOverride;
    return `${normalizedOverride}.${normalizedBase}`;
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredDomains = domains.filter((d) => {
    if (!normalizedSearch) return true;
    const domain = (d.domain ?? "").toLowerCase();
    const userId = (d.user_id ?? "").toLowerCase();
    const status = (d.status ?? "").toLowerCase();
    return (
      domain.includes(normalizedSearch) ||
      userId.includes(normalizedSearch) ||
      status.includes(normalizedSearch)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Domains</h1>
        <button
          onClick={fetchDomains}
          className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-zinc-600">
        Admin view of all sending domains and their health scores.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by domain, user ID, or status"
          className="w-full rounded border px-3 py-1.5 text-xs sm:max-w-sm"
        />
        <p className="text-xs text-zinc-500">
          Showing {filteredDomains.length} of {domains.length}
        </p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-emerald-700">{success}</p>}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-zinc-50">
            <tr>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Domain
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                User ID
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Status
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Health
              </th>
              <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredDomains.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={5}
                  className="px-2 py-4 text-center text-xs text-zinc-500"
                >
                  {domains.length === 0
                    ? "No domains found."
                    : "No domains match your search."}
                </td>
              </tr>
            )}
            {filteredDomains.map((d) => (
              <tr key={d.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2">{d.domain}</td>
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {d.user_id ?? "—"}
                </td>
                <td className="border-b px-2 py-2">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-700">
                    {d.status ?? "unknown"}
                  </span>
                </td>
                <td className="border-b px-2 py-2 text-[11px]">
                  {typeof d.health_score === "number"
                    ? `${d.health_score}/100`
                    : "—"}
                </td>
                <td className="border-b px-2 py-2 text-right">
                  <div className="mb-1 text-left text-[10px] text-zinc-500">
                    Sync lookup:{" "}
                    <span className="font-mono text-[10px] text-zinc-700">
                      {getSyncLookupPreview(d.domain, syncDomainOverrides[d.id] ?? "")}
                    </span>
                  </div>
                  <input
                    value={syncDomainOverrides[d.id] ?? ""}
                    onChange={(e) =>
                      setSyncDomainOverrides((prev) => ({
                        ...prev,
                        [d.id]: e.target.value,
                      }))
                    }
                    placeholder="Optional: em4148 or em4148.example.com"
                    className="mr-2 w-52 rounded border px-2 py-1 text-[11px]"
                    title="Optional SendGrid lookup override. Single label (e.g. em4148) becomes em4148.<domain>."
                  />
                  <button
                    onClick={() => handleVerify(d.id)}
                    disabled={verifyingId === d.id}
                    className="mr-2 rounded bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {verifyingId === d.id ? "Verifying..." : "Verify"}
                  </button>
                  <button
                    onClick={() => handleSync(d.id)}
                    disabled={syncingId === d.id}
                    className="mr-2 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {syncingId === d.id ? "Syncing..." : "Sync"}
                  </button>
                  <button
                    onClick={() => openEdit(d.id)}
                    className="mr-2 rounded bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(d.id)}
                    className="rounded bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="text-xs text-zinc-500">Loading domains...</p>}

      {editingDomainId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded border bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">Edit Domain</h2>
              <button
                onClick={closeEdit}
                className="rounded border px-2 py-1 text-[11px] hover:bg-zinc-100"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3">
              <label className="text-xs text-zinc-700">
                Domain
                <input
                  value={editDomain}
                  onChange={(e) => setEditDomain(e.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1 text-xs"
                />
              </label>

              <label className="text-xs text-zinc-700">
                Status
                <input
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1 text-xs"
                />
              </label>

              <label className="text-xs text-zinc-700">
                SPF Record
                <textarea
                  value={editSpfRecord}
                  onChange={(e) => setEditSpfRecord(e.target.value)}
                  className="mt-1 min-h-[56px] w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>

              <label className="text-xs text-zinc-700">
                SPF Name
                <input
                  value={editSpfName}
                  onChange={(e) => setEditSpfName(e.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>
              <label className="text-xs text-zinc-700">
                SPF Value
                <textarea
                  value={editSpfValue}
                  onChange={(e) => setEditSpfValue(e.target.value)}
                  className="mt-1 min-h-[56px] w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>

              <label className="text-xs text-zinc-700">
                DKIM Selector
                <input
                  value={editDkimSelector}
                  onChange={(e) => setEditDkimSelector(e.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1 text-xs"
                />
              </label>

              <label className="text-xs text-zinc-700">
                DKIM Public Key
                <textarea
                  value={editDkimPublicKey}
                  onChange={(e) => setEditDkimPublicKey(e.target.value)}
                  className="mt-1 min-h-[80px] w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>

              <label className="text-xs text-zinc-700">
                DKIM Name
                <input
                  value={editDkimName}
                  onChange={(e) => setEditDkimName(e.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>
              <label className="text-xs text-zinc-700">
                DKIM Value
                <textarea
                  value={editDkimValue}
                  onChange={(e) => setEditDkimValue(e.target.value)}
                  className="mt-1 min-h-[80px] w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>

              <label className="text-xs text-zinc-700">
                DMARC Record
                <textarea
                  value={editDmarcRecord}
                  onChange={(e) => setEditDmarcRecord(e.target.value)}
                  className="mt-1 min-h-[56px] w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>

              <label className="text-xs text-zinc-700">
                DMARC Name
                <input
                  value={editDmarcName}
                  onChange={(e) => setEditDmarcName(e.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>
              <label className="text-xs text-zinc-700">
                DMARC Value
                <textarea
                  value={editDmarcValue}
                  onChange={(e) => setEditDmarcValue(e.target.value)}
                  className="mt-1 min-h-[56px] w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>

              <label className="text-xs text-zinc-700">
                MX Name
                <input
                  value={editMxName}
                  onChange={(e) => setEditMxName(e.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>
              <label className="text-xs text-zinc-700">
                MX Value
                <input
                  value={editMxValue}
                  onChange={(e) => setEditMxValue(e.target.value)}
                  className="mt-1 w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>

              <label className="text-xs text-zinc-700">
                Saved DNS Record (JSON)
                <textarea
                  value={editDnsRecordsJson}
                  onChange={(e) => setEditDnsRecordsJson(e.target.value)}
                  className="mt-1 min-h-[140px] w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeEdit}
                className="rounded border px-3 py-1 text-xs hover:bg-zinc-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingEdit ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

