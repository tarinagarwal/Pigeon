import { NextRequest, NextResponse } from "next/server";
import { getBlogBySlug } from "@/lib/blog-data";

export const revalidate = 86400; // 1 day cache

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    if (!slug) {
      return NextResponse.json({ detail: "Not found" }, { status: 404 });
    }
    const blog = await getBlogBySlug(slug);
    if (!blog) {
      return NextResponse.json({ detail: "Blog not found" }, { status: 404 });
    }
    return NextResponse.json(blog);
  } catch (e) {
    console.error("[blogs slug]", e);
    return NextResponse.json({ detail: "Error" }, { status: 500 });
  }
}
