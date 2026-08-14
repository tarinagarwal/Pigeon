import { NextRequest, NextResponse } from "next/server";
import { listBlogs } from "@/lib/blog-data";

// This route depends on query-string params (`nextUrl.searchParams`),
// so force dynamic rendering to avoid static prerender warnings.
export const dynamic = "force-dynamic";
export const revalidate = 86400; // 1 day cache

export async function GET(request: NextRequest) {
  try {
    // Use NextRequest's URL helper so Next doesn't treat `request.url` as dynamic usage.
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10) || 10));
    const tag = searchParams.get("tag")?.trim() ?? null;
    const data = await listBlogs(page, limit, tag);
    return NextResponse.json(data);
  } catch (e) {
    console.error("[blogs list]", e);
    return NextResponse.json(
      { blogs: [], total: 0, page: 1, limit: 10 },
      { status: 500 }
    );
  }
}
