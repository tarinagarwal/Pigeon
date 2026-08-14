import { NextResponse } from "next/server";
import { getBlogsVersion } from "@/lib/blog-data";

export const revalidate = 86400; // 1 day cache

export async function GET() {
  try {
    const data = await getBlogsVersion();
    return NextResponse.json(data);
  } catch (e) {
    console.error("[blogs/version]", e);
    return NextResponse.json({ version: "0" }, { status: 500 });
  }
}
