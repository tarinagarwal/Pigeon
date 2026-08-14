"use client";

import { useState, useEffect } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Save } from "lucide-react";

type Plan = { id: string; name: string; price: string };

type User = {
  id: string;
  email: string;
  name?: string;
   first_name?: string;
   last_name?: string;
   company?: string;
  status: string;
  plan_id?: string;
  extra_max_domains?: number;
  extra_max_subdomains?: number;
  extra_max_google_accounts?: number;
  extra_max_campaigns?: number;
  extra_max_monthly_smtp_emails?: number;
  subscription_start?: string;
  subscription_end?: string;
  subscription_status?: string;
  trial_ends_at?: string;
  trial_used_at?: string;
  razorpay_subscription_id?: string;
  lemon_squeezy_subscription_id?: string;
  created_at: string;
  last_login?: string;
  campaign_count?: number;
  contact_count?: number;
  use_app_google_oauth?: boolean;
  email_infra?: {
    enabled?: boolean;
  };
};

export function EditUserDialog({ 
  user, 
  onSave, 
  error, 
  setError 
}: { 
  user: User;
  onSave: (userData: Partial<User>) => void; 
  error: string | null; 
  setError: (error: string | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [formData, setFormData] = useState<Partial<User>>({
    email: user.email,
    name: user.name || '',
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    company: user.company || '',
    status: user.status,
    plan_id: user.plan_id ?? 'free',
    extra_max_domains: user.extra_max_domains ?? 0,
    extra_max_subdomains: user.extra_max_subdomains ?? 0,
    extra_max_google_accounts: user.extra_max_google_accounts ?? 0,
    extra_max_campaigns: user.extra_max_campaigns ?? 0,
    extra_max_monthly_smtp_emails: user.extra_max_monthly_smtp_emails ?? 0,
    subscription_start: user.subscription_start ?? '',
    subscription_end: user.subscription_end ?? '',
    razorpay_subscription_id: user.razorpay_subscription_id ?? '',
    lemon_squeezy_subscription_id: user.lemon_squeezy_subscription_id ?? '',
    use_app_google_oauth: user.use_app_google_oauth ?? false,
    email_infra: { enabled: user.email_infra?.enabled ?? false },
  });

  useEffect(() => {
    if (user) {
      setFormData({
        email: user.email,
        name: user.name || '',
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        company: user.company || '',
        status: user.status,
        plan_id: user.plan_id ?? 'free',
        extra_max_domains: user.extra_max_domains ?? 0,
        extra_max_subdomains: user.extra_max_subdomains ?? 0,
        extra_max_google_accounts: user.extra_max_google_accounts ?? 0,
        extra_max_campaigns: user.extra_max_campaigns ?? 0,
        extra_max_monthly_smtp_emails: user.extra_max_monthly_smtp_emails ?? 0,
        subscription_start: user.subscription_start ?? '',
        subscription_end: user.subscription_end ?? '',
        razorpay_subscription_id: user.razorpay_subscription_id ?? '',
        lemon_squeezy_subscription_id: user.lemon_squeezy_subscription_id ?? '',
        use_app_google_oauth: user.use_app_google_oauth ?? false,
        email_infra: { enabled: user.email_infra?.enabled ?? false },
      });
    }
  }, [user]);

  useEffect(() => {
    if (isOpen && plans.length === 0) {
      adminApi.get<{ plans: Plan[] }>("/admin/plans").then((res) => {
        setPlans(res.data.plans ?? []);
      }).catch(() => setPlans([]));
    }
  }, [isOpen, plans.length]);

  const [fullUser, setFullUser] = useState<User | null>(null);
  useEffect(() => {
    if (isOpen && user.id) {
      adminApi.get<User>(`/admin/users/${user.id}`).then((res) => {
        const full = res.data;
        setFullUser(full);
        setFormData((prev) => ({
          ...prev,
          first_name: full.first_name || prev.first_name || '',
          last_name: full.last_name || prev.last_name || '',
          company: full.company || prev.company || '',
          razorpay_subscription_id: full.razorpay_subscription_id ?? prev.razorpay_subscription_id ?? '',
          lemon_squeezy_subscription_id: full.lemon_squeezy_subscription_id ?? prev.lemon_squeezy_subscription_id ?? '',
          use_app_google_oauth: full.use_app_google_oauth ?? false,
          email_infra: { enabled: full.email_infra?.enabled ?? false },
        }));
      }).catch(() => setFullUser(null));
    } else {
      setFullUser(null);
    }
  }, [isOpen, user.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        ...formData,
        subscription_start: formData.subscription_start || null,
        subscription_end: formData.subscription_end || null,
        razorpay_subscription_id: (formData.razorpay_subscription_id || "").trim() || null,
        lemon_squeezy_subscription_id: (formData.lemon_squeezy_subscription_id || "").trim() || null,
        use_app_google_oauth: formData.use_app_google_oauth ?? false,
        email_infra: { enabled: formData.email_infra?.enabled ?? false },
      };
      await adminApi.put(`/admin/users/${user.id}`, payload);
      onSave(formData);
      setIsOpen(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to update user");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Edit className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>
        <div className="max-h-[80vh] overflow-y-auto pr-1">
          {error && (
            <div className="text-sm text-red-600 p-3 bg-red-50 rounded-md" role="alert">
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={formData.email || ''}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name || ''}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first_name">First name</Label>
                <Input
                  id="first_name"
                  value={formData.first_name || ''}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Last name</Label>
                <Input
                  id="last_name"
                  value={formData.last_name || ''}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                value={formData.company || ''}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select 
                value={formData.status || 'active'}
                onValueChange={(value) => setFormData({...formData, status: value})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="banned">Banned</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan_id">Plan</Label>
              <Select 
                value={formData.plan_id || 'free'}
                onValueChange={(value) => setFormData({...formData, plan_id: value})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} {plan.price !== "Custom" && plan.price !== "0" && `($${plan.price}/mo)`}
                      {plan.price === "0" && "(Free)"}
                      {plan.price === "Custom" && "(Custom)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formData.plan_id && formData.plan_id !== 'free' && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
                <Label className="text-sm font-medium text-gray-700">
                  Additional limits for this user
                </Label>
                <p className="text-xs text-gray-500">
                  These bonus limits are added on top of the selected plan and only apply while the user is on a non-free plan.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="extra_max_domains">Extra domains</Label>
                    <Input
                      id="extra_max_domains"
                      type="number"
                      min={0}
                      value={formData.extra_max_domains ?? 0}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          extra_max_domains: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="extra_max_subdomains">Extra subdomains / SMTP inboxes</Label>
                    <Input
                      id="extra_max_subdomains"
                      type="number"
                      min={0}
                      value={formData.extra_max_subdomains ?? 0}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          extra_max_subdomains: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="extra_max_google_accounts">Extra Google accounts</Label>
                    <Input
                      id="extra_max_google_accounts"
                      type="number"
                      min={0}
                      value={formData.extra_max_google_accounts ?? 0}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          extra_max_google_accounts: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="extra_max_campaigns">Extra campaigns</Label>
                    <Input
                      id="extra_max_campaigns"
                      type="number"
                      min={0}
                      value={formData.extra_max_campaigns ?? 0}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          extra_max_campaigns: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="extra_max_monthly_smtp_emails">Extra monthly SMTP emails</Label>
                    <Input
                      id="extra_max_monthly_smtp_emails"
                      type="number"
                      min={0}
                      value={formData.extra_max_monthly_smtp_emails ?? 0}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          extra_max_monthly_smtp_emails: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )}
            {(fullUser && (fullUser.subscription_status || fullUser.trial_ends_at != null || fullUser.trial_used_at != null || fullUser.razorpay_subscription_id || fullUser.lemon_squeezy_subscription_id)) && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <Label className="text-sm font-medium text-gray-700">Billing (read-only)</Label>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  {fullUser.subscription_status != null && (
                    <div><span className="text-gray-500">Sub status:</span> <span className="font-medium">{fullUser.subscription_status}</span></div>
                  )}
                  {fullUser.trial_ends_at && (
                    <div><span className="text-gray-500">Trial ends:</span> <span className="font-medium">{new Date(fullUser.trial_ends_at).toLocaleString()}</span></div>
                  )}
                  {fullUser.trial_used_at && (
                    <div><span className="text-gray-500">Trial used:</span> <span className="font-medium">{new Date(fullUser.trial_used_at).toLocaleString()}</span></div>
                  )}
                  {fullUser.razorpay_subscription_id && (
                    <div className="break-all"><span className="text-gray-500">Razorpay sub ID:</span> <span className="font-mono text-xs">{fullUser.razorpay_subscription_id}</span></div>
                  )}
                  {fullUser.lemon_squeezy_subscription_id && (
                    <div className="break-all"><span className="text-gray-500">Lemon sub ID:</span> <span className="font-mono text-xs">{fullUser.lemon_squeezy_subscription_id}</span></div>
                  )}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="razorpay_subscription_id">Razorpay subscription ID</Label>
                <Input
                  id="razorpay_subscription_id"
                  value={formData.razorpay_subscription_id || ""}
                  placeholder="sub_xxxxx"
                  onChange={(e) =>
                    setFormData({ ...formData, razorpay_subscription_id: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lemon_squeezy_subscription_id">Lemon Squeezy subscription ID</Label>
                <Input
                  id="lemon_squeezy_subscription_id"
                  value={formData.lemon_squeezy_subscription_id || ""}
                  placeholder="123456"
                  onChange={(e) =>
                    setFormData({ ...formData, lemon_squeezy_subscription_id: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">Use app default Google OAuth</Label>
                <p className="text-xs text-muted-foreground">When on, this user can connect Gmail without entering their own Client ID/Secret (uses app .env).</p>
              </div>
              <input
                type="checkbox"
                id="use_app_google_oauth"
                checked={formData.use_app_google_oauth ?? false}
                onChange={(e) => setFormData({ ...formData, use_app_google_oauth: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">Email Infra</Label>
                <p className="text-xs text-muted-foreground">Enable Pigeon Email Infrastructure for domains. When enabled, domains use SendGrid plus Email Infra APIs.</p>
              </div>
              <input
                type="checkbox"
                id="email_infra_enabled"
                checked={formData.email_infra?.enabled ?? false}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    email_infra: { enabled: e.target.checked },
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="subscription_start">Subscribed from</Label>
                <Input
                  id="subscription_start"
                  type="date"
                  value={formData.subscription_start || ''}
                  onChange={(e) => setFormData({...formData, subscription_start: e.target.value || undefined})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subscription_end">Subscribed to</Label>
                <Input
                  id="subscription_end"
                  type="date"
                  value={formData.subscription_end || ''}
                  onChange={(e) => setFormData({...formData, subscription_end: e.target.value || undefined})}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button type="submit">
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </Button>
          </div>
        </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}