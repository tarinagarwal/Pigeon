import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SmartLeadsClient } from "./SmartLeadsClient";

export const metadata: Metadata = {
  title: "Smart Leads | Pigeon",
  description:
    "Describe who you want to reach, search the web for companies and people, and get AI-suggested work emails.",
};

export default function SmartLeadsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Smart Leads</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Add a Google search key and an AI provider in Settings, then describe your ideal customer. We search the
            web, find companies and contacts, suggest work emails, and run MX plus SMTP checks—with optional test sends
            from a connected Gmail when the server is hard to read. Live progress and history show each stage.
          </p>
        </div>
        <Button variant="outline" asChild className="shrink-0">
          <Link href="/contacts">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Contacts
          </Link>
        </Button>
      </div>
      <SmartLeadsClient />
    </div>
  );
}
