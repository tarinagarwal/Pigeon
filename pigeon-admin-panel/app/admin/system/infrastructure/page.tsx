"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type AsgInfo = {
  name: string;
  arn?: string;
  min_size: number;
  max_size: number;
  desired_capacity: number;
  current_capacity: number;
  availability_zones?: string[];
  status?: string;
  created_time?: string;
};

type InstanceInfo = {
  instance_id: string;
  lifecycle_state?: string;
  health_status?: string;
  ec2_state?: string;
  launch_time?: string;
  private_ip?: string;
  running_jobs?: number | null;
};

type RefreshInfo = {
  id: string;
  status: string;
  status_reason?: string;
  start_time?: string;
  end_time?: string;
  percentage_complete?: number;
};

type LifecycleHookInfo = {
  name: string;
  lifecycle_transition?: string;
  heartbeat_timeout?: number;
  default_result?: string;
};

type InfrastructureData = {
  asg: AsgInfo | null;
  instances: InstanceInfo[];
  instance_refreshes: RefreshInfo[];
  lifecycle_hooks: LifecycleHookInfo[];
  total_running_jobs?: number | null;
  error: string | null;
};

function formatDate(iso?: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function statusBadge(status: string) {
  const lower = status?.toLowerCase() ?? "";
  const green = ["inservice", "successful", "running", "healthy"];
  const yellow = ["pending", "inprogress", "provisioning", "warming"];
  const red = ["failed", "cancelled", "terminating", "unhealthy"];
  let bg = "bg-zinc-100 text-zinc-700";
  if (green.some((s) => lower.includes(s))) bg = "bg-green-100 text-green-800";
  else if (yellow.some((s) => lower.includes(s))) bg = "bg-amber-100 text-amber-800";
  else if (red.some((s) => lower.includes(s))) bg = "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${bg}`}>
      {status ?? "—"}
    </span>
  );
}

type CompleteLifecycleResponse = {
  completed: string[];
  error: string | null;
};

export default function AdminInfrastructurePage() {
  const [data, setData] = useState<InfrastructureData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completeLifecycleLoading, setCompleteLifecycleLoading] = useState(false);
  const [completeLifecycleResult, setCompleteLifecycleResult] = useState<CompleteLifecycleResponse | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<InfrastructureData>("/admin/system/infrastructure");
      setData(res.data);
      if (res.data.error) setError(res.data.error);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load infrastructure");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const completeLifecycle = async () => {
    setCompleteLifecycleLoading(true);
    setCompleteLifecycleResult(null);
    try {
      const res = await adminApi.post<CompleteLifecycleResponse>("/admin/system/infrastructure/complete-lifecycle");
      setCompleteLifecycleResult(res.data);
      if (res.data.completed?.length) await load();
    } catch (err: unknown) {
      setCompleteLifecycleResult({ completed: [], error: getErrorMessage(err) || "Request failed" });
    } finally {
      setCompleteLifecycleLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Infrastructure</h1>
        <button
          onClick={load}
          disabled={loading}
          className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p className="text-xs text-zinc-600">
        AWS Auto Scaling Group, instances, instance refresh, and lifecycle hooks for the backend.
      </p>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {data && !data.error && data.asg && (
        <>
          {/* ASG summary */}
          <div className="rounded border bg-white p-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-800">Auto Scaling Group</h2>
            <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <span className="text-zinc-500">Name</span>
                <p className="font-mono font-medium text-zinc-900">{data.asg.name}</p>
              </div>
              <div>
                <span className="text-zinc-500">Capacity</span>
                <p className="font-medium text-zinc-900">
                  {data.asg.current_capacity} / {data.asg.desired_capacity} desired (min {data.asg.min_size}, max {data.asg.max_size})
                </p>
              </div>
              <div>
                <span className="text-zinc-500">Status</span>
                <p>{data.asg.status ? statusBadge(data.asg.status) : "—"}</p>
              </div>
              <div>
                <span className="text-zinc-500">AZs</span>
                <p className="text-zinc-700">
                  {data.asg.availability_zones?.length
                    ? data.asg.availability_zones.join(", ")
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Complete termination (Terminating:Wait) — same as infrastructure/script.sh */}
          <div className="rounded border bg-white p-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-800">Lifecycle: Terminating:Wait</h2>
            <p className="mb-3 text-xs text-zinc-600">
              Complete lifecycle action for all instances stuck in <span className="font-medium">Terminating:Wait</span> (same as running <code className="rounded bg-zinc-100 px-1">infrastructure/script.sh</code>).
            </p>
            <button
              type="button"
              onClick={completeLifecycle}
              disabled={completeLifecycleLoading}
              className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {completeLifecycleLoading ? "Running…" : "Complete termination (Terminating:Wait)"}
            </button>
            {completeLifecycleResult && (
              <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
                {completeLifecycleResult.error ? (
                  <p className="text-red-700">{completeLifecycleResult.error}</p>
                ) : completeLifecycleResult.completed?.length ? (
                  <p className="text-zinc-700">
                    Completed lifecycle for: {completeLifecycleResult.completed.join(", ")}
                  </p>
                ) : (
                  <p className="text-zinc-600">No instances in Terminating:Wait.</p>
                )}
              </div>
            )}
          </div>

          {/* Instances */}
          <div className="rounded border bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-800">Instances</h2>
              {data.total_running_jobs != null && (
                <span className="text-xs text-zinc-600">
                  Running jobs: <span className="font-medium text-zinc-900">{data.total_running_jobs}</span>
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Instance ID
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Running jobs
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Lifecycle
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Health
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      EC2 State
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Private IP
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Launch Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.instances.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-2 py-4 text-center text-zinc-500">
                        No instances in this ASG.
                      </td>
                    </tr>
                  ) : (
                    data.instances.map((inst) => (
                      <tr key={inst.instance_id} className="hover:bg-zinc-50">
                        <td className="border-b px-2 py-2 font-mono text-[11px]">
                          {inst.instance_id}
                        </td>
                        <td className="border-b px-2 py-2">
                          {inst.running_jobs != null ? (
                            <span className="font-medium text-zinc-900">{inst.running_jobs}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="border-b px-2 py-2">
                          {inst.lifecycle_state ? statusBadge(inst.lifecycle_state) : "—"}
                        </td>
                        <td className="border-b px-2 py-2">
                          {inst.health_status ? statusBadge(inst.health_status) : "—"}
                        </td>
                        <td className="border-b px-2 py-2">
                          {inst.ec2_state ? statusBadge(inst.ec2_state) : "—"}
                        </td>
                        <td className="border-b px-2 py-2 font-mono text-[11px]">
                          {inst.private_ip ?? "—"}
                        </td>
                        <td className="border-b px-2 py-2 text-[11px] text-zinc-600">
                          {formatDate(inst.launch_time)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Instance refreshes */}
          <div className="rounded border bg-white p-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-800">Instance Refreshes</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Refresh ID
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Status
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      %
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Start
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      End
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.instance_refreshes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-2 py-4 text-center text-zinc-500">
                        No instance refreshes yet.
                      </td>
                    </tr>
                  ) : (
                    data.instance_refreshes.map((r) => (
                      <tr key={r.id} className="hover:bg-zinc-50">
                        <td className="border-b px-2 py-2 font-mono text-[11px]">{r.id}</td>
                        <td className="border-b px-2 py-2">{statusBadge(r.status)}</td>
                        <td className="border-b px-2 py-2 text-zinc-600">
                          {r.percentage_complete != null ? `${r.percentage_complete}%` : "—"}
                        </td>
                        <td className="border-b px-2 py-2 text-[11px] text-zinc-600">
                          {formatDate(r.start_time)}
                        </td>
                        <td className="border-b px-2 py-2 text-[11px] text-zinc-600">
                          {formatDate(r.end_time)}
                        </td>
                        <td className="border-b px-2 py-2 text-[11px] text-zinc-500">
                          {r.status_reason ?? "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Lifecycle hooks */}
          <div className="rounded border bg-white p-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-800">Lifecycle Hooks</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Name
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Transition
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Heartbeat timeout
                    </th>
                    <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                      Default result
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.lifecycle_hooks.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-4 text-center text-zinc-500">
                        No lifecycle hooks.
                      </td>
                    </tr>
                  ) : (
                    data.lifecycle_hooks.map((h) => (
                      <tr key={h.name} className="hover:bg-zinc-50">
                        <td className="border-b px-2 py-2 font-mono text-[11px]">{h.name}</td>
                        <td className="border-b px-2 py-2 text-zinc-700">
                          {h.lifecycle_transition ?? "—"}
                        </td>
                        <td className="border-b px-2 py-2 text-zinc-600">
                          {h.heartbeat_timeout != null ? `${h.heartbeat_timeout}s` : "—"}
                        </td>
                        <td className="border-b px-2 py-2 text-zinc-600">
                          {h.default_result ?? "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {loading && !data && (
        <p className="text-xs text-zinc-500">Loading infrastructure…</p>
      )}
    </div>
  );
}
