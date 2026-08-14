import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SLACK_API = "https://slack.com/api/chat.postMessage";

function notifySlack(
  name: string,
  email: string,
  subject: string,
  message: string,
  company?: string | null,
  phone?: string | null
): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  const channel =
    process.env.SLACK_CHANNEL_CONTACT?.trim() || "pigeon-contact";
  if (!token) return Promise.resolve(false);
  const lines = [
    "*New contact form submission*",
    `*Name:* ${name}`,
    `*Email:* ${email}`,
    `*Subject:* ${subject}`,
    `*Message:* ${message}`,
  ];
  if (company) lines.push(`*Company:* ${company}`);
  if (phone) lines.push(`*Phone:* ${phone}`);
  return fetch(SLACK_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text: lines.join("\n") }),
  })
    .then((r) => r.json().then((d) => r.ok && d?.ok === true))
    .catch(() => false);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { message: "Name, email, subject, and message are required." },
        { status: 400 }
      );
    }

    const company =
      typeof body?.company === "string" ? body.company.trim() || undefined : undefined;
    const phone =
      typeof body?.phone === "string" ? body.phone.trim() || undefined : undefined;

    const id = crypto.randomUUID();
    const created_at = new Date();
    const doc = {
      id,
      name,
      email,
      subject,
      message,
      ...(company != null && { company }),
      ...(phone != null && { phone }),
      created_at,
    };

    const db = getDb();
    await db.collection("contact_submissions").insertOne(doc);

    notifySlack(name, email, subject, message, company, phone).catch(() => {});

    return NextResponse.json({
      message: "Thank you for your message. We'll get back to you soon.",
      id,
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[contact] POST error:", err.message, err.stack);
    return NextResponse.json(
      { message: "Failed to submit. Please try again." },
      { status: 500 }
    );
  }
}
