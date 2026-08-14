import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/mongodb";

export const revalidate = 86400; // 1 day cache

/**
 * Return a single plan by id. No auth required.
 * Used for direct plan links (/pricing/:planId) so users can subscribe to a specific plan,
 * including plans that are not shown on the main pricing page (active: false).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { planId } = await params;
    if (!planId) {
      return NextResponse.json({ plan: null }, { status: 400 });
    }
    const adminDb = getAdminDb();
    const plan = await adminDb
      .collection("plans")
      .findOne({ id: planId }, { projection: { _id: 0 } });
    if (!plan) {
      return NextResponse.json({ plan: null }, { status: 404 });
    }
    if (plan.single_plan_page_disabled === true) {
      return NextResponse.json({ plan: null }, { status: 404 });
    }
    return NextResponse.json({ plan });
  } catch (e) {
    console.error("[plans/[planId]]", e);
    return NextResponse.json({ plan: null }, { status: 500 });
  }
}
