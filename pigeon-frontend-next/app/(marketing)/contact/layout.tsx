import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact | Pigeon – Cold Email That Lands in the Inbox",
  description: "Get in touch — support, partnerships, or questions about Pigeon. We reply within 1–2 business days.",
  keywords: "contact Pigeon, support, cold email",
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
