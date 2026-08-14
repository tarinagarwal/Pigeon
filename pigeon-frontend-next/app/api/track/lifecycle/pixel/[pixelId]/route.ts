import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pixelId: string }> }
) {
  const base = getBackendBaseUrl();
  if (!base) {
    return new NextResponse(null, { status: 204 });
  }
  const { pixelId } = await params;
  if (!pixelId) {
    return NextResponse.json({ detail: "Missing id" }, { status: 400 });
  }
  const url = `${base}/api/track/lifecycle/pixel/${encodeURIComponent(pixelId)}`;
  const res = await fetch(url, { cache: "no-store" });
  const buf = await res.arrayBuffer();
  const ct = res.headers.get("Content-Type") || "image/png";
  return new NextResponse(buf, {
    status: res.status,
    headers: { "Content-Type": ct, "Cache-Control": "no-store" },
  });
}
