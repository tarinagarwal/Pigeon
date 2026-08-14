"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search,
  ShoppingBag,
  Coins,
  BarChart2,
  Tag,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useRYN, rynFetch, type RYNListing } from "@/contexts/RYNContext";
import RYNShell from "../RYNShell";
import { toast } from "sonner";

const NICHES = ["All", "SaaS", "E-commerce", "Agencies", "Marketing", "Startups", "Other"];

export default function RYNMarketplacePage() {
  const { user, isLoading, refreshUser } = useRYN();
  const [listings, setListings] = useState<RYNListing[]>([]);
  const [total, setTotal] = useState(0);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");
  const [niche, setNiche] = useState("All");
  const [confirmListing, setConfirmListing] = useState<RYNListing | null>(null);
  const [renting, setRenting] = useState(false);

  const loadListings = useCallback(async () => {
    setFetching(true);
    try {
      const params = new URLSearchParams();
      if (niche !== "All") params.set("niche", niche);
      const data = await rynFetch(`/ryn/marketplace?${params}`);
      setListings(data.listings ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast.error("Failed to load marketplace");
    } finally {
      setFetching(false);
    }
  }, [niche]);

  useEffect(() => {
    if (user) loadListings();
  }, [user, loadListings]);

  const q = search.toLowerCase();
  const filtered = search
    ? listings.filter(
        (l) =>
          l.email.toLowerCase().includes(q) ||
          l.note?.toLowerCase().includes(q) ||
          l.display_name?.toLowerCase().includes(q) ||
          l.niche?.toLowerCase().includes(q) ||
          l.description?.toLowerCase().includes(q)
      )
    : listings;

  async function handleRent() {
    if (!confirmListing) return;
    setRenting(true);
    try {
      const data = await rynFetch("/ryn/marketplace/rent", {
        method: "POST",
        body: JSON.stringify({ listing_id: confirmListing.id }),
      });
      toast.success(data.message ?? "Email rented!");
      setConfirmListing(null);
      await refreshUser();
      await loadListings();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Rental failed");
    } finally {
      setRenting(false);
    }
  }

  if (isLoading) {
    return (
      <RYNShell>
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          Loading…
        </div>
      </RYNShell>
    );
  }

  return (
    <RYNShell>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold">Marketplace</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Browse and rent email accounts. Spend credits to access them.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search email, niche…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {NICHES.map((n) => (
              <button
                key={n}
                onClick={() => setNiche(n)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
                  niche === n
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:border-primary hover:text-primary"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Results count */}
        <p className="text-xs text-muted-foreground">
          {fetching ? "Loading…" : `${filtered.length} listing${filtered.length !== 1 ? "s" : ""} available`}
        </p>

        {/* Grid */}
        {!fetching && filtered.length === 0 ? (
          <div className="rounded-xl border bg-muted/30 p-12 text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
              <ShoppingBag className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No listings found</p>
            <p className="text-sm text-muted-foreground">
              Try adjusting your search or niche filter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((listing) => {
              const isOwn = listing.owner_id === user?.id;
              return (
                <div
                  key={listing.id}
                  className="rounded-xl border bg-card p-4 space-y-3 flex flex-col"
                >
                  {/* Email */}
                  <div>
                    <p className="font-medium text-sm truncate">{listing.email}</p>
                    {(listing.display_name || listing.note) && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {listing.display_name ?? listing.note}
                      </p>
                    )}
                  </div>

                  {/* Niche */}
                  {listing.niche && (
                    <Badge variant="secondary" className="w-fit text-xs">
                      <Tag className="w-3 h-3 mr-1" />
                      {listing.niche}
                    </Badge>
                  )}

                  {/* Description */}
                  {listing.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {listing.description}
                    </p>
                  )}

                  {/* Stats */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <BarChart2 className="w-3 h-3" />
                      {listing.times_rented} rented
                    </span>
                  </div>

                  <div className="mt-auto pt-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
                      <Coins className="w-3.5 h-3.5" />
                      {listing.credits_per_use} credits
                    </span>
                    <Button
                      size="sm"
                      disabled={isOwn}
                      title={isOwn ? "Your own listing" : `Rent for ${listing.credits_per_use} credits`}
                      onClick={() => setConfirmListing(listing)}
                    >
                      {isOwn ? (
                        <>
                          <Check className="w-3.5 h-3.5 mr-1" />
                          Yours
                        </>
                      ) : (
                        "Rent"
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rent confirm dialog */}
      <Dialog open={!!confirmListing} onOpenChange={(o) => !o && setConfirmListing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm rental</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              You are about to rent:
            </p>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
              <p className="font-medium">{confirmListing?.email}</p>
              {(confirmListing?.display_name || confirmListing?.note) && (
                <p className="text-xs text-muted-foreground">
                  {confirmListing?.display_name ?? confirmListing?.note}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Cost</span>
              <span className="font-semibold flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Coins className="w-3.5 h-3.5" />
                {confirmListing?.credits_per_use} credits
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Your balance</span>
              <span className="font-semibold flex items-center gap-1">
                <Coins className="w-3.5 h-3.5 text-muted-foreground" />
                {user?.credits_balance ?? 0} credits
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmListing(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleRent}
              disabled={renting || (user?.credits_balance ?? 0) < (confirmListing?.credits_per_use ?? 0)}
            >
              {renting ? "Renting…" : "Confirm & rent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RYNShell>
  );
}
