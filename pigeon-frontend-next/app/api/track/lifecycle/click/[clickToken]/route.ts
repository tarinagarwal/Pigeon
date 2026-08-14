import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clickToken: string }> }
) {
  const base = getBackendBaseUrl();
  if (!base) {
    return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL || "https://www.pigeon.com"), 302);
  }
  const { clickToken } = await params;
  if (!clickToken) {
    return NextResponse.json({ detail: "Missing token" }, { status: 400 });
  }
  const url = `${base}/api/track/lifecycle/click/${encodeURIComponent(clickToken)}`;
  const res = await fetch(url, { redirect: "manual", cache: "no-store" });
  const loc = res.headers.get("Location");
  if (res.status >= 300 && res.status < 400 && loc) {
    return NextResponse.redirect(loc, res.status === 307 ? 307 : 302);
  }
  if (!res.ok && !loc) {
    return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL || "https://www.pigeon.com"), 302);
  }
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "text/plain" },
  });
}
