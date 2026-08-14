"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  RefreshCw,
  Trash2,
  Search,
  Filter,
  AlertTriangle,
} from "lucide-react";

type Campaign = {
  id: string;
  name?: string;
  user_id?: string;
  user_email?: string;
  status?: string;
  created_at?: string;
  sent?: number;
  opened?: number;
  clicked?: number;
  replied?: number;
  open_rate?: number;
  click_rate?: number;
  reply_rate?: number;
  deliverability_spam_last_24h?: boolean;
  deliverability_spam_roots_last_24h?: string[];
  deliverability_spam_root_provider_labels_last_24h?: string[];
  deliverability_last_spam_root?: string | null;
  deliverability_last_classification?: string | null;
  deliverability_last_checked_at?: string | null;
  deliverability_last_root_label?: string | null;
  deliverability_tested_providers_last_24h?: string[];
  deliverability_last_receiver_provider?: string | null;
};

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [testingCampaignIds, setTestingCampaignIds] = useState<Record<string, boolean>>({});

  const fetchCampaigns = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ campaigns: Campaign[] }>(
        "/admin/campaigns",
        { params: { limit: 50 } },
      );
      setCampaigns(res.data.campaigns ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const runDeliverabilityTest = async (campaignId: string) => {
    setTestingCampaignIds((prev) => ({ ...prev, [campaignId]: true }));
    setError(null);
    try {
      await adminApi.post(`/admin/campaigns/${campaignId}/deliverability-test`);
      await fetchCampaigns();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to run deliverability test");
    } finally {
      setTestingCampaignIds((prev) => ({ ...prev, [campaignId]: false }));
    }
  };

  const getStatusVariant = (
    status: string | undefined,
  ): "green" | "yellow" | "blue" | "red" | "gray" => {
    if (!status) return "gray";
    const s = status.toLowerCase();
    if (s === "active" || s === "running") return "green";
    if (s === "paused" || s === "draft") return "yellow";
    if (s === "completed") return "blue";
    if (s === "failed" || s === "error") return "red";
    return "gray";
  };

  const filteredCampaigns = campaigns.filter(campaign =>
    campaign.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.user_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.user_email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Mail className="mr-3 h-8 w-8 text-primary" />
            Campaigns
          </h1>
          <p className="text-gray-600 mt-2">
            Manage all email campaigns across all tenants
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchCampaigns} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button>
            <Mail className="mr-2 h-4 w-4" />
            New Campaign
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center text-red-800">
              <Trash2 className="h-5 w-5 mr-2" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Campaign Management</CardTitle>
              <CardDescription>
                View and manage all campaigns. Administrative actions bypass normal user restrictions.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <input
                  type="text"
                  placeholder="Search campaigns..."
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary focus:border-primary"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Button variant="outline">
                <Filter className="mr-2 h-4 w-4" />
                Filter
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Campaign Name</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">User Email</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Sent</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Opened</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Clicked</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Replied</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Open %</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Deliverability</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCampaigns.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-gray-500">
                      <Mail className="mx-auto h-12 w-12 text-gray-300 mb-2" />
                      <p>No campaigns found</p>
                      <p className="text-sm mt-1">Try adjusting your search or filter criteria</p>
                    </td>
                  </tr>
                )}
                {filteredCampaigns.map((campaign) => (
                  <tr key={campaign.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900">
                        {campaign.name || "Untitled Campaign"}
                      </div>
                      <code className="text-xs text-gray-500 font-mono mt-0.5 block">ID: {campaign.id}</code>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-gray-700">
                        {campaign.user_email ?? "—"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={getStatusVariant(campaign.status)}>
                        {campaign.status?.toUpperCase() || "UNKNOWN"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right text-sm tabular-nums">
                      {campaign.sent ?? 0}
                    </td>
                    <td className="py-3 px-4 text-right text-sm tabular-nums">
                      {campaign.opened ?? 0}
                    </td>
                    <td className="py-3 px-4 text-right text-sm tabular-nums">
                      {campaign.clicked ?? 0}
                    </td>
                    <td className="py-3 px-4 text-right text-sm tabular-nums">
                      {campaign.replied ?? 0}
                    </td>
                    <td className="py-3 px-4 text-right text-sm tabular-nums text-gray-600">
                      {campaign.open_rate != null ? `${campaign.open_rate}%` : "—"}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {campaign.deliverability_spam_last_24h ? (
                        <div className="space-y-1">
                          <div className="inline-flex items-center text-red-700 font-medium">
                            <AlertTriangle className="h-4 w-4 mr-1" />
                            Spam detected
                          </div>
                          <div className="text-red-700">
                            {(campaign.deliverability_spam_root_provider_labels_last_24h ??
                              campaign.deliverability_spam_roots_last_24h ??
                              []).join(", ")}
                          </div>
                          <div className="text-xs text-gray-600">
                            Tested providers (24h): {(campaign.deliverability_tested_providers_last_24h ?? []).join(", ") || "—"}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!testingCampaignIds[campaign.id]}
                            onClick={() => runDeliverabilityTest(campaign.id)}
                          >
                            {testingCampaignIds[campaign.id] ? "Testing..." : "Run test"}
                          </Button>
                        </div>
                      ) : campaign.deliverability_last_classification ? (
                        <div className="space-y-1">
                          <div className="text-gray-700">
                            {campaign.deliverability_last_classification.toUpperCase()}
                            {campaign.deliverability_last_root_label ? ` - ${campaign.deliverability_last_root_label}` : ""}
                            {campaign.deliverability_last_receiver_provider ? ` (${campaign.deliverability_last_receiver_provider})` : ""}
                          </div>
                          <div className="text-xs text-gray-500">
                            {campaign.deliverability_last_checked_at
                              ? `Checked ${new Date(campaign.deliverability_last_checked_at).toLocaleString()}`
                              : "Checked recently"}
                          </div>
                          <div className="text-xs text-gray-600">
                            Tested providers (24h): {(campaign.deliverability_tested_providers_last_24h ?? []).join(", ") || "—"}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!testingCampaignIds[campaign.id]}
                            onClick={() => runDeliverabilityTest(campaign.id)}
                          >
                            {testingCampaignIds[campaign.id] ? "Testing..." : "Run test"}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="text-gray-500">No checks yet</span>
                          <div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!!testingCampaignIds[campaign.id]}
                              onClick={() => runDeliverabilityTest(campaign.id)}
                            >
                              {testingCampaignIds[campaign.id] ? "Testing..." : "Run test"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-gray-600 text-sm">
                      {campaign.created_at
                        ? new Date(campaign.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="animate-spin h-6 w-6 text-primary mr-2" />
              <span className="text-gray-600">Loading campaigns...</span>
            </div>
          )}
          
          {!loading && filteredCampaigns.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 text-sm text-gray-600">
              Showing {filteredCampaigns.length} of {campaigns.length} campaigns
              {searchTerm && " (filtered)"}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

