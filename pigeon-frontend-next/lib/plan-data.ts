/**
 * Server-only plan data from MongoDB. Used for pricing SSR.
 * Requires MONGO_URL (or MONGODB_URI) and DB_NAME on Vercel (same DB as backend plans).
 */

import { getAdminDb } from "@/lib/mongodb";

/** BSON-safe plain object for Server → Client props. */
function toPlainDoc(doc: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

/** Active plans sorted by order (same as GET /api/plans). */
export async function listActivePlans(): Promise<Record<string, unknown>[]> {
  try {
    const adminDb = getAdminDb();
    const plans = await adminDb
      .collection("plans")
      .find({ active: true }, { projection: { _id: 0 } })
      .sort({ order: 1 })
      .toArray();
    return plans.map((p) => toPlainDoc(p as Record<string, unknown>));
  } catch (e) {
    console.error("[plan-data] listActivePlans", e);
    return [];
  }
}

/**
 * Fetch a single plan by id. Respects single_plan_page_disabled.
 * Use in Server Components only (e.g. pricing [planId] page).
 * Plan id is matched exactly (case-sensitive); no leading/trailing whitespace.
 */
export async function getPlanById(
  planId: string
): Promise<Record<string, unknown> | null> {
  const id = typeof planId === "string" ? planId.trim() : "";
  if (!id) return null;
  try {
    const adminDb = getAdminDb();
    const plan = await adminDb
      .collection("plans")
      .findOne({ id }, { projection: { _id: 0 } });
    if (!plan || (plan as { single_plan_page_disabled?: boolean }).single_plan_page_disabled === true) {
      return null;
    }
    return toPlainDoc(plan as Record<string, unknown>);
  } catch (e) {
    console.error("[plan-data] getPlanById", id, e);
    return null;
  }
}
