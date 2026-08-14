import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function missingBackendResponse() {
  return NextResponse.json(
    {
      detail:
        "Server configuration error: set NEXT_PUBLIC_API_URL or BACKEND_PROXY_URL so unsubscribe can reach the API.",
    },
    { status: 503 }
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const base = getBackendBaseUrl();
  if (!base) return missingBackendResponse();
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ detail: "Missing token" }, { status: 400 });
  }
  const url = `${base}/api/lifecycle/unsubscribe/${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.text();
  const ct = res.headers.get("Content-Type") || "text/html; charset=utf-8";
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": ct },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const base = getBackendBaseUrl();
  if (!base) return missingBackendResponse();
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ detail: "Missing token" }, { status: 400 });
  }
  const url = `${base}/api/lifecycle/unsubscribe/${encodeURIComponent(token)}`;
  const contentType = request.headers.get("content-type") || "";
  const body = await request.text();
  const res = await fetch(url, {
    method: "POST",
    headers: contentType ? { "Content-Type": contentType } : {},
    body,
    cache: "no-store",
  });
  const text = await res.text();
  const ct = res.headers.get("Content-Type") || "application/json; charset=utf-8";
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": ct },
  });
}
