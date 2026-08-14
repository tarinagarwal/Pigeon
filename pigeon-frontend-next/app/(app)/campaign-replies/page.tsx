"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Shield, Mail, EyeOff, Settings, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpLinks } from "@/components/HelpLinks";

export default function CampaignRepliesPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-8"
        >
          <div>
            <Link
              href="/settings?tab=integrations"
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Link>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Shield className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  How we read campaign-related replies
                </h1>
                <p className="text-muted-foreground mt-1">
                  Transparency and control over your Gmail connection
                </p>
              </div>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5 text-primary" />
                What we read
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-muted-foreground">
              <p>
                We only access{" "}
                <strong className="text-foreground">
                  replies to emails that were sent through Pigeon
                </strong>{" "}
                as part of your campaigns. When a contact replies to a campaign
                email you sent, we match that reply using standard email headers
                (In-Reply-To and References) that link the reply to the message
                we sent on your behalf.
              </p>
              <p>
                This lets us show you in the Inbox when someone has responded, so
                you can reply from one place and keep your outreach conversations
                organized.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <EyeOff className="h-5 w-5 text-primary" />
                What we don&apos;t read
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-muted-foreground">
              <p>
                We do <strong className="text-foreground">not</strong> read your
                personal inbox, banking emails, work correspondence, or any
                threads that are unrelated to emails sent via Pigeon. We only
                look at threads where we previously sent a campaign message so we
                can detect when a contact has replied to that specific thread.
              </p>
              <p>
                Your personal emails and all other mail remain private and are
                never scanned, stored, or used by our system.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mail className="h-5 w-5 text-primary" />
                How it works (in plain terms)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-muted-foreground">
              <ol className="list-decimal list-inside space-y-3 pl-1">
                <li>
                  <strong className="text-foreground">
                    When you connect Gmail
                  </strong>
                  , we use the permissions you grant to send emails and to check
                  for new messages only in threads where Pigeon sent an email.
                </li>
                <li>
                  <strong className="text-foreground">
                    When we send a campaign email
                  </strong>
                  , we store the message ID of that sent email. Later, when we
                  check your inbox, we look only for replies that reference that
                  message ID (via In-Reply-To or References). That&apos;s how we
                  know a reply belongs to a campaign thread.
                </li>
                <li>
                  <strong className="text-foreground">
                    When we find a match
                  </strong>
                  , we update the campaign and contact status (e.g. &quot;Replied&quot;)
                  and show the reply in your Pigeon Inbox. The reply content is
                  used only to display it to you and to mark the thread as
                  replied—we don&apos;t use it for advertising or other purposes.
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings className="h-5 w-5 text-primary" />
                Your control
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-muted-foreground">
              <p>
                You can{" "}
                <strong className="text-foreground">
                  disconnect Gmail at any time
                </strong>{" "}
                from Settings → Integrations. Disconnecting revokes our access to
                your account immediately. We stop sending and checking for
                replies for that account. Any data we had stored for that
                connection (e.g. which threads were campaign threads) can be
                removed on request.
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-4 pt-4">
            <Button asChild>
              <Link href="/inbox/campaign-replies">Go to Inbox</Link>
            </Button>
          </div>

          <HelpLinks
            slugs={["view-manage-campaign-replies-inbox", "use-inbox-see-when-contacts-respond", "set-up-reply-to-imap-campaign-replies", "set-up-notification-preferences-replies"]}
            className="mt-8"
          />
        </motion.div>
      </div>
    </div>
  );
}
