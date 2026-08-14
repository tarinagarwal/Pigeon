import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for triggering Next.js cache revalidation on the frontend app.
 * The REVALIDATE_SECRET is read here (server-side only) so it never reaches the browser.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, "");

  if (!secret) {
    console.error("[admin/revalidate] REVALIDATE_SECRET env var is not set");
    return NextResponse.json({ error: "Server misconfiguration: missing REVALIDATE_SECRET" }, { status: 500 });
  }

  let body: { tags?: string[]; paths?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine – will use defaults on the frontend side
  }

  try {
    const res = await fetch(`${frontendUrl}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, ...body }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? "Revalidation failed" }, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/revalidate] Failed to reach frontend:", message);
    return NextResponse.json(
      { error: `Could not reach frontend at ${frontendUrl}: ${message}` },
      { status: 502 }
    );
  }
}
