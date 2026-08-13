import type { CampaignFormData, ReplyToFormState, ValidationTier } from "./types";

export type CampaignValidationContext = {
  smtpSelectedRootDomains: string[];
  reply: ReplyToFormState;
  /** For ready tier: user must have at least one Gmail inbox when senderType is gmail */
  gmailInboxCount: number;
};

/**
 * draft — only a name is required (for autosave / save draft on edit).
 * ready — full checks before launch or “save changes” when treating as complete.
 */
export function validateCampaignForm(
  data: CampaignFormData,
  tier: ValidationTier,
  ctx: CampaignValidationContext
): { ok: true } | { ok: false; message: string } {
  if (tier === "draft") {
    if (!data.name.trim()) {
      return { ok: false, message: "Please enter a campaign name to save a draft." };
    }
    if (ctx.reply.replyToType === "custom" && !ctx.reply.replyToEmail?.trim()) {
      return { ok: false, message: "Please enter a Reply-To email or change Reply-To away from Custom email." };
    }
    return { ok: true };
  }

  if (!data.name.trim()) {
    return { ok: false, message: "Please enter a campaign name" };
  }
  if (!data.contactList) {
    return { ok: false, message: "Please select a contact list" };
  }
  const allHaveTemplate = data.emails.every(
    (e) => e.templateIds.length > 0 && e.templateIds.every((tid) => tid?.trim())
  );
  if (data.emails.length === 0 || !allHaveTemplate) {
    return { ok: false, message: "Please add at least one step and select a template for each variant in each step" };
  }
  if (data.senderType === "gmail") {
    if (ctx.gmailInboxCount === 0) {
      return { ok: false, message: "Please connect Gmail in Settings first" };
    }
    if (data.senderIds.length === 0) {
      return { ok: false, message: "Please select at least one Gmail account" };
    }
  }
  if (data.senderType === "smtp") {
    if (ctx.smtpSelectedRootDomains.length === 0) {
      return { ok: false, message: "Please select at least one domain" };
    }
    if (data.senderIds.length === 0) {
      return { ok: false, message: "Please select at least one sending inbox" };
    }
  }
  if (ctx.reply.replyToType === "custom" && !ctx.reply.replyToEmail?.trim()) {
    return { ok: false, message: "Please enter a Reply-To email address for Custom email." };
  }
  return { ok: true };
}
