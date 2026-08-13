"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics-events";
import { api, setWorkspaceContext, type AvailableWorkspace } from "@/lib/api";

export interface SubUserPermissions {
  dashboard: boolean;
  inbox: boolean;
  campaigns: boolean;
  contacts: boolean;
  templates: boolean;
  workflows: boolean;
  analytics: boolean;
  tracking: boolean;
  domains: boolean;
  inboxes: boolean;
  warmup: boolean;
  settings: boolean;
}

export interface User {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  two_fa_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
  plan_id?: string;
  country_code?: string | null;
  is_india?: boolean | null;
  razorpay_subscription_id?: string | null;
  subscription_status?: string;
  /** Set when a subscription charge failed (webhook); cleared on successful payment. */
  billing_payment_failed_at?: string | null;
  subscription_start?: string | null;
  subscription_end?: string | null;
  trial_ends_at?: string | null;
  trial_used_at?: string | null;
  credits_balance?: number;
  credits_total_purchased?: number;
  credits_total_earned?: number;
  credits_total_spent?: number;
  warmup_shared_pool_enabled?: boolean;
  _is_sub_user?: boolean;
  _sub_user_permissions?: SubUserPermissions;
  _workspace_owner_id?: string;
  plan?: {
    id: string;
    name: string;
    price: string;
    description?: string;
    max_domains?: number;
    max_subdomains?: number;
    max_google_accounts?: number;
    max_campaigns?: number;
    max_monthly_smtp_emails?: number;
    warmup?: boolean;
    support?: string;
  } | null;
  usage?: {
    domains: number;
    subdomains: number;
    campaigns: number;
    inboxes: number;
    smtp_inboxes?: number;
    gmail_inboxes?: number;
    emails_today: number;
    smtp_emails_month?: number;
    gmail_emails_month?: number;
  };
  limits?: {
    max_domains: number;
    max_subdomains: number;
    max_google_accounts: number;
    max_campaigns: number;
    max_monthly_smtp_emails: number;
    warmup: boolean;
  };
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (
    email: string,
    password: string,
    rememberMe?: boolean,
    redirectTo?: string
  ) => Promise<{ requires2FA?: boolean; twoFaToken?: string; requiresEmailVerification?: boolean; email?: string } | void>;
  verify2FA: (twoFaToken: string, code: string, redirectTo?: string) => Promise<void>;
  resend2FA: (twoFaToken: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string, company?: string) => Promise<{ verificationRequired?: boolean; email?: string }>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  logout: () => void;
  refetchUser: () => Promise<void>;
  clearDemoUser: () => void;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Workspaces this user has been added to as a sub-user */
  availableWorkspaces: AvailableWorkspace[];
  /** Currently active workspace (null = own workspace) */
  activeWorkspace: AvailableWorkspace | null;
  /** Switch into another workspace or back to own (null) */
  switchWorkspace: (ownerId: string | null) => void;
  /**
   * The user ID to use for all data-fetching API calls.
   * When a workspace is active this is the owner's ID so that
   * backend ownership checks (user_id == current_user.id) pass.
   * Otherwise it is the logged-in user's own ID.
   */
  effectiveUserId: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
const USER_KEY = 'auth_user';
const DEMO_STORAGE_KEY = 'demo_mode';
const DEFAULT_AUTH_REDIRECT = '/dashboard';

export const DEMO_TOUR_COMPLETE_EVENT = 'demo-tour-complete';

function isDemoMode() {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') {
      window.sessionStorage.setItem(DEMO_STORAGE_KEY, '1');
      return true;
    }
    if (window.sessionStorage.getItem(DEMO_STORAGE_KEY) === '1') return true;
    if (window.localStorage.getItem(DEMO_STORAGE_KEY) === '1') {
      window.sessionStorage.setItem(DEMO_STORAGE_KEY, '1');
      return true;
    }
    const stored = window.sessionStorage.getItem(USER_KEY) || window.localStorage.getItem(USER_KEY);
    if (stored) {
      try {
        const user = JSON.parse(stored) as { id?: string };
        if (user?.id === 'demo-user') {
          window.sessionStorage.setItem(DEMO_STORAGE_KEY, '1');
          return true;
        }
      } catch {
        /* ignore */
      }
    }
    return false;
  } catch {
    return false;
  }
}

function getAuthMeUrl() {
  if (isDemoMode()) return '/api/demo/me';
  return `${API_BASE_URL}/auth/me`;
}

function getSafeRedirect(redirect?: string | null): string {
  if (!redirect || typeof redirect !== 'string') return DEFAULT_AUTH_REDIRECT;
  const path = redirect.trim();
  if (path.startsWith('/') && !path.startsWith('//')) return path;
  return DEFAULT_AUTH_REDIRECT;
}

const ACTIVE_WORKSPACE_KEY_PREFIX = 'active_workspace_';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<AvailableWorkspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<AvailableWorkspace | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const storageRef = useRef<Storage>(typeof window !== 'undefined' ? localStorage : (null as unknown as Storage));

  const clearDemoUser = useCallback(() => {
    if (typeof window !== 'undefined') {
      fetch('/api/demo/logout', { method: 'POST' }).catch(() => {});
      window.sessionStorage.removeItem(DEMO_STORAGE_KEY);
      window.localStorage.removeItem(USER_KEY);
      window.sessionStorage.removeItem(USER_KEY);
    }
    setUser(null);
  }, []);

  // When demo tour completes (Done clicked), clear demo user
  useEffect(() => {
    const handleDemoTourComplete = () => clearDemoUser();
    window.addEventListener(DEMO_TOUR_COMPLETE_EVENT, handleDemoTourComplete);
    return () => window.removeEventListener(DEMO_TOUR_COMPLETE_EVENT, handleDemoTourComplete);
  }, [clearDemoUser]);

  // When interactive demo is not on, or demo mode is missing from storage, logout demo user (demo user is identified via auth/me: id === "demo-user")
  useEffect(() => {
    if (typeof window === 'undefined' || !user) return;
    const isDemoUser = user.id === 'demo-user';
    if (!isDemoUser) return;
    const hasDemoInStorage =
      window.sessionStorage.getItem(DEMO_STORAGE_KEY) === '1' ||
      window.localStorage.getItem(DEMO_STORAGE_KEY) === '1';
    if (!hasDemoInStorage) {
      clearDemoUser();
      return;
    }
    const inIframe = window.self !== window.top;
    const onAuthPage =
      pathname === '/signup' ||
      pathname === '/login' ||
      pathname?.startsWith('/verify-email');

    // Treat both the marketing landing page and the dashboard in demo mode
    // as valid "interactive demo" locations so the demo user is not cleared
    // when someone opens the full-page demo at /dashboard?startTour=1&demo=1.
    const demoQueryOn =
      new URLSearchParams(window.location.search).get('demo') === '1';
    const interactiveDemoOn =
      !onAuthPage &&
      (pathname === '/' ||
        pathname === '/dashboard' ||
        (inIframe && (demoQueryOn || hasDemoInStorage)));
    if (!interactiveDemoOn) {
      clearDemoUser();
    }
  }, [user, pathname, clearDemoUser]);

  // Restore session from HTTP-only cookie: call /auth/me with credentials
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const storage = localStorage.getItem(USER_KEY) ? localStorage : sessionStorage;
    storageRef.current = storage;
    const storedUser = storage.getItem(USER_KEY);
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setUser(parsed);
        if (parsed?.id === 'demo-user') {
          window.sessionStorage.setItem(DEMO_STORAGE_KEY, '1');
        }
      } catch {
        storage.removeItem(USER_KEY);
      }
    }

    const doFetch = (retryCount = 0) => {
      let gotUser = false;
      fetch(getAuthMeUrl(), { credentials: 'include' })
        .then((res) => {
          if (cancelled) return;
          if (res.ok) return res.json();
          setUser(null);
          localStorage.removeItem(USER_KEY);
          sessionStorage.removeItem(USER_KEY);
          return null;
        })
        .then(async (userData) => {
          if (cancelled || !userData) return;
          gotUser = true;
          setUser(userData);
          storageRef.current.setItem(USER_KEY, JSON.stringify(userData));
          if (userData.id === 'demo-user') {
            window.sessionStorage.setItem(DEMO_STORAGE_KEY, '1');
          }
          // Load workspaces this user has been added to as a sub-user
          if (userData.id && userData.id !== 'demo-user') {
            try {
              const wsData = await api.workspace.getAvailableWorkspaces();
              if (!cancelled) {
                setAvailableWorkspaces(wsData.workspaces ?? []);
                // Restore previously selected workspace from localStorage
                const savedOwnerId = localStorage.getItem(
                  `${ACTIVE_WORKSPACE_KEY_PREFIX}${userData.id}`
                );
                if (savedOwnerId) {
                  const saved = wsData.workspaces?.find((w) => w.owner_id === savedOwnerId);
                  if (saved) {
                    setActiveWorkspace(saved);
                    setWorkspaceContext(saved.owner_id);
                  } else {
                    // Saved workspace no longer accessible — clear it
                    localStorage.removeItem(`${ACTIVE_WORKSPACE_KEY_PREFIX}${userData.id}`);
                  }
                }
              }
            } catch {
              // Non-fatal — workspace list is best-effort
            }
          }
        })
        .catch(() => {
          if (!cancelled) {
            setUser(null);
            localStorage.removeItem(USER_KEY);
            sessionStorage.removeItem(USER_KEY);
          }
        })
        .finally(() => {
          if (cancelled) return;
          // When demo=1 and no user, retry once to allow server to load/set demo session
          const isDemo = new URLSearchParams(window.location.search).get('demo') === '1';
          if (isDemo && !gotUser && retryCount < 1) {
            setTimeout(() => doFetch(retryCount + 1), 500);
            return;
          }
          setIsLoading(false);
        });
    };

    doFetch();
    return () => { cancelled = true; };
  }, []);

  const fetchUserInfo = async () => {
    try {
      const response = await fetch(getAuthMeUrl(), { credentials: 'include' });
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        if (typeof storageRef.current?.setItem === 'function') {
          storageRef.current.setItem(USER_KEY, JSON.stringify(userData));
        }
        if (userData?.id === 'demo-user') {
          if (typeof window !== 'undefined') window.sessionStorage.setItem(DEMO_STORAGE_KEY, '1');
        }
        // Load available workspaces for this user
        if (userData?.id && userData.id !== 'demo-user') {
          try {
            const wsData = await api.workspace.getAvailableWorkspaces();
            setAvailableWorkspaces(wsData.workspaces ?? []);
            // Restore previously active workspace from localStorage
            const savedOwnerId = typeof localStorage !== 'undefined'
              ? localStorage.getItem(`${ACTIVE_WORKSPACE_KEY_PREFIX}${userData.id}`)
              : null;
            if (savedOwnerId) {
              const saved = wsData.workspaces?.find((w) => w.owner_id === savedOwnerId);
              if (saved) {
                setActiveWorkspace(saved);
                setWorkspaceContext(saved.owner_id);
              }
            }
          } catch {
            // Non-fatal: workspace list can fail gracefully
          }
        }
      } else {
        setUser(null);
        setAvailableWorkspaces([]);
        setActiveWorkspace(null);
        setWorkspaceContext(null);
        if (typeof localStorage !== 'undefined') localStorage.removeItem(USER_KEY);
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(USER_KEY);
      }
    } catch (error) {
      console.error('Failed to fetch user info:', error);
      setUser(null);
      if (typeof localStorage !== 'undefined') localStorage.removeItem(USER_KEY);
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(USER_KEY);
    }
  };

  const switchWorkspace = useCallback((ownerId: string | null) => {
    if (typeof window === 'undefined' || !user?.id) return;

    if (!ownerId) {
      // Switch back to own workspace — clear saved context then hard reload
      localStorage.removeItem(`${ACTIVE_WORKSPACE_KEY_PREFIX}${user.id}`);
    } else {
      const workspace = availableWorkspaces.find((w) => w.owner_id === ownerId);
      if (!workspace) return;
      // Persist selection to localStorage — the session-restore useEffect picks it
      // up on the next load and calls setWorkspaceContext() before any query fires.
      localStorage.setItem(`${ACTIVE_WORKSPACE_KEY_PREFIX}${user.id}`, ownerId);
    }

    // Hard reload to /dashboard: clears all in-flight queries and module state,
    // avoiding the router.replace + queryClient.invalidateQueries() race that
    // causes the /login ↔ /dashboard redirect loop.
    window.location.href = '/dashboard';
  }, [availableWorkspaces, user?.id]);

  const login = async (
    email: string,
    password: string,
    rememberMe: boolean = false,
    redirectTo?: string
  ): Promise<{ requires2FA?: boolean; twoFaToken?: string; requiresEmailVerification?: boolean; email?: string } | void> => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, remember_me: rememberMe }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Login failed');
    }

    const data = await response.json();
    if (data.requires_2fa && data.two_fa_token) {
      return { requires2FA: true, twoFaToken: data.two_fa_token };
    }
    if (data.requires_email_verification && data.email) {
      return { requiresEmailVerification: true, email: data.email };
    }
    // Successful login should exit demo mode if it was enabled
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(DEMO_STORAGE_KEY);
    }
    setUser(data.user);
    const storage = rememberMe ? localStorage : sessionStorage;
    storageRef.current = storage;
    storage.setItem(USER_KEY, JSON.stringify(data.user));
    if (rememberMe) {
      sessionStorage.removeItem(USER_KEY);
    } else {
      localStorage.removeItem(USER_KEY);
    }
    // Fetch full user (plan, usage, limits) from /auth/me so dashboard shows without refresh
    await fetchUserInfo();
    trackEvent("auth_login_completed", { userId: data.user?.id ?? null });
    router.replace(getSafeRedirect(redirectTo));
  };

  const verify2FA = async (twoFaToken: string, code: string, redirectTo?: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/verify-2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ two_fa_token: twoFaToken, code }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Invalid code');
    }

    const data = await response.json();
    setUser(data.user);
    const rememberMe = data.remember_me === true;
    const storage = rememberMe ? localStorage : sessionStorage;
    storageRef.current = storage;
    storage.setItem(USER_KEY, JSON.stringify(data.user));
    if (rememberMe) sessionStorage.removeItem(USER_KEY);
    else localStorage.removeItem(USER_KEY);
    // Fetch full user (plan, usage, limits) from /auth/me so dashboard shows without refresh
    await fetchUserInfo();
    trackEvent("auth_login_completed", { userId: data.user?.id ?? null, method: "2fa" });
    router.replace(getSafeRedirect(redirectTo));
  };

  const resend2FA = async (twoFaToken: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/resend-2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ two_fa_token: twoFaToken }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Failed to resend code');
    }
  };

  const register = async (email: string, password: string, fullName?: string, company?: string): Promise<{ verificationRequired?: boolean; email?: string }> => {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        ...(fullName?.trim() && { full_name: fullName.trim() }),
        ...(company?.trim() && { company: company.trim() }),
      }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Registration failed');
    }

    const data = await response.json();
    if (data.verification_required && data.email) {
      router.replace('/verify-email?email=' + encodeURIComponent(data.email));
      return { verificationRequired: true, email: data.email };
    }
    setUser(data.user);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    trackEvent("auth_signup_completed", { userId: data.user?.id ?? null });
    router.replace('/get-started?onboarding=1');
    return {};
  };

  const verifyEmail = async (email: string, code: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Verification failed');
    }

    const data = await response.json();
    setUser(data.user);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    trackEvent("auth_signup_completed", { userId: data.user?.id ?? null, method: "email_verification" });
    router.replace('/get-started?onboarding=1');
  };

  const resendVerification = async (email: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Failed to resend code');
    }
  };

  const logout = () => {
    fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    setUser(null);
    setAvailableWorkspaces([]);
    setActiveWorkspace(null);
    setWorkspaceContext(null);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(USER_KEY);
    router.replace('/login');
  };

  const refetchUser = async () => {
    await fetchUserInfo();
  };

  const effectiveUserId = activeWorkspace?.owner_id ?? user?.id ?? "";

  const value: AuthContextType = {
    user,
    token: null,
    login,
    verify2FA,
    resend2FA,
    register,
    verifyEmail,
    resendVerification,
    logout,
    refetchUser,
    clearDemoUser,
    isLoading,
    isAuthenticated: !!user,
    availableWorkspaces,
    activeWorkspace,
    switchWorkspace,
    effectiveUserId,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
