"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { OutreachTemplateCard } from "./OutreachTemplateCard";
import { OutreachListPicker } from "./OutreachListPicker";
import { OutreachInboxPicker } from "./OutreachInboxPicker";
import { Button } from "@/components/ui/button";
import type { ContactList, Domain, EmailTemplate, Inbox } from "@/types/api";

export type MessageRole = "user" | "assistant";

export interface OutreachMessage {
  id: string;
  role: MessageRole;
  content: string;
  templateCard?: EmailTemplate;
  templateCards?: EmailTemplate[];
  listCard?: {
    lists: ContactList[];
  };
  inboxCard?: {
    inboxes: Inbox[];
  };
  campaignCreated?: { campaignId: string; campaignName: string; started?: boolean };
  /** When true, show Preview and either Proceed to Inbox or Edit Campaign (see previewCampaignId). */
  previewOrInboxChoice?: boolean;
  /** When set with previewOrInboxChoice, primary action is Edit Campaign (e.g. campaign already exists). */
  previewCampaignId?: string;
  /** When true, show a single "Create campaign" button with this message (e.g. after inbox picked). */
  showCreateCampaignButton?: boolean;
  /** Background generation job id for live progress stream. */
  generationJobId?: string;
  /** When true, show format selection buttons (HTML, Plain Text, Rich Text). */
  formatCard?: boolean;
}

interface OutreachChatMessageProps {
  message: OutreachMessage;
  selectedListId?: string | null;
  selectedInboxIds?: string[];
  onSelectList?: (listId: string) => void;
  onSelectInbox?: (inboxIds: string[]) => void;
  onConfirmInboxSelection?: (inboxIds: string[]) => void;
  startedCampaignIds?: string[];
  onDeleteTemplate?: (templateId: string) => void;
  deletingTemplateId?: string | null;
  domains?: Domain[];
  onEditTemplate?: (template: EmailTemplate) => void;
  /** When previewOrInboxChoice is set, open preview for the given template (or first). */
  onPreviewTemplate?: (template: EmailTemplate) => void;
  /** When previewOrInboxChoice is set and no campaign yet, add a message with inbox picker. */
  onProceedToInbox?: () => void;
  /** Current chat campaign id (if any); used with previewOrInboxChoice to show Edit Campaign. */
  createdCampaignId?: string | null;
  /** When showCreateCampaignButton is set, called when user clicks Create campaign. */
  onCreateCampaign?: () => void;
  /** When formatCard is set, called when user selects a format. */
  onSelectFormat?: (format: "html" | "plain" | "rich") => void;
  /** Template ID currently tagged for update (show "Selected for update" on that card). */
  taggedForUpdateTemplateId?: string | null;
  onTagForUpdate?: (templateId: string) => void;
}

export function OutreachChatMessage({
  message,
  selectedListId: liveSelectedListId,
  selectedInboxIds = [],
  onSelectList,
  onSelectInbox,
  onConfirmInboxSelection,
  startedCampaignIds = [],
  onDeleteTemplate,
  deletingTemplateId,
  domains = [],
  onEditTemplate,
  onPreviewTemplate,
  onProceedToInbox,
  createdCampaignId,
  onCreateCampaign,
  onSelectFormat,
  taggedForUpdateTemplateId,
  onTagForUpdate,
}: OutreachChatMessageProps) {
  const isUser = message.role === "user";
  const campaignIdForPreviewActions =
    message.previewCampaignId ?? createdCampaignId ?? undefined;

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-card text-foreground border border-border/60 rounded-bl-md"
        )}
      >
        {message.content && (
          <div
            className={cn(
              "prose prose-sm max-w-none whitespace-pre-wrap break-words [&_p]:my-0.5 [&_ul]:my-1 [&_ol]:my-1",
              isUser
                ? "text-primary-foreground prose-p:text-primary-foreground prose-li:text-primary-foreground prose-headings:text-primary-foreground prose-strong:text-primary-foreground prose-invert [&_a]:text-primary-foreground [&_a]:underline"
                : "text-foreground dark:prose-invert prose-p:text-foreground prose-li:text-foreground prose-headings:text-foreground prose-strong:text-foreground [&_a]:text-primary [&_a]:underline hover:[&_a]:text-primary dark:[&_a]:text-primary dark:hover:[&_a]:text-primary"
            )}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...props }) =>
                  href?.startsWith("/") ? (
                    <Link href={href} {...props}>
                      {children}
                    </Link>
                  ) : (
                    <a href={href ?? "#"} target="_blank" rel="noopener noreferrer" {...props}>
                      {children}
                    </a>
                  ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {(message.templateCards?.length ? message.templateCards : message.templateCard ? [message.templateCard] : []).map((template) => (
          <div key={template.id} className="mt-3">
            <OutreachTemplateCard
              template={template}
              onEdit={onEditTemplate ? () => onEditTemplate(template) : undefined}
              onPreview={onPreviewTemplate ? () => onPreviewTemplate(template) : undefined}
              taggedForUpdate={taggedForUpdateTemplateId === template.id}
              onTagForUpdate={onTagForUpdate ? () => onTagForUpdate(template.id) : undefined}
            />
          </div>
        ))}
        {message.previewOrInboxChoice && (message.templateCards?.length ? message.templateCards : message.templateCard ? [message.templateCard] : []).length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onPreviewTemplate && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs rounded-lg"
                onClick={() => onPreviewTemplate((message.templateCards?.[0] ?? message.templateCard)!)}
              >
                Preview
              </Button>
            )}
            {campaignIdForPreviewActions ? (
              <Button size="sm" variant="secondary" className="h-8 text-xs rounded-lg gap-1.5" asChild>
                <Link href={`/campaigns/${campaignIdForPreviewActions}/edit`}>
                  <ExternalLink className="h-3 w-3" />
                  Edit Campaign
                </Link>
              </Button>
            ) : (
              onProceedToInbox && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs rounded-lg"
                  onClick={onProceedToInbox}
                >
                  Proceed to Inbox select
                </Button>
              )
            )}
          </div>
        )}
        {message.listCard && onSelectList && (
          <div className="mt-3">
            <OutreachListPicker
              lists={message.listCard.lists}
              selectedListId={liveSelectedListId ?? null}
              onSelect={onSelectList}
            />
          </div>
        )}
        {message.inboxCard && onSelectInbox && (
          <div className="mt-3">
            <OutreachInboxPicker
              inboxes={message.inboxCard.inboxes}
              domains={domains}
              selectedInboxIds={selectedInboxIds}
              onSelect={onSelectInbox}
              onConfirmSelection={onConfirmInboxSelection}
            />
          </div>
        )}
        {message.formatCard && onSelectFormat && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                { value: "rich", label: "Rich Text", description: "WYSIWYG editor" },
                { value: "html", label: "HTML", description: "Raw HTML with inline CSS" },
                { value: "plain", label: "Plain Text", description: "No formatting" },
              ] as const
            ).map(({ value, label, description }) => (
              <button
                key={value}
                onClick={() => onSelectFormat(value)}
                className="flex flex-col items-start gap-0.5 rounded-xl border border-border/60 bg-background px-3 py-2 text-left text-xs transition-colors hover:border-primary hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="font-medium text-foreground">{label}</span>
                <span className="text-muted-foreground">{description}</span>
              </button>
            ))}
          </div>
        )}
        {message.showCreateCampaignButton && onCreateCampaign && (
          <div className="mt-3">
            <Button
              size="sm"
              variant="default"
              className="h-8 text-xs rounded-lg"
              onClick={onCreateCampaign}
            >
              Create campaign
            </Button>
          </div>
        )}
        {message.campaignCreated && (
          <div className="mt-3 rounded-xl border border-border/60 bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Campaign: <span className="text-foreground">{message.campaignCreated.campaignName}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs rounded-lg gap-1.5 border-border/60"
                asChild
              >
                <Link href={`/campaigns/${message.campaignCreated.campaignId}/edit`} className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open to edit
                </Link>
              </Button>
              {(message.campaignCreated.started || startedCampaignIds.includes(message.campaignCreated.campaignId)) && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 text-primary px-2.5 py-1.5 text-xs font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Started
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
