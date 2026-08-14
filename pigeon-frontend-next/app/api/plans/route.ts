import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/mongodb";

export const revalidate = 86400; // 1 day cache

/**
 * Return active plans sorted by order. No authentication required.
 * Replaces backend GET /plans (MongoDB admin_db.plans).
 */
export async function GET() {
  try {
    const adminDb = getAdminDb();
    const cursor = adminDb
      .collection("plans")
      .find({ active: true }, { projection: { _id: 0 } })
      .sort({ order: 1 });

    const plans = await cursor.toArray();
    return NextResponse.json({ plans });
  } catch (e) {
    console.error("[plans]", e);
    return NextResponse.json({ plans: [] }, { status: 500 });
  }
}
