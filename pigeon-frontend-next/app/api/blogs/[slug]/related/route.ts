import { NextRequest, NextResponse } from "next/server";
import { getRelatedBlogs } from "@/lib/blog-data";

export const revalidate = 86400; // 1 day cache

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    if (!slug) {
      return NextResponse.json({ blogs: [] });
    }
    const limit = Math.min(
      12,
      Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "3", 10) || 3)
    );
    const data = await getRelatedBlogs(slug, limit);
    return NextResponse.json(data);
  } catch (e) {
    console.error("[blogs related]", e);
    return NextResponse.json({ blogs: [] }, { status: 500 });
  }
}
