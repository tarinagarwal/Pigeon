"""Outreach chat intent + backend-orchestrated AI Campaign Studio."""
import asyncio
import json
import random
import re
import uuid as uuid_module
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Depends
from starlette.responses import StreamingResponse

from database import db
from models import EmailTemplate, OutreachChat, OutreachChatMessage
from services.llm_service import LLMService
from routes.dependencies import get_current_user
from routes.schemas import (
    OutreachIntentRequest,
    OutreachIntentResponse,
    ParseStepsVariantsRequest,
    ParseStepsVariantsResponse,
    PostTemplateReplyRequest,
    PostTemplateReplyResponse,
    CreateOutreachChatRequest,
    UpdateOutreachChatRequest,
    AddOutreachMessageRequest,
    OutreachIntentContext,
    OutreachActRequest,
    OutreachActResponse,
)

router = APIRouter()

OUTREACH_ACTIONS = [
    "create_template",
    "create_sequence",
    "add_follow_up",
    "add_variants",
    "update_template",
    "delete_template",
    "show_list_picker",
    "select_list",
    "create_campaign",
    "update_campaign",
    "show_existing_campaign",
    "ask_preview_or_inbox",
    "show_inbox_picker",
    "show_preview",
    "ask_steps",
    "ask_variants",
    "ask_topic",
    "ask_name_confirm",
]

llm_service: LLMService = None

# In-memory generation jobs for live template streaming.
_GEN_JOB_QUEUES: Dict[str, "asyncio.Queue[dict]"] = {}
_GEN_JOB_META: Dict[str, Dict[str, str]] = {}
_GEN_JOB_TASKS: Dict[str, "asyncio.Task[None]"] = {}

# Map common LLM response variations to our action names (LLMs sometimes return different phrasings)
ACTION_ALIASES: Dict[str, str] = {
    "create_email_campaign": "show_list_picker",
    "start_campaign": "show_list_picker",
    "make_campaign": "show_list_picker",
    "new_campaign": "show_list_picker",
    "new_email_campaign": "show_list_picker",
    "create_templates": "ask_topic",
    "create_email_templates": "ask_topic",
    "add_followup": "add_follow_up",
    "add_follow_up_email": "add_follow_up",
    "delete_email": "delete_template",
    "remove_template": "delete_template",
    "remove_email": "delete_template",
    "update_email": "update_template",
    "edit_template": "update_template",
    "edit_email": "update_template",
    "pick_inbox": "show_inbox_picker",
    "choose_inbox": "show_inbox_picker",
    "select_inbox": "show_inbox_picker",
}

# When no list selected, these user phrases clearly mean "show list picker" - bypass LLM to avoid stuck replies
_LIST_FIRST_KEYWORDS = (
    "create a campaign",
    "create campaign",
    "create an email campaign",
    "email campaign",
    "create template",
    "create templates",
    "create the email template",
    "create the email templates",
    "email template",
    "email templates",
    "create sequence",
    "create a sequence",
    "create emails",
    "create email",
    "make a campaign",
    "make campaign",
    "start a campaign",
    "start the campaign",
    "new campaign",
    "select list",
    "pick list",
    "choose list",
    "pick a list",
    "i'd like to create",
    "i want to create",
    "help me create",
    "need to create",
    "let's create",
    "need emails",
    "want emails",
    "need templates",
    "want templates",
)

# When list IS selected, these phrases mean "continue to create" - route to ask_topic or ask_steps_variants
# (LLM often returns reply_only for these explicit phrasings; "create" alone works but "create email templates" doesn't)
_CREATE_INTENT_KEYWORDS = (
    "create",
    "create email",
    "create emails",
    "create template",
    "create templates",
    "create the email template",
    "create the email templates",
    "email template",
    "email templates",
    "create sequence",
    "make emails",
    "make templates",
    "make the emails",
    "generate",
    "draft",
    "write emails",
    "write the emails",
    "compose",
    "i want emails",
    "i need templates",
)


def _message_wants_list_or_sequence(msg: str) -> bool:
    """True if user message clearly indicates they want to create campaign/template/sequence (need list first)."""
    if not msg or not isinstance(msg, str):
        return False
    lower = msg.strip().lower()
    if len(lower) < 3:
        return False
    return any(kw in lower for kw in _LIST_FIRST_KEYWORDS)


# When user says these, they want to create the CAMPAIGN (run/send), not create NEW emails. Do NOT route to ask_topic.
_CREATE_CAMPAIGN_ONLY_KEYWORDS = (
    "create campaign",
    "create the campaign",
    "ok create campaign",
    "create a campaign",
    "make campaign",
    "make the campaign",
    "ready to create campaign",
    "ready to go",
    "let's create the campaign",
    "go ahead and create campaign",
    "start the campaign",
    "launch campaign",
    "launch the campaign",
    "proceed with campaign",
    "continue",
    "continue to inbox",
    "continue to campaign",
    "emails are done",
    "emails are already",
    "emails already written",
)


def _message_wants_campaign_only(msg: str) -> bool:
    """True if user wants to create/launch the campaign (emails already exist), not create new emails."""
    if not msg or not isinstance(msg, str):
        return False
    lower = msg.strip().lower()
    return any(kw in lower for kw in _CREATE_CAMPAIGN_ONLY_KEYWORDS)


_INBOX_PICKER_KEYWORDS = (
    "inbox",
    "pick inbox",
    "choose inbox",
    "select inbox",
    "which account",
    "select account",
    "pick account",
    "proceed",
    "next",
)


def _message_wants_inbox_picker(msg: str) -> bool:
    """True if user wants to pick/select sending inbox."""
    if not msg or not isinstance(msg, str):
        return False
    lower = msg.strip().lower()
    return any(kw in lower for kw in _INBOX_PICKER_KEYWORDS)


_PREVIEW_KEYWORDS = (
    "preview",
    "show me",
    "show the email",
    "show the emails",
    "let me see",
    "open preview",
)

_ADD_FOLLOW_UP_KEYWORDS = (
    "add follow-up",
    "add follow up",
    "add a follow-up",
    "add a follow up",
    "one more email",
    "add another",
    "add another email",
)

_UPDATE_TEMPLATE_KEYWORDS = (
    "update",
    "edit",
    "revise",
    "rewrite",
    "change",
    "modify",
    "improve",
)

_UPDATE_ALL_SCOPE_KEYWORDS = (
    "update all",
    "edit all",
    "change all",
    "modify all",
    "rewrite all",
    "all templates",
    "all emails",
    "every template",
    "every email",
    "whole sequence",
    "entire sequence",
)


def _message_wants_update_all_templates(msg: str) -> bool:
    """True if user explicitly asks to apply an edit across all templates/emails."""
    if not msg or not isinstance(msg, str):
        return False
    lower = msg.strip().lower()
    if not any(kw in lower for kw in _UPDATE_TEMPLATE_KEYWORDS):
        return False
    if any(kw in lower for kw in _UPDATE_ALL_SCOPE_KEYWORDS):
        return True
    # Also treat "update ... sequence 1..N" style instructions as bulk updates.
    if "sequence 1" in lower and ("sequence 2" in lower or "s1" in lower):
        return True
    return False


def _message_wants_add_follow_up(msg: str) -> bool:
    """True if user wants to add a follow-up email."""
    if not msg or not isinstance(msg, str):
        return False
    lower = msg.strip().lower()
    # Guard against false positives like "update all templates ... Sequence 2: follow-up"
    # where "follow-up" appears as template content, not an add-follow-up intent.
    if any(kw in lower for kw in _UPDATE_TEMPLATE_KEYWORDS):
        return False
    return any(kw in lower for kw in _ADD_FOLLOW_UP_KEYWORDS)


def _message_wants_preview(msg: str) -> bool:
    """True if user wants to see email preview."""
    if not msg or not isinstance(msg, str):
        return False
    lower = msg.strip().lower()
    return any(kw in lower for kw in _PREVIEW_KEYWORDS)


_LIST_CONFIRM_PHRASES = (
    "i selected the list",
    "i picked the list",
    "i chose the list",
    "picked the list",
    "chose the list",
    "selected the list",
)


def _message_confirms_list_selection(msg: str) -> bool:
    """True if user is confirming list selection from UI."""
    if not msg or not isinstance(msg, str):
        return False
    lower = msg.strip().lower()
    if lower in ("selected", "select", "ok", "done"):
        return True
    return any(lower.startswith(p) for p in _LIST_CONFIRM_PHRASES)


def _parse_steps_from_message(text: str) -> int:
    """Extract sequence step count (1-10) from user reply to 'how many emails in the sequence?'"""
    if not text or not isinstance(text, str):
        return 1
    # First number in 1-10
    match = re.search(r"\b([1-9]|10)\b", text.strip())
    if match:
        return int(match.group(1))
    return 1


def _parse_variants_from_message(text: str) -> Tuple[int, bool]:
    """Extract variants (1-5) and variants_first_step_only from user reply to 'how many A/B variations?'"""
    if not text or not isinstance(text, str):
        return 1, False
    lower = text.strip().lower()
    first_only = any(
        phrase in lower
        for phrase in (
            "first only",
            "starting only",
            "for starting",
            "first email only",
            "just the first",
            "only first",
        )
    )
    match = re.search(r"\b([1-5])\b", text.strip())
    variants = int(match.group(1)) if match else 1
    return variants, first_only


def _message_wants_to_create(msg: str) -> bool:
    """True if user message clearly indicates they want to create emails/templates/sequence (list already selected)."""
    if not msg or not isinstance(msg, str):
        return False
    if _message_wants_campaign_only(msg):
        return False  # "create campaign" = run campaign, not create emails
    lower = msg.strip().lower()
    if len(lower) < 2:
        return False
    return any(kw in lower for kw in _CREATE_INTENT_KEYWORDS)


def _topic_already_in_recent(messages: List[dict]) -> tuple[bool, str]:
    """Returns (True, topic_content) if user already gave topic; else (False, '')."""
    if not messages or len(messages) < 2:
        return False, ""
    create_keywords = ["create", "create template", "create templates", "create email", "create emails", "create the email template", "create the email templates"]
    for i in range(len(messages) - 1):
        m = messages[i]
        if m.get("role") != "assistant":
            continue
        ac = (m.get("content") or "").lower()
        if "what should these emails be about" not in ac and "describe your campaign" not in ac:
            continue
        next_m = messages[i + 1] if i + 1 < len(messages) else None
        if not next_m or next_m.get("role") != "user":
            continue
        uc = (next_m.get("content") or "").strip().lower()
        if len(uc) < 5:
            continue
        if any(kw in uc for kw in create_keywords) and len(uc) < 50:
            continue  # "create the email templates" is not a topic
        return True, (next_m.get("content") or "").strip()
    return False, ""


def _assistant_recently_asked_steps(messages: List[dict]) -> bool:
    """True if the last assistant message asked 'How many emails in the sequence?' (legacy chats)."""
    if not messages:
        return False
    # Look at the most recent assistant message in history.
    for m in reversed(messages):
        if m.get("role") != "assistant":
            continue
        content = (m.get("content") or "").lower()
        if "how many emails in the sequence" in content:
            return True
        # Stop once we've checked the last assistant message.
        break
    return False


def _assistant_recently_asked_topic(messages: List[dict]) -> bool:
    """True if the last assistant message asked about campaign topic (legacy chats without pending_sequence_ask='topic')."""
    if not messages:
        return False
    for m in reversed(messages):
        if m.get("role") != "assistant":
            continue
        content = (m.get("content") or "").lower()
        if "what should these emails be about" in content or "describe your campaign" in content:
            return True
        break
    return False


def _assistant_recently_asked_variants(messages: List[dict]) -> bool:
    """True if the last assistant message asked about A/B variants (legacy chats)."""
    if not messages:
        return False
    for m in reversed(messages):
        if m.get("role") != "assistant":
            continue
        content = (m.get("content") or "").lower()
        if "how many a/b test variations per email" in content:
            return True
        break
    return False


def _assistant_recently_asked_format(messages: List[dict]) -> bool:
    """True if the last assistant message asked which email body format to use."""
    if not messages:
        return False
    for m in reversed(messages):
        if m.get("role") != "assistant":
            continue
        content = (m.get("content") or "").lower()
        return "what format should the emails be in" in content
    return False


def _parse_body_type_from_ui_or_text(
    ui_hints: Optional[Dict[str, Any]],
    message_text: str,
) -> Optional[str]:
    """Resolve html | plain | rich from UI hint or a short user reply."""
    if ui_hints and ui_hints.get("body_type") is not None:
        raw = str(ui_hints["body_type"]).strip().lower()
        if raw in ("html", "plain", "rich"):
            return raw
    text = (message_text or "").strip().lower()
    if not text:
        return None
    if text in ("plain", "plain text", "text", "plaintext", "text only"):
        return "plain"
    if text in ("html", "raw html"):
        return "html"
    if text in ("rich", "rich text", "wysiwyg"):
        return "rich"
    # Matches handleSelectFormat copy: "I selected Plain Text format"
    if "i selected" in text and "plain" in text:
        return "plain"
    if "i selected" in text and "html" in text and "rich" not in text:
        return "html"
    if "i selected" in text and ("rich" in text or "wysiwyg" in text):
        return "rich"
    return None


def _waiting_to_resume_format_selection(meta: Dict[str, Any], messages: List[dict]) -> bool:
    """True if we paused the sequence for a format choice and the user is answering that prompt."""
    if meta.get("pending_sequence_ask") == "format":
        return True
    if meta.get("pending_format_select") or meta.get("pending_format_select_args"):
        return True
    if meta.get("generation_job_id"):
        return False
    if not meta.get("selected_list_id"):
        return False
    if meta.get("sequence_steps") is None or meta.get("sequence_variants") is None:
        return False
    if not (meta.get("campaign_topic") or "").strip():
        return False
    return _assistant_recently_asked_format(messages)


def _normalize_tool(tool: str) -> str:
    """Resolve action/tool name via aliases."""
    if not tool:
        return tool
    return ACTION_ALIASES.get(tool.strip().lower(), tool.strip())


def init_llm_service(service: LLMService):
    """Inject LLM service for outreach intent."""
    global llm_service
    llm_service = service


# --- Template generation helpers (for create_sequence) ---
FULL_TEMPLATE_PREFIX = """You are an expert email template generator. Generate a COMPLETE email template based on this request:

CRITICAL INSTRUCTIONS:
1. You MUST return a valid JSON object with exactly 3 fields: "name", "subject", and "body"
2. Do NOT return markdown code blocks, do NOT add any text before or after the JSON
3. The JSON must be valid and parseable
4. Use only the merge variables provided below (from the user's selected contact list); do not invent variables.
5. Use spintax for variation where it helps: {option1|option2|option3} picks one option at random per email. Example: {Hi|Hello|Hey} {{first_name}}, {hope you're well|just reaching out}.

PERSONALIZATION: Merge variables (e.g. {{first_name}}, {{company}}) are determined by the selected contact list. Use only the variables listed in the "ONLY use these merge variables" section below.

BODY FORMAT: Use plain text with line breaks, or HTML with inline styles (e.g. style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.5") for compatibility across email clients.

Required JSON format:
{"name": "A descriptive template name", "subject": "A single compelling subject line", "body": "Complete email body. Use only allowed merge variables. Only include unsubscribe line if COMPLIANCE requires it."}

Return ONLY valid JSON (no markdown, no extra text) for this request:"""

# Email copywriting frameworks — one is picked at random per template for variety
EMAIL_FRAMEWORKS = [
    ("PAS", "Problem → Agitate → Solution: Identify the prospect's problem, amplify the pain, then present your solution."),
    ("AIDA", "Attention → Interest → Desire → Action: Grab attention, build interest, create desire, end with a clear call-to-action."),
    ("QVC", "Question → Value → Call-to-action: Open with a compelling question, deliver value, then a soft CTA."),
    ("3S", "Short → Specific → Simple: Keep it brief, be specific to their situation, use simple language."),
]


def _get_random_framework() -> str:
    """Return a random framework instruction for template generation."""
    name, desc = random.choice(EMAIL_FRAMEWORKS)
    return f"\n\nSTRUCTURE: Use the {name} copywriting framework ({desc}). Structure the email body to follow this framework."


DEFAULT_UNSUBSCRIBE = "\n\nIf you no longer wish to receive these emails, you can unsubscribe here: {{unsubscribe_url}}"
CONTACT_SAMPLE_SIZE = 50
STANDARD_FIELDS = ["first_name", "last_name", "email", "company", "industry"]


async def _get_user_compliance(user_id: str) -> dict:
    """Fetch user compliance settings from db."""
    doc = await db.user_settings.find_one({"user_id": user_id}, {"compliance": 1})
    comp = doc.get("compliance", {}) if doc else {}
    return {
        "spam_words": comp.get("spam_words"),
        "max_links_per_email": comp.get("max_links_per_email", 3),
        "max_images_per_email": comp.get("max_images_per_email", 2),
        "require_unsubscribe_link": comp.get("require_unsubscribe_link", False),
    }


def _get_spam_words_list(spam_words: Optional[str]) -> List[str]:
    if not spam_words or not isinstance(spam_words, str):
        return []
    return [w.strip().lower() for w in spam_words.split(",") if w.strip()]


def _build_variable_restriction(variable_names: List[str]) -> str:
    if not variable_names:
        return ""
    placeholders = ", ".join(f"{{{{{v}}}}}" for v in variable_names)
    return (
        f"\n\nCRITICAL - Variables from the selected contact list. ONLY use these merge variables in the template (no other {{{{variable}}}} placeholders): {placeholders}."
        " You may also use {{inbox_name}} and {{inbox_email}} ONLY in the sender signature to personalize the from-name and email based on the sending inbox "
        "(e.g., 'Best, {{inbox_name}}'). Do NOT use {{inbox_name}} or {{inbox_email}} in the subject or main body personalization about the prospect."
    )


def _build_compliance_prompt(compliance: dict) -> str:
    parts = []
    spam_list = _get_spam_words_list(compliance.get("spam_words"))
    if spam_list:
        parts.append(f"Do NOT use these words (they trigger spam filters): {', '.join(spam_list[:30])}{'...' if len(spam_list) > 30 else ''}. Use synonyms or rephrase.")
    max_links = compliance.get("max_links_per_email", 3)
    parts.append(f"Use at most {max_links} link(s) in the entire email.")
    max_images = compliance.get("max_images_per_email", 2)
    parts.append(f"Use at most {max_images} image(s) in the entire email.")
    if compliance.get("require_unsubscribe_link"):
        parts.append(
            "You MUST include an unsubscribe line in the body using {{unsubscribe_url}} (replaced at send time), e.g. 'Unsubscribe: {{unsubscribe_url}}' or for HTML <a href=\"{{unsubscribe_url}}\">unsubscribe</a>."
        )
    if not parts:
        return ""
    return f"\n\nCOMPLIANCE (you MUST follow these): {' '.join(parts)}"


def _get_common_variable_names(contacts: List[dict]) -> List[str]:
    """Return merge variable names that ALL contacts have non-empty values for."""
    if not contacts:
        return []
    candidate_keys = set(STANDARD_FIELDS)
    for c in contacts:
        cf = c.get("custom_fields") or {}
        if isinstance(cf, dict):
            candidate_keys.update(cf.keys())
    result = []
    for key in sorted(candidate_keys):
        ok = True
        for c in contacts:
            if key in STANDARD_FIELDS:
                v = c.get(key)
            else:
                v = (c.get("custom_fields") or {}).get(key) if isinstance(c.get("custom_fields"), dict) else None
            if v is None or str(v).strip() == "":
                ok = False
                break
        if ok:
            result.append(key)
    return result


def _parse_template_json(raw: str) -> Optional[dict]:
    """Parse LLM output as template JSON. Strips markdown if present."""
    text = (raw or "").strip()
    if not text:
        return None
    for prefix in ("```json", "```"):
        if prefix in text:
            m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
            if m:
                text = m.group(1).strip()
                break
    first = text.find("{")
    last = text.rfind("}")
    if first >= 0 and last > first:
        text = text[first : last + 1]
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        text = re.sub(r",\s*([}\]])", r"\1", text)
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    return None


def _parse_templates_json(raw: str) -> Optional[List[dict]]:
    """Parse multi-template JSON output from LLM.

    Supports:
    - {"templates": [{...}, {...}]}
    - [{...}, {...}]
    """
    text = (raw or "").strip()
    if not text:
        return None
    for prefix in ("```json", "```"):
        if prefix in text:
            m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
            if m:
                text = m.group(1).strip()
                break
    first_obj = text.find("{")
    last_obj = text.rfind("}")
    first_arr = text.find("[")
    last_arr = text.rfind("]")
    if first_arr >= 0 and last_arr > first_arr and (first_obj == -1 or first_arr < first_obj):
        text = text[first_arr : last_arr + 1]
    elif first_obj >= 0 and last_obj > first_obj:
        text = text[first_obj : last_obj + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        text = re.sub(r",\s*([}\]])", r"\1", text)
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return None
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        templates = data.get("templates")
        if isinstance(templates, list):
            return [x for x in templates if isinstance(x, dict)]
    return None


def _looks_like_html(text: str) -> bool:
    return bool(text and "<" in text and ">" in text)


def _plain_text_to_html(text: str) -> str:
    """Convert plain text to simple HTML with line breaks."""
    if not text:
        return ""
    return text.replace("\n", "<br>\n")


UPDATE_TEMPLATE_PREFIX = """You are an expert email template editor. The user wants to update an existing email template.

Your task: Read the FULL template below carefully (subject and body). Apply ONLY the changes the user asked for; preserve everything else—tone, structure, merge variables (e.g. {{{{first_name}}}}, {{{{company}}}}), formatting (HTML or plain), and any unsubscribe/compliance text. Do not rewrite or summarize unless the user explicitly asked for that.

CURRENT TEMPLATE:
Subject: {subject}

Body:
{body}

USER'S EDIT INSTRUCTION: {instruction}

Return ONLY a valid JSON object with exactly two keys: "subject" and "body". No markdown, no code block, no extra text. Update only what the instruction asks; leave the rest of the template intact. Keep the same style (HTML vs plain) unless the user asks to change it. Preserve all placeholders and compliance elements."""


MULTI_TEMPLATE_PREFIX = """You are an expert email copywriter.

Generate multiple A/B variations for the SAME sequence step.

Return ONLY valid JSON in one of these shapes:
1) {{"templates":[{{"subject":"...","body":"..."}}, ...]}}
2) [{{"subject":"...","body":"..."}}, ...]

Rules:
- Output EXACTLY {count} templates.
- Keep each template meaningfully different (hook/opening/angle/CTA).
- Keep intent consistent with the provided context.
- Preserve placeholders exactly if used.
- No markdown, no code block, no extra text.
"""


def _has_unsubscribe(text: str) -> bool:
    if not text:
        return False
    lower = text.lower()
    return "unsubscribe" in lower or "opt-out" in lower or "opt out" in lower


def _build_prompt(request: OutreachIntentRequest) -> str:
    """Build the policy prompt with context and strict JSON response format."""
    ctx = request.context
    templates_str = "None"
    if ctx and ctx.templates_in_session:
        templates_str = json.dumps(ctx.templates_in_session, indent=0)
    lists_str = "None"
    if ctx and ctx.contact_lists:
        lists_str = json.dumps(ctx.contact_lists, indent=0)
    selected = (ctx and ctx.selected_list_id) or "null"
    inbox_ids = (ctx and ctx.selected_inbox_ids) or []
    inbox_str = json.dumps(inbox_ids) if inbox_ids else "[] (none selected)"
    base_name = (ctx and ctx.base_name) or "Outreach"
    existing_summary = (ctx and ctx.existing_sequences_summary) or ""
    recent = ""
    if ctx and ctx.recent_messages:
        # Use full conversation context (no per-message truncation); cap by message count if needed (e.g. last 100)
        max_messages = 100
        messages_for_context = ctx.recent_messages[-max_messages:] if len(ctx.recent_messages) > max_messages else ctx.recent_messages
        recent = "\nRecent conversation (use this history; do not ask again for info already given):\n" + "\n".join(
            f"  {m.get('role', '')}: {m.get('content', '')}"
            for m in messages_for_context
        )

    existing_block = ""
    if existing_summary:
        existing_block = f"\n- Existing sequences and variations (do NOT suggest creating these again; use this to know what add_follow_up or add_variants should do next): {existing_summary}"

    created_campaign_id = (ctx and ctx.created_campaign_id) or "null"
    last_action = (ctx and ctx.last_action) or ""
    just_created = (ctx and ctx.just_created_templates) is True
    pending_nc = (ctx and ctx.pending_name_confirm) or {}
    sequence_steps_ctx = ctx.sequence_steps if ctx else None
    sequence_variants_ctx = ctx.sequence_variants if ctx else None
    steps_ctx_str = str(sequence_steps_ctx) if sequence_steps_ctx is not None else "not yet given"
    variants_ctx_str = str(sequence_variants_ctx) if sequence_variants_ctx is not None else "not yet given"
    campaign_topic_ctx = (ctx and ctx.campaign_topic) or ""

    # When awaiting name confirmation, tell LLM to return create_sequence with resolved name
    pending_name_block = ""
    if pending_nc and isinstance(pending_nc, dict):
        sug = pending_nc.get("suggested_name") or base_name
        topic = pending_nc.get("topic") or ""
        steps = pending_nc.get("steps") or 1
        variants = pending_nc.get("variants") or 1
        v_first = "true" if pending_nc.get("variants_first_step_only") else "false"
        pending_name_block = f"""
PENDING NAME CONFIRMATION: The assistant suggested sequence name "{sug}" and asked the user to confirm or type a different name. The user just replied. If they confirmed (yes, ok, sure, etc), use create_sequence with base_name="{sug}", prompt="{topic}", count={steps}, variants_per_step={variants}, variants_first_step_only={v_first}. If they gave a different name, use create_sequence with base_name=their reply (cleaned, max 40 chars), prompt="{topic}", count={steps}, variants_per_step={variants}, variants_first_step_only={v_first}. Do NOT use ask_name_confirm or ask_topic again."""

    # Emphasize list-first: never create templates without a list
    list_first_block = ""
    if not selected or selected == "null":
        list_first_block = """
CRITICAL - LIST FIRST RULE: The user MUST select a contact list BEFORE any email/sequence/campaign creation. If selected_list_id is null (no list chosen yet), you MUST use show_list_picker for ANY of: create_sequence, create_template, add_follow_up, add_variants, OR when user says "create a campaign", "create an email campaign", "I'd like to create an email campaign", "start a campaign", etc. Return action: show_list_picker. NEVER return create_sequence, create_template, add_follow_up, add_variants, or create_campaign when no list is selected. List first, then sequence/campaign."""

    system = f"""You are the outreach assistant for an email outreach product. The user is in a chat where they can create email templates (with naming like "{base_name} - S1 - V1"), select contact lists, and create campaigns. Accept any phrasing: "make me 3 emails", "create a sequence", "draft a follow-up", "I need emails for X", etc.
{list_first_block}

IMPORTANT: Use the conversation history above. Do NOT ask again for campaign topic, sequence name, or what the emails are about if the user already provided this earlier (e.g. after deleting templates, or saying "try again", "now try"). Continue from where the conversation left off.

Current context:
- Templates created in this session: {templates_str}
- Contact lists available: {lists_str}
- Currently selected list id: {selected}
- Selected inbox ids (for sending): {inbox_str}
- Base name for new templates: {base_name}
- Created campaign id for this sequence (if any): {created_campaign_id}
- Last action (if any): {last_action}
- Sequence steps (how many emails) already given: {steps_ctx_str}
- Sequence variants (A/B per email) already given: {variants_ctx_str}
- Campaign topic already given (do NOT ask ask_topic again if this is set): {campaign_topic_ctx if campaign_topic_ctx else "not yet given"}
- User just created templates (preview/inbox choice relevant): {str(just_created).lower()}{existing_block}
{pending_name_block}

CONTEXT AWARENESS: Pay attention to what the user has ALREADY done. If templates_in_session has items (emails exist), the user is past the "create emails" flow. When they say "create campaign", "ok create campaign", "emails are done", "ready" — use create_campaign, NOT ask_topic. Do NOT ask "what should these emails be about?" when emails already exist. last_action tells you the last step: update_template, create_sequence, add_follow_up = emails exist. create_campaign, show_existing_campaign = campaign exists.

CAMPAIGN CHECKLIST: Before create_campaign can run, we need: (1) contact list selected, (2) templates created, (3) inbox selected. The create_campaign tool checks these and prompts for whichever is missing (show_list_picker, message to create emails, or show_inbox_picker). When user says "create campaign", always use create_campaign—the tool will handle prompting for missing items.
{recent}

You must respond with exactly one JSON object (no markdown, no code block, no extra text).

OPTION A (single instruction): "action", "params", "reply" (optional).
OPTION B (you are in control; code runs your instructions in order): "steps" — an array of instructions. Each instruction: {{ "tool": "<action_name>", "args": {{ ... }} }}. The code will execute each step in order. Tool names: reply_only, create_sequence, show_list_picker, ask_steps, ask_variants, ask_topic, ask_name_confirm, etc. For ask_name_confirm use args: suggested_name, topic, steps, variants. For a simple reply use tool "reply_only" with args: reply (string).

SEQUENCE FLOW ORDER (after list is selected): 1) ask_topic first (what the campaign/emails are about), 2) ask_steps second (how many emails in the sequence: 1, 2, 3, 4, 5...), 3) ask_variants third (how many A/B variations per email), 4) ask_name_confirm, 5) create_sequence. Never skip steps.

Action policy (function mapping; use these as "action" or as "tool" inside "steps"):
- show_list_picker: User wants to choose a contact list, OR user wants create_sequence/create_template/add_follow_up/add_variants but selected_list_id is null. ALWAYS use show_list_picker first when no list is selected. params: {{}}
- ask_topic: List IS selected. User wants a sequence but has NOT given what the emails/campaign should be about. Ask FIRST (before steps/variants): "What should these emails be about? For example: cold outreach for my product, product launch, re-engaging old leads. Describe your campaign in a few words." USE THIS for: "create", "create email templates", "create templates", "email templates", "create emails", "generate" — treat ALL these as the same intent: ask_topic. NEVER use reply_only for these. params: {{ "reply": "optional" }}
- ask_steps: List is selected AND topic/prompt IS known (from recent messages). User has NOT given how many emails in the sequence (sequence_steps is not yet given). Ask ONLY: "How many emails in the sequence? (e.g. 1, 2, 3, 4, 5...)" params: {{ "reply": "optional custom message" }}
- ask_variants: List is selected AND topic AND sequence_steps ARE known. User has NOT given how many A/B variations per email. Ask ONLY: "How many A/B test variations per email? (1 = one version, 2 = A/B test, etc.). You can say '2 for starting only' to A/B test just the first email." params: {{ "reply": "optional custom message" }}
- ask_name_confirm: List selected, we have topic + steps + variants. Suggest a sequence name and ask user to confirm. params: {{ "suggested_name": "short name", "topic": "campaign topic", "steps": number, "variants": number, "variants_first_step_only": boolean (optional, use when user said A/B for starting only) }}
- create_sequence: ONLY when selected_list_id is set. User wants to create a full email sequence. Requires: prompt (topic), count (steps), base_name. params: {{ "base_name": "sequence name", "prompt": "what the emails are about (topic, product, audience, goal)", "count": 1-10, "variants_per_step": 1-5 (default 1), "variants_first_step_only": boolean (default false) — when true, A/B variants apply ONLY to the first/initial email; follow-ups get 1 version each. Use variants_first_step_only=true when user says "2 A/B for starting", "2 variants for first only", "A/B test for the first email", "2 versions for starting email", etc. Otherwise use false (all steps get same variant count). "links": "optional", "details": "optional" }}. Do NOT use create_sequence without a concrete prompt (topic). If topic is missing, use ask_topic. When user provides topic+links+details, extract into prompt, links, details.
- create_template: ONLY when selected_list_id is set. User wants a single new email. params: {{ "prompt": "concrete description", "links": "optional", "details": "optional" }}. If no list selected, use show_list_picker. If no prompt, use ask_topic to ask what the email should be about.
- add_follow_up: ONLY when selected_list_id is set. User wants one more follow-up. params: {{ "prompt": "e.g. polite follow-up", "links": "optional", "details": "optional" }}
- add_variants: ONLY when selected_list_id is set. User wants MORE VARIANTS (V2, V3...) of EXISTING steps for A/B testing. Use this when they say things like "add another version", "add one more variant", or "add variants for each step". It always adds ONE new variant number (next V) for every existing step that already has at least V1. To reach a target like "3 variants everywhere", call add_variants repeatedly until each step has V1..V3. params: {{ "prompt": "optional: how variants differ", "links": "optional", "details": "optional" }}
- update_template: User wants to edit an existing template. params: {{ "template_id": "id from templates_in_session", "instruction": "user's edit instruction" }}. When the user wants to update MULTIPLE or ALL emails (e.g. "update all", "make every email shorter", "change all templates", "edit all emails to be friendlier"), return a "steps" array with ONE update_template per template in templates_in_session—each step with that template's id and the same instruction (or instruction adapted per step if the user gave different instructions per email). When the user names one template or says "the first one" / "the second email", return a single action with that template_id only.
- delete_template: User wants to delete template(s). params: {{ "template_ids": [...] }} or {{ "template_id": "id" }}
- select_list: User explicitly picked a list by id. params: {{ "list_id": "id" }}
- create_campaign: User wants to create a campaign. Use when templates_in_session has items, list is selected, and user says "create campaign", "ok create campaign", "emails are done", "ready". ONLY when created_campaign_id is null. If created_campaign_id is set, use show_existing_campaign. NEVER use ask_topic when user says "create campaign" and templates exist. params: {{}} or {{ "name": "optional", ... }}
- update_campaign: User wants to change the existing campaign (rename, change daily limit, update templates, change schedule). Use when they say "update the campaign", "change daily limit", "rename campaign", "use the new templates". params: {{ "campaign_id": "optional, use context created_campaign_id if omitted", "instruction": "e.g. set daily limit to 100" }} or explicit: {{ "name": "string", "daily_limit": number, "follow_up_delay_days": number, "timezone": "IANA", "template_ids": ["id1", ...] }}
- show_existing_campaign: User said "create campaign" but they already have a campaign for this sequence (created_campaign_id is set). Do NOT create a duplicate. params: {{ "campaign_id": "from context", "reply": "e.g. You already have a campaign for this sequence. I can update it, start it, or you can open it to edit." }}
- ask_preview_or_inbox: After templates were just created, show a message that asks whether to preview or proceed to inbox select. Use when the UI already showed preview/inbox choice and user replied vaguely. params: {{ "reply": "short reply + ask: Would you like to preview or proceed to select sending inbox?" }}
- show_inbox_picker: User wants to pick which email account(s) to send from. Use when they say "inbox", "next", "proceed", "pick inbox", "choose inbox", "select inbox", "which account". params: {{ "reply": "optional short intro" }}
- show_preview: User wants to see a preview of the email(s). Use when they say "preview", "show me", "show the email", "let me see", "open preview". params: {{ "reply": "optional", "template_id": "optional id of template to preview (if not set, frontend shows first)" }}
- reply_only: This tool is disabled and MUST NOT be used. When you want to ask a clarifying question, use ask_topic, ask_steps, ask_variants, ask_preview_or_inbox, or show_list_picker instead—never reply_only.

Rules: CONTEXT — When templates_in_session has items, user has emails. "create campaign", "ok create campaign", "emails are done" = create_campaign. NEVER ask_topic when emails exist. CRITICAL — "create", "create email templates", "create templates" (without "campaign") = ask_topic when topic unknown. NEVER use reply_only for these.

VARIANTS (creation): When user says "2 A/B for starting", "2 variants for first email only", "A/B test for starting/initial email", set variants_per_step=2 AND variants_first_step_only=true (follow-ups get 1 version each). When they say "2 variants for all" or "2 per step", use variants_per_step=2, variants_first_step_only=false. For phrases like "make it 3 variants everywhere", use count from the existing sequence (from existing_sequences_summary) and variants_per_step=3, variants_first_step_only=false, and call create_sequence or add_variants as appropriate:
- If there is NO existing sequence yet, use create_sequence with count and variants_per_step.
- If a sequence already exists, use add_variants repeatedly until each step has at least the requested number of variants (V1..VN). You can determine which steps still need variants from existing_sequences_summary.

UPDATE (templates): When the user says "update all", "edit all emails", "make every email shorter", "change all templates", or similar, return "steps" with one update_template per template in templates_in_session (same instruction for each, or per-email instruction if the user specified). When they specify one email ("the first", "Cold Outreach - S1", "make the second one shorter"), return a single update_template with that template_id.
VARIANTS (deletion / reducing): When the user wants to "remove variants", "delete extra versions", or "go back to 1 version per email", use delete_template. If you cannot safely infer which template_ids to remove from templates_in_session (e.g. which V numbers), first ask a clarifying question via reply_only (for example: "Which versions should I delete? For example: V2 and V3 of step 1."). Then call delete_template with the specific template_ids.

FLOW ORDER after list selected: 1) ask_topic (campaign/emails about) FIRST, 2) ask_steps (how many emails in sequence: 1, 2, 3...) SECOND, 3) ask_variants (how many A/B per email) THIRD, 4) ask_name_confirm, 5) create_sequence. Never use ask_steps before the user has given the campaign topic. Never use ask_variants before sequence_steps is given. Prefer create_sequence when the user mentions number of emails or "sequence" AND has topic AND steps AND variants. When created_campaign_id is set and user says "create campaign", return show_existing_campaign. For "preview"/"show me" use show_preview; for "inbox"/"next"/"proceed to inbox" use show_inbox_picker. Use add_variants when they clearly want more versions/variants of existing steps (same S, new V), not new steps. Infer base_name from "call it X", "named Y". Infer count from "3 emails", "5 steps". "5, 2 for starting", "5 email 2 a/b for starting", "5 steps 2 variants for first only" = count=5, variants_per_step=2, variants_first_step_only=true. If the user says "try again", "now try", "retry", look at the recent conversation for topic, name, and step/variant counts. Never create templates without a concrete prompt (topic); if missing, use ask_topic. When the user provides links or details along with the topic, include them in params.links and params.details. Respond with ONLY the JSON object."""

    user_block = f"User message: {request.message}"
    return system + "\n\n" + user_block


def _parse_intent_response(raw: str) -> dict:
    """Strip markdown/code fences and parse JSON; return dict or raise."""
    text = (raw or "").strip()
    if not text:
        raise ValueError("Empty response")
    # Remove markdown code block if present
    if "```json" in text:
        m = re.search(r"```json\s*([\s\S]*?)\s*```", text)
        if m:
            text = m.group(1).strip()
    elif "```" in text:
        m = re.search(r"```\s*([\s\S]*?)\s*```", text)
        if m:
            text = m.group(1).strip()
    return json.loads(text)


async def _load_chat_context(
    chat_id: str,
    user_id: str,
) -> tuple[dict, dict, List[dict], List[dict]]:
    """Load chat, meta, recent messages, templates/lists context for orchestrated mode."""
    chat = await db.outreach_chats.find_one(
        {"id": chat_id, "user_id": user_id},
        {"_id": 0},
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    meta: dict = chat.get("meta") or {}

    messages = await db.outreach_chat_messages.find(
        {"chat_id": chat_id, "user_id": user_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(None)

    # Contact lists (for list picker + LLM context)
    contact_lists = await db.contact_lists.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "name": 1, "contact_ids": 1, "contact_count": 1},
    ).to_list(None)

    # Templates created in this chat session (if tracked in meta)
    created_template_ids: List[str] = meta.get("created_template_ids") or []
    templates: List[dict] = []
    if created_template_ids:
        templates = await db.templates.find(
            {"id": {"$in": created_template_ids}, "user_id": user_id},
            {"_id": 0, "id": 1, "name": 1, "subject": 1},
        ).to_list(None)

    ctx = {
        "chat": chat,
        "meta": meta,
        "messages": messages,
        "templates": templates,
        "contact_lists": contact_lists,
    }
    return chat, ctx, messages, contact_lists


def _build_outreach_intent_context(ctx: dict) -> OutreachIntentContext:
    """Build OutreachIntentContext from stored chat meta + DB lookups."""
    meta: dict = ctx.get("meta") or {}
    templates: List[dict] = ctx.get("templates") or []
    contact_lists: List[dict] = ctx.get("contact_lists") or []
    messages: List[dict] = ctx.get("messages") or []

    templates_in_session = [
        {
            "id": t.get("id"),
            "name": t.get("name"),
            "subject": t.get("subject"),
        }
        for t in templates
        if t.get("id")
    ]

    # Simple, conservative summary: just list S/V-style names if present.
    existing_sequences_summary = ""
    if templates_in_session:
        names = [t.get("name") for t in templates_in_session if t.get("name")]
        existing_sequences_summary = ", ".join(names[:20])

    recent_messages = [
        {"role": m.get("role", ""), "content": m.get("content", "")}
        for m in messages[-50:]
    ]

    return OutreachIntentContext(
        templates_in_session=templates_in_session or None,
        existing_sequences_summary=existing_sequences_summary or None,
        selected_list_id=meta.get("selected_list_id"),
        contact_lists=[
            {
                "id": cl.get("id"),
                "name": cl.get("name"),
                "contact_count": cl.get("contact_count")
                or (cl.get("contact_ids") and len(cl.get("contact_ids")))
                or 0,
            }
            for cl in contact_lists
            if cl.get("id")
        ]
        or None,
        base_name=meta.get("base_name"),
        recent_messages=recent_messages or None,
        last_action=meta.get("last_action"),
        just_created_templates=meta.get("just_created_templates"),
        created_campaign_id=meta.get("created_campaign_id"),
        selected_inbox_ids=meta.get("selected_inbox_ids"),
        pending_name_confirm=meta.get("pending_name_confirm"),
        sequence_steps=meta.get("sequence_steps"),
        sequence_variants=meta.get("sequence_variants"),
        pending_sequence_ask=meta.get("pending_sequence_ask"),
        campaign_topic=meta.get("campaign_topic"),
    )


async def _append_assistant_message(
    chat_id: str,
    user_id: str,
    content: str,
    payload: Optional[Dict[str, Any]] = None,
) -> dict:
    """Persist an assistant message and return the stored document."""
    msg = OutreachChatMessage(
        chat_id=chat_id,
        user_id=user_id,
        role="assistant",
        content=content,
        payload=payload,
    )
    doc = msg.model_dump()
    await db.outreach_chat_messages.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _emit_job_event(job_id: str, event: Dict[str, Any]) -> None:
    """Best-effort enqueue of a live generation event."""
    q = _GEN_JOB_QUEUES.get(job_id)
    if not q:
        return
    try:
        q.put_nowait(event)
    except Exception:
        pass


def _sse_pack(event_type: str, data: Dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, default=str)}\n\n"


async def _run_sequence_generation_job(
    *,
    job_id: str,
    chat_id: str,
    user_id: str,
    ai_provider: str,
    base_name: str,
    campaign_context: str,
    steps_count: int,
    variants_per: int,
    variants_first_only: bool,
    variable_restriction: str,
    compliance_prompt: str,
    seq_num_by_step: Dict[int, int],
    body_type: str = "html",
) -> None:
    """Generate sequence templates in the background and stream progress events."""
    created_ids: List[str] = []
    templates_created: List[dict] = []
    total_templates = sum(
        (variants_per if (s == 1 or not variants_first_only) else 1)
        for s in range(1, steps_count + 1)
    )
    compliance = await _get_user_compliance(user_id)

    await _emit_job_event(
        job_id,
        {
            "type": "started",
            "job_id": job_id,
            "steps": steps_count,
            "variants_per_step": variants_per,
            "total_templates": total_templates,
        },
    )

    for step in range(1, steps_count + 1):
        v_count = variants_per if (step == 1 or not variants_first_only) else 1
        step_seq = seq_num_by_step[step]
        if step == 1:
            step_context = campaign_context
        else:
            step_context = (
                f"Follow-up email, step {step} of {steps_count}. "
                f"Context: {campaign_context}. Keep it concise and natural."
            )
        format_hint = (
            "\n\nFORMAT: Write the email body as plain text with line breaks only. Do NOT use any HTML tags."
            if body_type == "plain"
            else "\n\nFORMAT: Write the email body as HTML with inline CSS styles on elements."
            if body_type == "html"
            else ""
        )
        prompt = (
            MULTI_TEMPLATE_PREFIX.format(count=v_count)
            + _get_random_framework()
            + variable_restriction
            + compliance_prompt
            + "\n\n"
            + step_context
            + format_hint
        )

        await _emit_job_event(
            job_id,
            {"type": "step_started", "job_id": job_id, "step": step, "variants": v_count},
        )

        try:
            content = await llm_service.generate_text(user_id, ai_provider or "openai", prompt)
            parsed_list = _parse_templates_json(content or "")
            if not parsed_list or len(parsed_list) < v_count:
                retry_prompt = prompt + f"\n\nReturn ONLY valid JSON with exactly {v_count} templates."
                content = await llm_service.generate_text(user_id, ai_provider or "openai", retry_prompt)
                parsed_list = _parse_templates_json(content or "")
            if not parsed_list:
                raise ValueError("Could not parse templates JSON.")
            parsed_list = parsed_list[:v_count]
        except Exception as e:
            await _emit_job_event(
                job_id,
                {
                    "type": "failed",
                    "mode": "create",
                    "job_id": job_id,
                    "step": step,
                    "created_count": len(created_ids),
                    "message": str(e),
                },
            )
            return

        step_templates: List[dict] = []
        for variant, parsed in enumerate(parsed_list, start=1):
            tmpl_name = f"{base_name} - S{step} - V{variant}"
            subject = str(parsed.get("subject") or "").strip() or "No subject"
            body_raw = str(parsed.get("body") or "").strip()
            body = body_raw if body_type == "plain" else (body_raw if _looks_like_html(body_raw) else _plain_text_to_html(body_raw))
            if compliance.get("require_unsubscribe_link") and not _has_unsubscribe(body):
                body = body.rstrip() + DEFAULT_UNSUBSCRIBE

            tid = str(uuid_module.uuid4())
            template_doc = {
                "id": tid,
                "user_id": user_id,
                "name": tmpl_name,
                "subject": subject,
                "body": body,
                "body_type": body_type,
                "sequence_number": step_seq,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            await db.templates.insert_one(template_doc)
            template_doc.pop("_id", None)
            created_ids.append(tid)
            templates_created.append(template_doc)
            step_templates.append(template_doc)

        await _emit_job_event(
            job_id,
            {
                "type": "step_completed",
                "job_id": job_id,
                "step": step,
                "created_count": len(created_ids),
                "total_templates": total_templates,
                "templates": step_templates,
            },
        )

    # Persist updated chat meta so future turns know templates were created.
    chat_doc = await db.outreach_chats.find_one({"id": chat_id, "user_id": user_id}, {"_id": 0, "meta": 1})
    meta = (chat_doc or {}).get("meta") or {}
    existing = [x for x in (meta.get("created_template_ids") or []) if isinstance(x, str) and x]
    merged_ids = existing + [x for x in created_ids if x not in existing]
    meta["created_template_ids"] = merged_ids
    meta["base_name"] = base_name
    meta["last_action"] = "create_sequence"
    meta["just_created_templates"] = True
    if meta.get("generation_job_id") == job_id:
        meta.pop("generation_job_id", None)
    await db.outreach_chats.update_one(
        {"id": chat_id, "user_id": user_id},
        {"$set": {"meta": meta, "updated_at": datetime.now(timezone.utc)}},
    )

    await _emit_job_event(
        job_id,
        {
            "type": "done",
            "mode": "create",
            "job_id": job_id,
            "created_template_ids": created_ids,
            "templates_created": templates_created,
        },
    )


async def _run_update_templates_job(
    *,
    job_id: str,
    chat_id: str,
    user_id: str,
    ai_provider: str,
    target_ids: List[str],
    instruction: str,
) -> None:
    """Update templates in background and stream per-template progress."""
    compliance = await _get_user_compliance(user_id)
    updated_cards: List[dict] = []
    updated_ids: List[str] = []
    skipped_ids: List[str] = []
    total = len(target_ids)

    await _emit_job_event(
        job_id,
        {
            "type": "started",
            "mode": "update",
            "job_id": job_id,
            "total_templates": total,
        },
    )

    for idx, tid in enumerate(target_ids, start=1):
        t = await db.templates.find_one({"id": tid, "user_id": user_id}, {"_id": 0})
        if not t:
            await _emit_job_event(
                job_id,
                {
                    "type": "template_skipped",
                    "mode": "update",
                    "job_id": job_id,
                    "template_id": tid,
                    "index": idx,
                    "total_templates": total,
                    "reason": "Template not found",
                },
            )
            continue

        base_prompt = UPDATE_TEMPLATE_PREFIX.format(
            subject=t.get("subject", ""),
            body=t.get("body", ""),
            instruction=instruction,
        )
        parsed: Optional[dict] = None
        last_error: Optional[str] = None
        for attempt in range(1, 4):
            attempt_prompt = base_prompt
            if attempt > 1:
                attempt_prompt += (
                    "\n\nPrevious response was invalid. "
                    "Return ONLY valid JSON with exactly keys \"subject\" and \"body\"."
                )
            try:
                content = await llm_service.generate_text(user_id, ai_provider or "openai", attempt_prompt)
            except Exception as e:
                last_error = str(e)
                continue

            parsed = _parse_template_json(content or "")
            if parsed:
                break
            last_error = "Could not parse AI response for template update."

        if not parsed:
            skipped_ids.append(tid)
            await _emit_job_event(
                job_id,
                {
                    "type": "template_skipped",
                    "mode": "update",
                    "job_id": job_id,
                    "template_id": tid,
                    "index": idx,
                    "total_templates": total,
                    "updated_count": len(updated_ids),
                    "reason": last_error or "Template update failed after 3 attempts.",
                },
            )
            continue

        new_subject = str(parsed.get("subject") or t.get("subject") or "").strip() or "No subject"
        new_body_raw = str(parsed.get("body") or t.get("body") or "").strip()
        new_body = new_body_raw if _looks_like_html(new_body_raw) else _plain_text_to_html(new_body_raw)
        if compliance.get("require_unsubscribe_link") and not _has_unsubscribe(new_body):
            new_body = new_body.rstrip() + DEFAULT_UNSUBSCRIBE

        await db.templates.update_one(
            {"id": tid, "user_id": user_id},
            {"$set": {"subject": new_subject, "body": new_body, "updated_at": datetime.now(timezone.utc)}},
        )
        updated = {**t, "subject": new_subject, "body": new_body}
        updated_cards.append(updated)
        updated_ids.append(tid)

        await _emit_job_event(
            job_id,
            {
                "type": "template_updated",
                "mode": "update",
                "job_id": job_id,
                "index": idx,
                "total_templates": total,
                "updated_count": len(updated_ids),
                "template": updated,
            },
        )

    chat_doc = await db.outreach_chats.find_one({"id": chat_id, "user_id": user_id}, {"_id": 0, "meta": 1})
    meta = (chat_doc or {}).get("meta") or {}
    meta["last_action"] = "update_template"
    if meta.get("generation_job_id") == job_id:
        meta.pop("generation_job_id", None)
    await db.outreach_chats.update_one(
        {"id": chat_id, "user_id": user_id},
        {"$set": {"meta": meta, "updated_at": datetime.now(timezone.utc)}},
    )

    await _emit_job_event(
        job_id,
        {
            "type": "done",
            "mode": "update",
            "job_id": job_id,
            "updated_template_ids": updated_ids,
            "skipped_template_ids": skipped_ids,
            "templates_updated": updated_cards,
        },
    )

async def _execute_outreach_tool(
    tool: str,
    args: Dict[str, Any],
    *,
    chat_id: str,
    user_id: str,
    meta: Dict[str, Any],
    ai_provider: str = "",
) -> tuple[Dict[str, Any], List[dict], List[dict]]:
    """
    Execute a single outreach action/tool on the backend.
    """
    new_messages: List[dict] = []
    ui_actions: List[dict] = []
    params = args or {}
    reply: Optional[str] = (
        params.get("reply") or params.get("_reply") or args.get("_reply")
    )

    if tool == "ask_topic":
        meta["pending_sequence_ask"] = "topic"
        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply
            or "What should these emails be about? For example: cold outreach for my product, product launch, or re-engaging old leads. Describe your campaign in a few words and I'll write the emails.",
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "ask_steps":
        meta["pending_sequence_ask"] = "steps"
        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply
            or "**How many emails in the sequence?** (e.g. 1 = one email only, 2 = one first email + one follow-up, 3 = one + two follow-ups, and so on). Reply with a number: 1, 2, 3, 4, 5, etc.",
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "ask_variants":
        meta["pending_sequence_ask"] = "variants"
        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply
            or "**How many A/B test variations per email?** (1 = one version per email, 2 = A/B test two versions, etc.). You can say **2 for starting only** to A/B test just the first email. Reply with a number: 1, 2, 3, etc.",
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "ask_name_confirm":
        # Name confirmation is deprecated in this flow. If we already have enough
        # sequence context, skip this question and proceed immediately.
        inferred_topic = (params.get("topic") or meta.get("campaign_topic") or "").strip()
        inferred_steps = int(params.get("steps") or meta.get("sequence_steps") or 1)
        inferred_variants = int(params.get("variants") or meta.get("sequence_variants") or 1)
        inferred_first_only = bool(
            params.get("variants_first_step_only")
            or meta.get("sequence_variants_first_step_only")
        )
        inferred_base_name = (
            str(params.get("suggested_name") or "").strip()
            or str(meta.get("base_name") or "").strip()
            or "Pigeon Outreach"
        )[:40]
        if inferred_topic:
            create_args = {
                "base_name": inferred_base_name,
                "prompt": inferred_topic,
                "count": min(10, max(1, inferred_steps)),
                "variants_per_step": min(5, max(1, inferred_variants)),
                "variants_first_step_only": inferred_first_only,
            }
            return await _execute_outreach_tool(
                "create_sequence",
                create_args,
                chat_id=chat_id,
                user_id=user_id,
                meta=meta,
                ai_provider=ai_provider,
            )

        # Fallback for incomplete legacy contexts.
        suggested = params.get("suggested_name") or meta.get("base_name") or "Pigeon Outreach"
        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply or f"I'll call this sequence **{suggested}**. Reply \"yes\" to keep it, or type a different name.",
        )
        meta["pending_name_confirm"] = {
            "suggested_name": suggested,
            "topic": params.get("topic", ""),
            "steps": int(params.get("steps") or 1),
            "variants": int(params.get("variants") or 1),
            "variants_first_step_only": bool(params.get("variants_first_step_only")),
        }
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "reply_only":
        content = (
            reply
            or "How can I help? You can create your first email, add follow-ups, pick a list, pick an inbox, or create a campaign."
        )
        m = await _append_assistant_message(chat_id, user_id, content)
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "show_list_picker":
        # Frontend will render list picker from ui_actions + message payload.
        lists_cursor = await db.contact_lists.find(
            {"user_id": user_id},
            {"_id": 0, "id": 1, "name": 1, "contact_ids": 1, "contact_count": 1},
        ).to_list(None)
        lists_payload = [
            {
                "id": l.get("id"),
                "name": l.get("name"),
                "contact_count": l.get("contact_count")
                or (l.get("contact_ids") and len(l.get("contact_ids")))
                or 0,
            }
            for l in lists_cursor
            if l.get("id")
        ]
        ui_actions.append({"type": "show_list_picker", "lists": lists_payload})
        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply or "Pick which contact list to use for this campaign:",
            payload={"listCard": {"lists": lists_payload}},
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "select_list":
        list_id = params.get("list_id")
        if list_id:
            meta["selected_list_id"] = list_id
            lst = await db.contact_lists.find_one(
                {"id": list_id, "user_id": user_id},
                {"_id": 0, "name": 1},
            )
            list_name = lst.get("name") if lst else None
            m = await _append_assistant_message(
                chat_id,
                user_id,
                reply
                or (
                    f"Using list: **{list_name}**"
                    if list_name
                    else "List selected for this campaign."
                ),
            )
            new_messages.append(m)
        else:
            m = await _append_assistant_message(
                chat_id,
                user_id,
                reply or "Pick a list from the options above.",
            )
            new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "ask_preview_or_inbox":
        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply
            or "Would you like to **preview** your email(s) or **proceed to select sending inbox**?",
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "show_inbox_picker":
        inboxes = await db.inboxes.find(
            {"user_id": user_id},
            {"_id": 0},
        ).to_list(None)
        ui_actions.append({"type": "show_inbox_picker", "inboxes": inboxes})
        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply
            or "Which email account(s) should we send from? Pick one or more:",
            payload={"inboxCard": {"inboxes": inboxes}},
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "show_preview":
        template_id = params.get("template_id")
        if template_id:
            ui_actions.append({"type": "show_preview", "template_id": template_id})
        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply or "Here's a preview of your email.",
            payload={"preview": {"template_id": template_id}} if template_id else None,
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "show_existing_campaign":
        campaign_id = params.get("campaign_id") or meta.get("created_campaign_id")
        if campaign_id:
            campaign = await db.campaigns.find_one(
                {"id": campaign_id},
                {"_id": 0, "name": 1, "status": 1},
            )
        else:
            campaign = None
        payload_out: Dict[str, Any] = {}
        if campaign_id:
            payload_out["campaignCreated"] = {
                "campaignId": campaign_id,
                "campaignName": (campaign or {}).get("name") or "Your campaign",
                "started": (campaign or {}).get("status") == "active",
            }
        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply
            or "You already have a campaign for this sequence. I can update it, start it, or you can open it to edit.",
            payload=payload_out or None,
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "create_sequence":
        list_id = meta.get("selected_list_id")
        if not list_id:
            m = await _append_assistant_message(
                chat_id,
                user_id,
                "Pick a contact list first. Emails will use only the info we have for that list (e.g. first name, company).",
            )
            new_messages.append(m)
            ui_actions.append({"type": "show_list_picker"})
            return meta, new_messages, ui_actions

        base_name = (params.get("base_name") or meta.get("base_name") or "Pigeon Outreach").strip()[:40]
        prompt_text = (params.get("prompt") or meta.get("campaign_topic") or "").strip()
        if not prompt_text:
            meta["pending_sequence_ask"] = "topic"
            m = await _append_assistant_message(
                chat_id,
                user_id,
                reply or "What should these emails be about? (e.g. cold outreach, product launch, re-engaging leads). Describe your campaign in a few words.",
            )
            new_messages.append(m)
            return meta, new_messages, ui_actions

        links = (params.get("links") or "").strip()
        details = (params.get("details") or "").strip()
        campaign_context = prompt_text
        if links:
            campaign_context += "\n\nLinks to include where relevant: " + links
        if details:
            campaign_context += "\n\nAdditional details: " + details

        steps_count = min(10, max(1, int(params.get("count") or 1)))
        variants_per = min(5, max(1, int(params.get("variants_per_step") or 1)))
        variants_first_only = bool(params.get("variants_first_step_only"))

        # Check if email format has been selected; if not, pause and ask before generating.
        selected_body_type = (
            params.get("body_type")
            or meta.get("selected_body_type")
        )
        if not selected_body_type:
            # Store the creation params so we can resume after format is chosen.
            meta["pending_sequence_ask"] = "format"
            meta["pending_format_select"] = True
            meta["pending_format_select_args"] = {
                "base_name": base_name,
                "prompt": campaign_context,
                "count": steps_count,
                "variants_per_step": variants_per,
                "variants_first_step_only": variants_first_only,
            }
            m = await _append_assistant_message(
                chat_id,
                user_id,
                "**What format should the emails be in?**",
                payload={"formatCard": True},
            )
            new_messages.append(m)
            return meta, new_messages, ui_actions

        compliance = await _get_user_compliance(user_id)
        variable_restriction = ""
        contact_list = await db.contact_lists.find_one({"id": list_id, "user_id": user_id})
        if contact_list:
            cids = contact_list.get("contact_ids") or []
            contacts = await db.contacts.find(
                {"id": {"$in": cids[:200]}, "user_id": user_id},
                {"_id": 0},
            ).limit(CONTACT_SAMPLE_SIZE).to_list(None)
            common_vars = _get_common_variable_names(contacts)
            variable_restriction = _build_variable_restriction(common_vars)
        compliance_prompt = _build_compliance_prompt(compliance)

        # sequence_number: same for all variants of a step (S1-V1 and S1-V2 both have sequence_number 1)
        seq_num_by_step: Dict[int, int] = {}
        all_existing = await db.templates.find({"user_id": user_id}, {"_id": 0, "name": 1, "sequence_number": 1}).to_list(None)
        for t in all_existing:
            nm = t.get("name") or ""
            mat = re.match(r"^(.+?)\s*-\s*S(\d+)\s*-\s*V\d+$", nm)
            if mat and mat.group(1).strip() == base_name:
                s_val = int(mat.group(2))
                seq_num_by_step[s_val] = t.get("sequence_number") or s_val
        next_seq = max(seq_num_by_step.values(), default=0) + 1 if seq_num_by_step else 1

        for S in range(1, steps_count + 1):
            if S not in seq_num_by_step:
                seq_num_by_step[S] = next_seq
                next_seq += 1

        # Kick off background generation and stream live progress to frontend via SSE.
        job_id = str(uuid_module.uuid4())
        _GEN_JOB_QUEUES[job_id] = asyncio.Queue(maxsize=256)
        _GEN_JOB_META[job_id] = {"user_id": user_id, "chat_id": chat_id}
        meta["generation_job_id"] = job_id
        meta["base_name"] = base_name
        meta["last_action"] = "create_sequence"
        meta["just_created_templates"] = True
        meta["selected_body_type"] = selected_body_type
        meta.pop("pending_name_confirm", None)
        meta.pop("pending_format_select", None)

        async def _job_wrapper():
            try:
                await _run_sequence_generation_job(
                    job_id=job_id,
                    chat_id=chat_id,
                    user_id=user_id,
                    ai_provider=ai_provider or "openai",
                    base_name=base_name,
                    campaign_context=campaign_context,
                    steps_count=steps_count,
                    variants_per=variants_per,
                    variants_first_only=variants_first_only,
                    variable_restriction=variable_restriction,
                    compliance_prompt=compliance_prompt,
                    seq_num_by_step=seq_num_by_step,
                    body_type=selected_body_type,
                )
            finally:
                # Keep queue for a short grace period for late subscribers/reconnects.
                await asyncio.sleep(60)
                _GEN_JOB_TASKS.pop(job_id, None)
                _GEN_JOB_META.pop(job_id, None)
                _GEN_JOB_QUEUES.pop(job_id, None)

        _GEN_JOB_TASKS[job_id] = asyncio.create_task(_job_wrapper())

        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply
            or f"Okay, I'm starting to create {steps_count} email step(s), each with {variants_per} version(s). You'll see each email as soon as it's ready.",
            payload={"generationJobId": job_id, "steps": steps_count, "variants": variants_per},
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "update_template":
        template_id = (params.get("template_id") or "").strip()
        template_ids = params.get("template_ids") or []
        if not isinstance(template_ids, list):
            template_ids = []
        instruction = (params.get("instruction") or "").strip()
        if not instruction:
            m = await _append_assistant_message(
                chat_id, user_id,
                reply or "What change would you like me to make to this email?",
            )
            new_messages.append(m)
            return meta, new_messages, ui_actions
        # If no specific template is tagged, update all templates in this chat.
        target_ids: list[str]
        if template_ids:
            target_ids = []
            for tid in template_ids:
                if isinstance(tid, str) and tid.strip():
                    target_ids.append(tid.strip())
        elif template_id:
            target_ids = [template_id]
        else:
            target_ids = [tid for tid in (meta.get("created_template_ids") or []) if isinstance(tid, str) and tid]
            # Prefer full sequence scope by base_name so "update all" covers S1..Sn / V1..Vn
            # even when chat meta has partial/stale template ids.
            base_name = str(meta.get("base_name") or "").strip()
            if base_name:
                escaped = re.escape(base_name)
                seq_regex = rf"^{escaped}\s*-\s*S\d+\s*-\s*V\d+$"
                seq_templates = await db.templates.find(
                    {"user_id": user_id, "name": {"$regex": seq_regex}},
                    {"_id": 0, "id": 1, "sequence_number": 1, "name": 1},
                ).to_list(None)
                seq_ids = [
                    str(t.get("id"))
                    for t in sorted(
                        seq_templates,
                        key=lambda x: (
                            int(x.get("sequence_number") or 0),
                            str(x.get("name") or ""),
                        ),
                    )
                    if t.get("id")
                ]
                if seq_ids:
                    target_ids = seq_ids
        # Keep order stable while removing duplicates.
        target_ids = list(dict.fromkeys(target_ids))
        if not target_ids:
            m = await _append_assistant_message(
                chat_id,
                user_id,
                reply or "I couldn't find any emails in this chat to update.",
            )
            new_messages.append(m)
            return meta, new_messages, ui_actions

        job_id = str(uuid_module.uuid4())
        _GEN_JOB_QUEUES[job_id] = asyncio.Queue(maxsize=256)
        _GEN_JOB_META[job_id] = {"user_id": user_id, "chat_id": chat_id}
        meta["generation_job_id"] = job_id
        meta["last_action"] = "update_template"

        async def _job_wrapper():
            try:
                await _run_update_templates_job(
                    job_id=job_id,
                    chat_id=chat_id,
                    user_id=user_id,
                    ai_provider=ai_provider or "openai",
                    target_ids=target_ids,
                    instruction=instruction,
                )
            finally:
                await asyncio.sleep(60)
                _GEN_JOB_TASKS.pop(job_id, None)
                _GEN_JOB_META.pop(job_id, None)
                _GEN_JOB_QUEUES.pop(job_id, None)

        _GEN_JOB_TASKS[job_id] = asyncio.create_task(_job_wrapper())

        m = await _append_assistant_message(
            chat_id,
            user_id,
            reply or f"Updating **{len(target_ids)}** template(s). I'll stream each updated template live.",
            payload={"generationJobId": job_id, "mode": "update", "count": len(target_ids)},
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "delete_template":
        ids_to_del = params.get("template_ids") or ([params.get("template_id")] if params.get("template_id") else [])
        ids_to_del = [x for x in ids_to_del if x]
        if not ids_to_del:
            m = await _append_assistant_message(
                chat_id, user_id,
                reply or "Which email(s) do you want to delete? Tell me the name or select from the list.",
            )
            new_messages.append(m)
            return meta, new_messages, ui_actions
        deleted = []
        for tid in ids_to_del:
            used = await db.campaigns.count_documents({"template_ids": tid})
            if used > 0:
                m = await _append_assistant_message(
                    chat_id, user_id,
                    f"Cannot delete template **{tid[:8]}...**: it's used by a campaign. Remove it from the campaign first.",
                )
                new_messages.append(m)
                return meta, new_messages, ui_actions
            res = await db.templates.delete_one({"id": tid, "user_id": user_id})
            if res.deleted_count:
                deleted.append(tid)
        if deleted:
            meta["created_template_ids"] = [x for x in (meta.get("created_template_ids") or []) if x not in deleted]
        names = ", ".join(deleted[:5]) if deleted else "none"
        m = await _append_assistant_message(
            chat_id, user_id,
            reply or f"Deleted {len(deleted)} template(s): {names}.",
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "create_template":
        list_id = meta.get("selected_list_id")
        if not list_id:
            m = await _append_assistant_message(
                chat_id, user_id,
                "Pick a contact list first.",
            )
            new_messages.append(m)
            ui_actions.append({"type": "show_list_picker"})
            return meta, new_messages, ui_actions
        prompt_text = (params.get("prompt") or meta.get("campaign_topic") or "").strip()
        if not prompt_text:
            meta["pending_sequence_ask"] = "topic"
            m = await _append_assistant_message(
                chat_id, user_id,
                reply or "What should this email be about? Describe it in a few words.",
            )
            new_messages.append(m)
            return meta, new_messages, ui_actions
        base_name = (meta.get("base_name") or "Pigeon Outreach").strip()[:40]
        compliance = await _get_user_compliance(user_id)
        variable_restriction = ""
        contact_list = await db.contact_lists.find_one({"id": list_id, "user_id": user_id})
        if contact_list:
            cids = contact_list.get("contact_ids") or []
            contacts = await db.contacts.find(
                {"id": {"$in": cids[:200]}, "user_id": user_id},
                {"_id": 0},
            ).limit(CONTACT_SAMPLE_SIZE).to_list(None)
            common_vars = _get_common_variable_names(contacts)
            variable_restriction = _build_variable_restriction(common_vars)
        compliance_prompt = _build_compliance_prompt(compliance)
        framework_instruction = _get_random_framework()
        full_prompt = FULL_TEMPLATE_PREFIX + framework_instruction + variable_restriction + compliance_prompt + "\n\n" + prompt_text
        try:
            content = await llm_service.generate_text(user_id, ai_provider or "openai", full_prompt)
        except Exception:
            m = await _append_assistant_message(chat_id, user_id, "Something went wrong generating the email.")
            new_messages.append(m)
            return meta, new_messages, ui_actions
        parsed = _parse_template_json(content or "")
        if not parsed:
            m = await _append_assistant_message(chat_id, user_id, "Could not parse the email. Try again with more detail.")
            new_messages.append(m)
            return meta, new_messages, ui_actions
        subject = str(parsed.get("subject") or "").strip() or "No subject"
        body_raw = str(parsed.get("body") or "").strip()
        body = body_raw if _looks_like_html(body_raw) else _plain_text_to_html(body_raw)
        if compliance.get("require_unsubscribe_link") and not _has_unsubscribe(body):
            body = body.rstrip() + DEFAULT_UNSUBSCRIBE
        all_existing = await db.templates.find({"user_id": user_id}, {"_id": 0, "name": 1, "sequence_number": 1}).to_list(None)
        seq_num = 1
        for t in all_existing:
            nm = t.get("name") or ""
            mat = re.match(r"^(.+?)\s*-\s*S(\d+)\s*-\s*V\d+$", nm)
            if mat and mat.group(1).strip() == base_name:
                seq_num = max(seq_num, (t.get("sequence_number") or 0) + 1)
        tid = str(uuid_module.uuid4())
        tmpl_name = parsed.get("name") or f"{base_name} - S1 - V1"
        template_doc = {
            "id": tid,
            "user_id": user_id,
            "name": tmpl_name,
            "subject": subject,
            "body": body,
            "body_type": "html",
            "sequence_number": seq_num,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        await db.templates.insert_one(template_doc)
        template_doc.pop("_id", None)
        meta["created_template_ids"] = (meta.get("created_template_ids") or []) + [tid]
        meta["base_name"] = base_name
        meta["last_action"] = "create_template"
        meta["just_created_templates"] = True
        m = await _append_assistant_message(
            chat_id, user_id,
            reply or f"Created **{tmpl_name}**. Would you like to **preview** or **proceed to select sending inbox**?",
            payload={"templateCards": [template_doc], "previewOrInboxChoice": True},
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "add_follow_up":
        list_id = meta.get("selected_list_id")
        if not list_id:
            m = await _append_assistant_message(chat_id, user_id, "Pick a contact list first.")
            new_messages.append(m)
            ui_actions.append({"type": "show_list_picker"})
            return meta, new_messages, ui_actions
        base_name = (meta.get("base_name") or "Pigeon Outreach").strip()[:40]
        prompt_text = (params.get("prompt") or "").strip() or "Polite follow-up email."
        compliance = await _get_user_compliance(user_id)
        variable_restriction = ""
        contact_list = await db.contact_lists.find_one({"id": list_id, "user_id": user_id})
        if contact_list:
            cids = contact_list.get("contact_ids") or []
            contacts = await db.contacts.find(
                {"id": {"$in": cids[:200]}, "user_id": user_id},
                {"_id": 0},
            ).limit(CONTACT_SAMPLE_SIZE).to_list(None)
            common_vars = _get_common_variable_names(contacts)
            variable_restriction = _build_variable_restriction(common_vars)
        compliance_prompt = _build_compliance_prompt(compliance)
        all_existing = await db.templates.find({"user_id": user_id}, {"_id": 0, "name": 1, "sequence_number": 1}).to_list(None)
        max_step = 0
        next_seq = 1
        for t in all_existing:
            nm = t.get("name") or ""
            mat = re.match(r"^(.+?)\s*-\s*S(\d+)\s*-\s*V\d+$", nm)
            if mat and mat.group(1).strip() == base_name:
                s_val = int(mat.group(2))
                max_step = max(max_step, s_val)
                next_seq = max(next_seq, (t.get("sequence_number") or 0) + 1)
        next_step = max_step + 1
        step_prompt = f"Follow-up email, step {next_step}. Context: {prompt_text}. Keep it concise and natural."
        framework_instruction = _get_random_framework()
        full_prompt = FULL_TEMPLATE_PREFIX + framework_instruction + variable_restriction + compliance_prompt + "\n\n" + step_prompt
        try:
            content = await llm_service.generate_text(user_id, ai_provider or "openai", full_prompt)
        except Exception:
            m = await _append_assistant_message(chat_id, user_id, "Something went wrong generating the follow-up.")
            new_messages.append(m)
            return meta, new_messages, ui_actions
        parsed = _parse_template_json(content or "")
        if not parsed:
            m = await _append_assistant_message(chat_id, user_id, "Could not parse the follow-up. Try again.")
            new_messages.append(m)
            return meta, new_messages, ui_actions
        subject = str(parsed.get("subject") or "").strip() or "No subject"
        body_raw = str(parsed.get("body") or "").strip()
        body = body_raw if _looks_like_html(body_raw) else _plain_text_to_html(body_raw)
        if compliance.get("require_unsubscribe_link") and not _has_unsubscribe(body):
            body = body.rstrip() + DEFAULT_UNSUBSCRIBE
        tid = str(uuid_module.uuid4())
        tmpl_name = f"{base_name} - S{next_step} - V1"
        template_doc = {
            "id": tid,
            "user_id": user_id,
            "name": tmpl_name,
            "subject": subject,
            "body": body,
            "body_type": "html",
            "sequence_number": next_seq,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        await db.templates.insert_one(template_doc)
        template_doc.pop("_id", None)
        meta["created_template_ids"] = (meta.get("created_template_ids") or []) + [tid]
        meta["base_name"] = base_name
        meta["last_action"] = "add_follow_up"
        meta["just_created_templates"] = True
        m = await _append_assistant_message(
            chat_id, user_id,
            reply or f"Added follow-up **{tmpl_name}**. Would you like to **preview** or **proceed to select sending inbox**?",
            payload={"templateCards": [template_doc], "previewOrInboxChoice": True},
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "add_variants":
        list_id = meta.get("selected_list_id")
        if not list_id:
            m = await _append_assistant_message(chat_id, user_id, "Pick a contact list first.")
            new_messages.append(m)
            ui_actions.append({"type": "show_list_picker"})
            return meta, new_messages, ui_actions
        base_name = (meta.get("base_name") or "Pigeon Outreach").strip()[:40]
        prompt_text = (params.get("prompt") or "").strip() or "Variant for A/B testing, keep distinct."
        compliance = await _get_user_compliance(user_id)
        variable_restriction = ""
        contact_list = await db.contact_lists.find_one({"id": list_id, "user_id": user_id})
        if contact_list:
            cids = contact_list.get("contact_ids") or []
            contacts = await db.contacts.find(
                {"id": {"$in": cids[:200]}, "user_id": user_id},
                {"_id": 0},
            ).limit(CONTACT_SAMPLE_SIZE).to_list(None)
            common_vars = _get_common_variable_names(contacts)
            variable_restriction = _build_variable_restriction(common_vars)
        compliance_prompt = _build_compliance_prompt(compliance)
        existing = await db.templates.find(
            {"user_id": user_id},
            {"_id": 0, "id": 1, "name": 1, "subject": 1, "body": 1, "sequence_number": 1},
        ).to_list(None)
        by_step: Dict[int, List[dict]] = {}
        for t in existing:
            nm = t.get("name") or ""
            mat = re.match(r"^(.+?)\s*-\s*S(\d+)\s*-\s*V(\d+)$", nm)
            if mat and mat.group(1).strip() == base_name:
                s_val = int(mat.group(2))
                by_step.setdefault(s_val, []).append(t)
        if not by_step:
            m = await _append_assistant_message(
                chat_id, user_id,
                reply or f"No templates found for **{base_name}**. Create a sequence first, then add variants.",
            )
            new_messages.append(m)
            return meta, new_messages, ui_actions
        templates_created = []
        for S, step_templates in sorted(by_step.items()):
            v_nums = [int(m.group(1)) for t in step_templates for m in [re.match(r".*V(\d+)$", t.get("name", ""))] if m]
            max_v = max(v_nums) if v_nums else 0
            next_v = max_v + 1
            step_prompt = f"Variant {next_v} for step {S}. Context: {prompt_text}. Keep it distinct for A/B testing."
            framework_instruction = _get_random_framework()
            full_prompt = FULL_TEMPLATE_PREFIX + framework_instruction + variable_restriction + compliance_prompt + "\n\n" + step_prompt
            try:
                content = await llm_service.generate_text(user_id, ai_provider or "openai", full_prompt)
            except Exception:
                continue
            parsed = _parse_template_json(content or "")
            if not parsed:
                continue
            subject = str(parsed.get("subject") or "").strip() or "No subject"
            body_raw = str(parsed.get("body") or "").strip()
            body = body_raw if _looks_like_html(body_raw) else _plain_text_to_html(body_raw)
            if compliance.get("require_unsubscribe_link") and not _has_unsubscribe(body):
                body = body.rstrip() + DEFAULT_UNSUBSCRIBE
            seq_num = (step_templates[0].get("sequence_number") or S)
            tid = str(uuid_module.uuid4())
            tmpl_name = f"{base_name} - S{S} - V{next_v}"
            template_doc = {
                "id": tid,
                "user_id": user_id,
                "name": tmpl_name,
                "subject": subject,
                "body": body,
                "body_type": "html",
                "sequence_number": seq_num,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            await db.templates.insert_one(template_doc)
            template_doc.pop("_id", None)
            templates_created.append(template_doc)
            meta["created_template_ids"] = (meta.get("created_template_ids") or []) + [tid]
        if not templates_created:
            m = await _append_assistant_message(chat_id, user_id, "Could not add variants. Try again.")
            new_messages.append(m)
            return meta, new_messages, ui_actions
        meta["base_name"] = base_name
        meta["last_action"] = "add_variants"
        meta["just_created_templates"] = True
        names_str = ", ".join(t.get("name", "") for t in templates_created[:10])
        m = await _append_assistant_message(
            chat_id, user_id,
            reply or f"Added variant(s): **{names_str}**. Would you like to **preview** or **proceed to select sending inbox**?",
            payload={"templateCards": templates_created, "previewOrInboxChoice": True},
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "create_campaign":
        # Remember that the user is trying to create a campaign, even if
        # we still need to collect missing pieces (like inbox selection).
        meta["last_action"] = "create_campaign"
        list_id = meta.get("selected_list_id")
        template_ids = meta.get("created_template_ids") or []
        inbox_ids = meta.get("selected_inbox_ids") or []
        if meta.get("created_campaign_id"):
            m = await _append_assistant_message(
                chat_id, user_id,
                reply or "You already have a campaign for this sequence. I can update it or you can open it from Campaigns.",
            )
            new_messages.append(m)
            ui_actions.append({"type": "show_existing_campaign"})
            return meta, new_messages, ui_actions
        # Checklist: list, templates, inbox required before creating campaign
        if not list_id:
            m = await _append_assistant_message(
                chat_id, user_id,
                reply or "**Contact list** — Pick which contacts to send to first. Then we can create the campaign.",
            )
            new_messages.append(m)
            ui_actions.append({"type": "show_list_picker"})
            return meta, new_messages, ui_actions
        if not template_ids:
            m = await _append_assistant_message(
                chat_id, user_id,
                reply or "**Templates ready** — Create at least one email first. Tell me what the campaign is about and I'll write the emails, or use the buttons below.",
            )
            new_messages.append(m)
            return meta, new_messages, ui_actions
        if not inbox_ids:
            inboxes = await db.inboxes.find(
                {"user_id": user_id},
                {"_id": 0},
            ).to_list(None)
            ui_actions.append({"type": "show_inbox_picker", "inboxes": inboxes})
            m = await _append_assistant_message(
                chat_id, user_id,
                reply or "**Sending inbox** — Which email account(s) should we send from? Pick one or more (e.g. Gmail or connected inbox):",
                payload={"inboxCard": {"inboxes": inboxes}},
            )
            new_messages.append(m)
            return meta, new_messages, ui_actions
        base_name = meta.get("base_name") or "Pigeon Outreach"
        templates_ordered = await db.templates.find(
            {"id": {"$in": template_ids}, "user_id": user_id},
            {"_id": 0, "id": 1, "sequence_number": 1},
        ).sort("sequence_number", 1).to_list(None)
        tid_list = [t["id"] for t in templates_ordered if t.get("id") in template_ids]
        if not tid_list:
            tid_list = template_ids
        campaign_id = str(uuid_module.uuid4())
        first_inbox = await db.inboxes.find_one({"id": inbox_ids[0], "user_id": user_id}, {"_id": 0, "sender_type": 1}) if inbox_ids else None
        sender_type = (first_inbox or {}).get("sender_type") or "gmail"
        campaign_doc = {
            "id": campaign_id,
            "user_id": user_id,
            "name": base_name,
            "template_ids": tid_list,
            "contact_list_ids": [list_id],
            "contact_ids": [],
            "status": "draft",
            "daily_limit": 50,
            "sender_type": sender_type,
            "sender_ids": inbox_ids,
            "updated_at": datetime.now(timezone.utc),
            "created_at": datetime.now(timezone.utc),
        }
        await db.campaigns.insert_one(campaign_doc)
        meta["created_campaign_id"] = campaign_id
        m = await _append_assistant_message(
            chat_id, user_id,
            reply or f"Created campaign **{base_name}**. It's in draft. You can start it from the Campaigns page or tell me to start it.",
            payload={"campaignCreated": {"campaignId": campaign_id, "campaignName": base_name, "started": False}},
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    if tool == "update_campaign":
        campaign_id = params.get("campaign_id") or meta.get("created_campaign_id")
        if not campaign_id:
            m = await _append_assistant_message(
                chat_id, user_id,
                reply or "Create a campaign first, or tell me which campaign to update.",
            )
            new_messages.append(m)
            return meta, new_messages, ui_actions
        existing = await db.campaigns.find_one({"id": campaign_id, "user_id": user_id}, {"_id": 0})
        if not existing:
            m = await _append_assistant_message(chat_id, user_id, "Campaign not found.")
            new_messages.append(m)
            return meta, new_messages, ui_actions
        instruction = (params.get("instruction") or "").strip()
        updates: Dict[str, Any] = {}
        if instruction:
            prompt = f"""Given campaign: name="{existing.get('name','')}", daily_limit={existing.get('daily_limit',50)}.
User instruction: {instruction}
Return JSON with only the fields to change (name, daily_limit, template_ids). No markdown. Example: {{"daily_limit": 100}}"""
            try:
                content = await llm_service.generate_text(user_id, ai_provider or "openai", prompt)
                parsed = _parse_template_json(content or "") or {}
            except Exception:
                parsed = {}
            if isinstance(parsed, dict):
                if "name" in parsed:
                    updates["name"] = str(parsed["name"])[:80]
                if "daily_limit" in parsed:
                    # Respect the campaign's configured daily_limit. Only enforce a lower bound of 1.
                    updates["daily_limit"] = max(1, int(parsed.get("daily_limit", 50)))
                if "template_ids" in parsed and isinstance(parsed["template_ids"], list):
                    updates["template_ids"] = parsed["template_ids"]
        for key in ("name", "daily_limit", "template_ids"):
            if key in params and params[key] is not None:
                if key == "daily_limit":
                    # Respect explicit daily_limit value, clamping only to a minimum of 1.
                    updates["daily_limit"] = max(1, int(params[key]))
                elif key == "template_ids":
                    updates["template_ids"] = params[key]
                else:
                    updates[key] = params[key]
        if updates:
            updates["updated_at"] = datetime.now(timezone.utc)
            await db.campaigns.update_one(
                {"id": campaign_id, "user_id": user_id},
                {"$set": updates},
            )
        m = await _append_assistant_message(
            chat_id, user_id,
            reply or "Campaign updated.",
        )
        new_messages.append(m)
        return meta, new_messages, ui_actions

    # Fallback for tools that are not yet fully implemented on the backend.
    m = await _append_assistant_message(
        chat_id,
        user_id,
        reply
        or f"I recognized the action **{tool}**, but this automated step isn't fully wired up on the backend yet. You can continue using the existing buttons and campaign pages for this part.",
    )
    new_messages.append(m)
    return meta, new_messages, ui_actions


async def _execute_outreach_steps(
    steps: List[Dict[str, Any]],
    *,
    chat_id: str,
    user_id: str,
    meta: Dict[str, Any],
    ai_provider: str = "",
) -> tuple[Dict[str, Any], List[dict], List[dict]]:
    """Execute an ordered list of outreach tools and aggregate results."""
    # Merge repeated one-by-one update_template steps into a single batch update.
    normalized_steps: List[Dict[str, Any]] = []
    i = 0
    while i < len(steps):
        step = steps[i] or {}
        raw_tool = step.get("tool") or ""
        tool = _normalize_tool(raw_tool) or raw_tool
        args = step.get("args") or step.get("params") or {}
        instruction = str(args.get("instruction") or "").strip()
        template_id = str(args.get("template_id") or "").strip()
        if tool != "update_template" or not instruction or not template_id:
            normalized_steps.append(step)
            i += 1
            continue

        merged_ids: List[str] = [template_id]
        reply = args.get("_reply")
        j = i + 1
        while j < len(steps):
            next_step = steps[j] or {}
            next_tool_raw = next_step.get("tool") or ""
            next_tool = _normalize_tool(next_tool_raw) or next_tool_raw
            next_args = next_step.get("args") or next_step.get("params") or {}
            next_instruction = str(next_args.get("instruction") or "").strip()
            next_template_id = str(next_args.get("template_id") or "").strip()
            if next_tool != "update_template" or next_instruction != instruction or not next_template_id:
                break
            merged_ids.append(next_template_id)
            j += 1

        normalized_steps.append(
            {
                "tool": "update_template",
                "args": {
                    "template_ids": list(dict.fromkeys(merged_ids)),
                    "instruction": instruction,
                    "_reply": reply,
                },
            }
        )
        i = j

    all_messages: List[dict] = []
    all_ui_actions: List[dict] = []
    current_meta = dict(meta or {})
    for step in normalized_steps:
        raw_tool = step.get("tool") or ""
        tool = _normalize_tool(raw_tool) or raw_tool
        args = step.get("args") or step.get("params") or {}
        current_meta, new_messages, new_ui = await _execute_outreach_tool(
            tool,
            args,
            chat_id=chat_id,
            user_id=user_id,
            meta=current_meta,
            ai_provider=ai_provider,
        )
        all_messages.extend(new_messages)
        all_ui_actions.extend(new_ui)
    return current_meta, all_messages, all_ui_actions


@router.post("/intent", response_model=OutreachIntentResponse)
async def get_outreach_intent(request: OutreachIntentRequest):
    """
    Return structured intent (action + params + reply) from the user message using policy/function mapping.
    Frontend executes the action; this endpoint does not perform any side effects.
    """
    if llm_service is None:
        raise HTTPException(status_code=500, detail="LLM service not initialized")
    try:
        prompt = _build_prompt(request)
        content = await llm_service.generate_text(
            request.user_id,
            request.provider,
            prompt,
        )
        data = _parse_intent_response(content)
        action = (data.get("action") or "").strip()
        action = ACTION_ALIASES.get(action.lower(), action) if action else action
        ctx = request.context
        if action not in OUTREACH_ACTIONS:
            # Map unknown actions (including reply_only) to a concrete tool based on context.
            params = data.get("params") or {}
            if ctx and ctx.sequence_steps is not None and ctx.sequence_variants is None:
                action = "ask_variants"
                data["params"] = params
            elif not ctx or not ctx.selected_list_id:
                action = "show_list_picker"
                data["params"] = {}
            elif not (ctx.templates_in_session or []):
                # Check if topic is already known before re-asking it
                _topic_known = bool(ctx.campaign_topic) or (
                    ctx.recent_messages is not None and _topic_already_in_recent(
                        [{"role": m.get("role", ""), "content": m.get("content", "")} for m in (ctx.recent_messages or [])]
                    )[0]
                )
                action = "ask_steps" if _topic_known else "ask_topic"
                data["params"] = {}
            else:
                action = "ask_preview_or_inbox"
                data["params"] = {}
        # Also guard: if LLM returned ask_topic but topic is already known, advance to ask_steps
        elif action == "ask_topic" and ctx:
            _topic_known = bool(ctx.campaign_topic) or (
                ctx.recent_messages is not None and _topic_already_in_recent(
                    [{"role": m.get("role", ""), "content": m.get("content", "")} for m in (ctx.recent_messages or [])]
                )[0]
            )
            if _topic_known:
                action = "ask_steps"
                data["params"] = {}
        params = data.get("params")
        if params is None:
            params = {}
        reply = data.get("reply")
        steps = data.get("steps")
        if not steps or not isinstance(steps, list):
            steps = [{"tool": action, "args": {**params, "_reply": reply}}]
        return OutreachIntentResponse(action=action, params=params, reply=reply, steps=steps)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"LLM returned invalid JSON: {e}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/generation/{job_id}/stream")
async def stream_generation_job(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    """SSE stream for live AI sequence generation progress."""
    owner = _GEN_JOB_META.get(job_id, {}).get("user_id")
    if not owner or owner != current_user["id"]:
        raise HTTPException(status_code=404, detail="Generation job not found")
    q = _GEN_JOB_QUEUES.get(job_id)
    if not q:
        raise HTTPException(status_code=404, detail="Generation job not found")

    async def _stream():
        yield _sse_pack("open", {"type": "open", "job_id": job_id})
        while True:
            event = await q.get()
            event_type = str(event.get("type") or "message")
            yield _sse_pack(event_type, event)
            if event_type in ("done", "failed"):
                break

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/chats/{chat_id}/act", response_model=OutreachActResponse)
async def act_on_outreach_chat(
    chat_id: str,
    body: OutreachActRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Backend-orchestrated AI Campaign Studio turn.

    - Appends the user message to the chat.
    - Builds LLM intent context from chat meta + DB.
    - Calls LLM with the outreach policy prompt.
    - Executes returned steps (tools) on the backend.
    - Persists assistant messages and updated chat meta.
    - Returns new messages + UI actions + high-level state.
    """
    if llm_service is None:
        raise HTTPException(status_code=500, detail="LLM service not initialized")

    user_id = current_user["id"]
    if not body.ai_provider:
        raise HTTPException(
            status_code=400,
            detail="ai_provider is required for orchestrated outreach chat.",
        )

    # Ensure chat exists and load context.
    chat, ctx, messages, contact_lists = await _load_chat_context(chat_id, user_id)
    meta: Dict[str, Any] = dict(ctx.get("meta") or {})

    # When user selects list/inbox from UI, ui_hints carries the selection. Persist before LLM.
    user_message_text = body.message
    if body.ui_hints:
        if body.ui_hints.get("list_id"):
            meta["selected_list_id"] = body.ui_hints["list_id"]
            lst = next((l for l in contact_lists if l.get("id") == body.ui_hints["list_id"]), None)
            list_name = lst.get("name") if lst else None
            if not user_message_text.strip() or user_message_text.strip().lower() in ("select", "selected", "ok", "done"):
                user_message_text = f"I selected the list: {list_name or body.ui_hints['list_id']}"
        inbox_ids = body.ui_hints.get("inbox_ids")
        if isinstance(inbox_ids, list) and inbox_ids:
            meta["selected_inbox_ids"] = [str(x) for x in inbox_ids]
            if not user_message_text.strip() or user_message_text.strip().lower() in ("select", "selected", "ok", "done", "confirm"):
                user_message_text = "I selected the inbox(es) for sending."

    # Append the incoming user message to the chat history.
    user_msg = OutreachChatMessage(
        chat_id=chat_id,
        user_id=user_id,
        role=body.role,
        content=user_message_text,
        payload=body.ui_hints,
    )
    user_doc = user_msg.model_dump()
    await db.outreach_chat_messages.insert_one(user_doc)

    # Rebuild recent messages including the new one.
    messages.append(
        {
            "role": body.role,
            "content": user_message_text,
        }
    )
    ctx["messages"] = messages
    ctx["contact_lists"] = contact_lists
    ctx["meta"] = meta  # Updated meta (e.g. from ui_hints list selection)

    # Fast path: user chose email format (formatCard, or typed "Plain Text" / etc.).
    # Resume even if pending_format_select was lost in meta, as long as we are clearly
    # answering the format prompt (stored args or last assistant message).
    chosen_format = _parse_body_type_from_ui_or_text(body.ui_hints, user_message_text)
    can_resume_from_known_sequence_state = (
        bool(meta.get("selected_list_id"))
        and bool(str(meta.get("campaign_topic") or "").strip())
        and meta.get("sequence_steps") is not None
        and meta.get("sequence_variants") is not None
        and not meta.get("generation_job_id")
    )
    if chosen_format:
        # Persist chosen format immediately, even if the flow is otherwise out of sync.
        # This prevents repeated "What format..." loops from stale pending flags.
        meta["selected_body_type"] = chosen_format
        should_resume_now = _waiting_to_resume_format_selection(meta, messages) or can_resume_from_known_sequence_state
        if should_resume_now:
            meta.pop("pending_format_select", None)
            meta.pop("pending_sequence_ask", None)
            pfs = meta.pop("pending_format_select_args", None) or {}
            create_args = {
                "base_name": pfs.get("base_name") or meta.get("base_name") or "Pigeon Outreach",
                "prompt": pfs.get("prompt") or meta.get("campaign_topic") or "",
                "count": pfs.get("count") or meta.get("sequence_steps") or 1,
                "variants_per_step": pfs.get("variants_per_step") or meta.get("sequence_variants") or 1,
                "variants_first_step_only": pfs.get("variants_first_step_only")
                if "variants_first_step_only" in pfs
                else bool(meta.get("sequence_variants_first_step_only")),
                "body_type": chosen_format,
            }
            next_steps = [{"tool": "create_sequence", "args": create_args}]
            updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
                next_steps,
                chat_id=chat_id,
                user_id=user_id,
                meta=meta,
                ai_provider=body.ai_provider,
            )
            await db.outreach_chats.update_one(
                {"id": chat_id, "user_id": user_id},
                {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
            )
            user_doc.pop("_id", None)
            return OutreachActResponse(
                messages=[user_doc] + new_messages,
                ui_actions=ui_actions,
                state=updated_meta,
            )

    # Fast path: "I selected the list" (from UI) — move to ask_topic
    if meta.get("selected_list_id") and _message_confirms_list_selection(user_message_text):
        steps = [{"tool": "ask_topic", "args": {}}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # Fast path: user replying to "what should these emails be about?" — persist topic, then ask steps.
    # Prefer explicit meta flag, but also support legacy chats without pending_sequence_ask='topic'.
    _topic_vague_replies = {"yes", "ok", "sure", "go", "yep", "yeah", "cool", "alright", "okay"}
    _topic_text = user_message_text.strip()
    _topic_is_substantive = (
        len(_topic_text) >= 2
        and _topic_text.lower() not in _topic_vague_replies
        and not _message_wants_campaign_only(_topic_text)
        and not _topic_text.isdigit()  # single number = answering steps/variants, not a topic
    )
    if (meta.get("pending_sequence_ask") == "topic" or _assistant_recently_asked_topic(messages)) and _topic_is_substantive:
        meta["campaign_topic"] = _topic_text
        meta.pop("pending_sequence_ask", None)
        # Decide next step based on what's already known
        if meta.get("sequence_steps") is not None and meta.get("sequence_variants") is None:
            _next_tool = "ask_variants"
        elif meta.get("sequence_steps") is not None and meta.get("sequence_variants") is not None:
            _next_tool = "create_sequence"
        else:
            _next_tool = "ask_steps"
        next_steps = [{"tool": _next_tool, "args": {}}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            next_steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # Fast path: user replying to "how many emails in the sequence?" — parse steps, then ask variants.
    # Prefer explicit meta flag, but also support legacy chats where only the assistant
    # question was stored (no pending_sequence_ask set).
    if (
        meta.get("pending_sequence_ask") == "steps"
        or (
            not meta.get("pending_sequence_ask")
            and meta.get("sequence_steps") is None
            and _assistant_recently_asked_steps(messages)
        )
    ):
        if not re.search(r"\b([1-9]|10)\b", user_message_text.strip()):
            updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
                [{"tool": "ask_steps", "args": {}}],
                chat_id=chat_id,
                user_id=user_id,
                meta=meta,
                ai_provider=body.ai_provider,
            )
            await db.outreach_chats.update_one(
                {"id": chat_id, "user_id": user_id},
                {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
            )
            user_doc.pop("_id", None)
            return OutreachActResponse(
                messages=[user_doc] + new_messages,
                ui_actions=ui_actions,
                state=updated_meta,
            )
        steps_count = _parse_steps_from_message(user_message_text)
        meta["sequence_steps"] = steps_count
        meta.pop("pending_sequence_ask", None)
        if meta.get("sequence_variants") is not None:
            next_steps = [{"tool": "create_sequence", "args": {}}]
        else:
            next_steps = [{"tool": "ask_variants", "args": {}}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            next_steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # Fast path: user replying to "how many A/B variations?" — parse variants, then create sequence.
    if (
        meta.get("pending_sequence_ask") == "variants"
        or (
            not meta.get("pending_sequence_ask")
            and meta.get("sequence_variants") is None
            and _assistant_recently_asked_variants(messages)
        )
    ):
        if not re.search(r"\b([1-5])\b", user_message_text.strip()):
            updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
                [{"tool": "ask_variants", "args": {}}],
                chat_id=chat_id,
                user_id=user_id,
                meta=meta,
                ai_provider=body.ai_provider,
            )
            await db.outreach_chats.update_one(
                {"id": chat_id, "user_id": user_id},
                {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
            )
            user_doc.pop("_id", None)
            return OutreachActResponse(
                messages=[user_doc] + new_messages,
                ui_actions=ui_actions,
                state=updated_meta,
            )
        variants_count, first_only = _parse_variants_from_message(user_message_text)
        meta["sequence_variants"] = variants_count
        meta["sequence_variants_first_step_only"] = first_only
        meta.pop("pending_sequence_ask", None)
        topic_given, topic_text = _topic_already_in_recent(messages)
        topic_for_name = topic_text if topic_given else (meta.get("campaign_topic") or "")
        steps_count = meta.get("sequence_steps") or 1
        # Derive a base name for the sequence. We no longer ask the user to confirm the name;
        # instead we immediately create the sequence using this name.
        base_name: str = (
            str(meta.get("base_name") or "").strip()
            or str((meta.get("pending_name_confirm") or {}).get("suggested_name") or "").strip()
            or "Pigeon Outreach"
        )
        # Fallback topic if we somehow can't recover it from recent messages.
        prompt_topic = topic_for_name or "cold outreach sequence"
        create_args = {
            "base_name": base_name[:40],
            "prompt": prompt_topic,
            "count": steps_count,
            "variants_per_step": variants_count,
            "variants_first_step_only": first_only,
        }
        next_steps = [{"tool": "create_sequence", "args": create_args}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            next_steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # Fast path: when no list selected and user clearly wants campaign/templates, show list picker immediately
    if not meta.get("selected_list_id") and _message_wants_list_or_sequence(user_message_text):
        steps = [{"tool": "show_list_picker", "args": {}}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # NOTE: We intentionally do NOT auto-create a sequence just because a topic
    # was given. Instead, we let the LLM follow the explicit flow:
    # ask_topic → ask_steps → ask_variants → ask_name_confirm → create_sequence.
    # This ensures the user is always asked how many emails/variants they want
    # before any templates are generated.

    # Fast path: when user says "create campaign" and we HAVE templates + list, create campaign immediately
    # (avoids LLM returning ask_topic and asking "what should these emails be about?" — emails already exist)
    if (
        _message_wants_campaign_only(user_message_text)
        and meta.get("selected_list_id")
        and (meta.get("created_template_ids") or [])
        and not meta.get("created_campaign_id")
    ):
        steps = [{"tool": "create_campaign", "args": {}}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # Fast path: explicit "update all templates/emails" should run one batch update job.
    if (meta.get("created_template_ids") or []) and _message_wants_update_all_templates(user_message_text):
        steps = [{"tool": "update_template", "args": {"instruction": user_message_text}}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # Fast path: user wants to add a follow-up (templates + list exist)
    if (
        meta.get("selected_list_id")
        and (meta.get("created_template_ids") or [])
        and _message_wants_add_follow_up(user_message_text)
    ):
        steps = [{"tool": "add_follow_up", "args": {"prompt": "Polite follow-up email."}}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # Fast path: user wants to pick inbox (templates exist) — show inbox picker
    if (meta.get("created_template_ids") or []) and _message_wants_inbox_picker(user_message_text):
        steps = [{"tool": "show_inbox_picker", "args": {}}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # Fast path: user wants preview (templates exist) — show preview
    if (meta.get("created_template_ids") or []) and _message_wants_preview(user_message_text):
        steps = [{"tool": "show_preview", "args": {}}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # Fast path: user confirmed inbox selection — acknowledge or auto-create campaign
    _msg_lower = user_message_text.strip().lower()
    if meta.get("selected_inbox_ids") and (
        "i selected the inbox" in _msg_lower or _msg_lower == "i selected the inbox(es) for sending."
    ):
        # If the user had just asked to create a campaign but we were
        # waiting on inbox selection, go ahead and create the campaign now.
        has_list = bool(meta.get("selected_list_id"))
        has_templates = bool(meta.get("created_template_ids") or [])
        has_campaign = bool(meta.get("created_campaign_id"))
        just_tried_create_campaign = meta.get("last_action") == "create_campaign"

        if has_list and has_templates and not has_campaign and just_tried_create_campaign:
            steps = [{
                "tool": "create_campaign",
                "args": {},
            }]
        else:
            steps = [{
                "tool": "reply_only",
                "args": {"reply": "You've selected your sending inbox. You can **create a campaign** when you're ready."},
            }]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    # Fast path: when list is selected and user asks to create templates/sequence.
    # Reuse known context so we don't repeatedly re-ask steps/variants/format.
    if meta.get("selected_list_id") and _message_wants_to_create(user_message_text):
        # If a generation job is already running, avoid restarting the questionnaire.
        if meta.get("generation_job_id"):
            steps = [{
                "tool": "reply_only",
                "args": {
                    "reply": "I'm already creating your templates now. As each email is ready, it will appear automatically in this chat.",
                },
            }]
            updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
                steps,
                chat_id=chat_id,
                user_id=user_id,
                meta=meta,
                ai_provider=body.ai_provider,
            )
            await db.outreach_chats.update_one(
                {"id": chat_id, "user_id": user_id},
                {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
            )
            user_doc.pop("_id", None)
            return OutreachActResponse(
                messages=[user_doc] + new_messages,
                ui_actions=ui_actions,
                state=updated_meta,
            )

        topic_given, _ = _topic_already_in_recent(messages)
        topic_known = topic_given or bool(meta.get("campaign_topic"))
        steps_known = meta.get("sequence_steps") is not None
        variants_known = meta.get("sequence_variants") is not None

        if topic_known and steps_known and variants_known:
            prompt_topic = str(meta.get("campaign_topic") or "").strip() or "cold outreach sequence"
            base_name = str(meta.get("base_name") or "").strip() or "Pigeon Outreach"
            create_args: Dict[str, Any] = {
                "base_name": base_name[:40],
                "prompt": prompt_topic,
                "count": int(meta.get("sequence_steps") or 1),
                "variants_per_step": int(meta.get("sequence_variants") or 1),
                "variants_first_step_only": bool(meta.get("sequence_variants_first_step_only")),
            }
            selected_body_type = str(meta.get("selected_body_type") or "").strip()
            if selected_body_type in ("html", "plain", "rich"):
                create_args["body_type"] = selected_body_type
            steps = [{"tool": "create_sequence", "args": create_args}]
        elif topic_known and steps_known and not variants_known:
            steps = [{"tool": "ask_variants", "args": {}}]
        elif topic_known:
            steps = [{"tool": "ask_steps", "args": {}}]
        else:
            steps = [{"tool": "ask_topic", "args": {}}]
        updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
            steps,
            chat_id=chat_id,
            user_id=user_id,
            meta=meta,
            ai_provider=body.ai_provider,
        )
        await db.outreach_chats.update_one(
            {"id": chat_id, "user_id": user_id},
            {"$set": {"meta": updated_meta, "updated_at": datetime.now(timezone.utc)}},
        )
        user_doc.pop("_id", None)
        return OutreachActResponse(
            messages=[user_doc] + new_messages,
            ui_actions=ui_actions,
            state=updated_meta,
        )

    intent_context = _build_outreach_intent_context(ctx)
    intent_request = OutreachIntentRequest(
        user_id=user_id,
        provider=body.ai_provider,
        message=user_message_text,
        context=intent_context,
    )

    try:
        prompt = _build_prompt(intent_request)
        content = await llm_service.generate_text(
            user_id,
            body.ai_provider,
            prompt,
        )
        data = _parse_intent_response(content)
        action = (data.get("action") or "").strip()
        # Resolve aliases (LLMs sometimes return create_email_campaign, start_campaign, etc.)
        action = ACTION_ALIASES.get(action.lower(), action) if action else action
        if action not in OUTREACH_ACTIONS:
            # Map unknown actions (including reply_only) to a concrete tool based on context.
            params = data.get("params") or {}
            ctx = intent_context
            if ctx and ctx.sequence_steps is not None and ctx.sequence_variants is None:
                action = "ask_variants"
                data["params"] = params
            elif not ctx or not ctx.selected_list_id:
                action = "show_list_picker"
                data["params"] = {}
            elif not (ctx.templates_in_session or []):
                # Check if topic is already known before re-asking it
                _topic_in_meta = bool(meta.get("campaign_topic"))
                _topic_in_msgs, _ = _topic_already_in_recent(messages)
                if _topic_in_meta or _topic_in_msgs:
                    action = "ask_steps"
                else:
                    action = "ask_topic"
                data["params"] = {}
            else:
                action = "ask_preview_or_inbox"
                data["params"] = {}
        # Also guard: if LLM returned ask_topic but topic is already known, advance to ask_steps
        elif action == "ask_topic":
            _topic_in_meta = bool(meta.get("campaign_topic"))
            _topic_in_msgs, _ = _topic_already_in_recent(messages)
            if _topic_in_meta or _topic_in_msgs:
                action = "ask_steps"
                data["params"] = {}
        params = data.get("params") or {}
        reply = data.get("reply")
        steps = data.get("steps")
        if not steps or not isinstance(steps, list):
            steps = [{"tool": action, "args": {**params, "_reply": reply}}]
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"LLM returned invalid JSON: {e}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Execute tools on backend and persist updated meta.
    updated_meta, new_messages, ui_actions = await _execute_outreach_steps(
        steps,
        chat_id=chat_id,
        user_id=user_id,
        meta=meta,
        ai_provider=body.ai_provider,
    )
    await db.outreach_chats.update_one(
        {"id": chat_id, "user_id": user_id},
        {
            "$set": {
                "meta": updated_meta,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    # Include user message so frontend can display it (backend already persisted it).
    user_doc.pop("_id", None)
    all_messages_for_response = [user_doc] + new_messages

    return OutreachActResponse(
        messages=all_messages_for_response,
        ui_actions=ui_actions,
        state=updated_meta,
    )


_POST_TEMPLATE_REPLY_SYSTEM = """You are the outreach assistant. The user just created one or more email templates. Generate a single short assistant message (1-3 sentences) that:
1. Briefly confirms what was created (e.g. "Created email **X**." or "Created **N** emails: **A**, **B**.").
2. If compliance_note is provided, add one short line about it (e.g. "I've applied your compliance rules.").
3. End by asking: "Would you like to **preview** your email(s), request any edits or changes, or **proceed to select sending inbox**?"

Keep the tone friendly and concise. Use markdown for template names (**name**). Reply with ONLY the message text, no JSON, no code block, no other wrapper."""


@router.post("/post-template-reply", response_model=PostTemplateReplyResponse)
async def post_template_reply(request: PostTemplateReplyRequest):
    """
    Generate an LLM reply shown after template(s) creation, asking user to preview or proceed to inbox select.
    """
    if llm_service is None:
        raise HTTPException(status_code=500, detail="LLM service not initialized")
    try:
        names_str = ", ".join(request.created_names[:20]) if request.created_names else "your email(s)"
        count = request.count or max(1, len(request.created_names))
        compliance_line = f"\n\nCompliance note to mention (include briefly if relevant): {request.compliance_note}" if request.compliance_note else ""
        prompt = (
            _POST_TEMPLATE_REPLY_SYSTEM
            + f"\n\nCreated {count} template(s). Names: {names_str}.{compliance_line}\n\nGenerate the reply:"
        )
        content = await llm_service.generate_text(
            request.user_id,
            request.provider,
            prompt,
        )
        reply = (content or "").strip()
        if not reply:
            reply = f"Created **{names_str}**. Would you like to **preview** your email(s), request any edits or changes, or **proceed to select sending inbox**?"
        return PostTemplateReplyResponse(reply=reply)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---- Outreach chat CRUD (AI Campaign Studio persistence) ----

@router.post("/chats")
async def create_outreach_chat(
    body: CreateOutreachChatRequest | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Create a new outreach chat. Returns the created chat."""
    user_id = current_user["id"]
    title = (body and body.title) or "Outreach 1"
    chat = OutreachChat(user_id=user_id, title=title)
    doc = chat.model_dump()
    await db.outreach_chats.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/chats")
async def list_outreach_chats(current_user: dict = Depends(get_current_user)):
    """List all outreach chats for the current user."""
    user_id = current_user["id"]
    cursor = db.outreach_chats.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "title": 1, "created_at": 1, "updated_at": 1, "meta": 1},
    ).sort("updated_at", -1)
    return await cursor.to_list(None)


@router.get("/chats/{chat_id}")
async def get_outreach_chat(
    chat_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get one outreach chat with all its messages."""
    user_id = current_user["id"]
    chat = await db.outreach_chats.find_one(
        {"id": chat_id, "user_id": user_id},
        {"_id": 0},
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    messages = await db.outreach_chat_messages.find(
        {"chat_id": chat_id, "user_id": user_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(None)
    chat["messages"] = messages
    return chat


@router.patch("/chats/{chat_id}")
async def update_outreach_chat(
    chat_id: str,
    body: UpdateOutreachChatRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update chat title and/or meta."""
    user_id = current_user["id"]
    existing = await db.outreach_chats.find_one(
        {"id": chat_id, "user_id": user_id},
        {"_id": 0, "id": 1},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Chat not found")
    updates = {"updated_at": datetime.now(timezone.utc)}
    if body.title is not None:
        updates["title"] = body.title
    if body.meta is not None:
        updates["meta"] = body.meta
    await db.outreach_chats.update_one(
        {"id": chat_id, "user_id": user_id},
        {"$set": updates},
    )
    chat = await db.outreach_chats.find_one(
        {"id": chat_id, "user_id": user_id},
        {"_id": 0},
    )
    return chat


@router.post("/chats/{chat_id}/messages")
async def add_outreach_message(
    chat_id: str,
    body: AddOutreachMessageRequest,
    current_user: dict = Depends(get_current_user),
):
    """Append a message to the chat. Also bumps chat updated_at."""
    user_id = current_user["id"]
    chat = await db.outreach_chats.find_one(
        {"id": chat_id, "user_id": user_id},
        {"_id": 0, "id": 1},
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    msg = OutreachChatMessage(
        chat_id=chat_id,
        user_id=user_id,
        role=body.role,
        content=body.content or "",
        payload=body.payload,
    )
    doc = msg.model_dump()
    await db.outreach_chat_messages.insert_one(doc)
    doc.pop("_id", None)
    await db.outreach_chats.update_one(
        {"id": chat_id, "user_id": user_id},
        {"$set": {"updated_at": datetime.now(timezone.utc)}},
    )
    return doc


@router.delete("/chats/{chat_id}")
async def delete_outreach_chat(
    chat_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete the chat and all its messages."""
    user_id = current_user["id"]
    result = await db.outreach_chats.delete_one(
        {"id": chat_id, "user_id": user_id},
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Chat not found")
    await db.outreach_chat_messages.delete_many({"chat_id": chat_id, "user_id": user_id})
    return {"deleted": True}


_PARSE_STEPS_VARIANTS_SYSTEM = """You are a parser for an email sequence builder. The user was asked: (1) How many emails in the sequence (e.g. 3 = one first email + two follow-ups), (2) How many versions per email to test (1 = one version, 2 = test two versions).

Parse their reply and extract:
- steps: number of sequence steps (1-10). Interpret "3 sequences", "3 steps", "3 emails" as steps=3.
- variants: number of variants per step (1-5). Interpret "2 variations", "2 variants", "2 per step" as variants=2.

If they only give one number (e.g. "3"), use steps=that number and variants=1.
If they give two numbers in any order, the first typically is steps and the second variants (e.g. "3 and 2" -> steps=3, variants=2). Also accept "2 variations" or "2 variants" as the second number.

Respond with ONLY a JSON object, no markdown, no code block, no other text. Format: {"steps": <1-10>, "variants": <1-5>}"""


@router.post("/parse-steps-variants", response_model=ParseStepsVariantsResponse)
async def parse_steps_variants(request: ParseStepsVariantsRequest):
    """
    Use LLM to parse user reply about how many sequence steps and variants per step they want.
    Returns { steps: 1-10, variants: 1-5 }.
    """
    if llm_service is None:
        raise HTTPException(status_code=500, detail="LLM service not initialized")
    try:
        prompt = _PARSE_STEPS_VARIANTS_SYSTEM + "\n\nUser reply: " + (request.message or "").strip()
        content = await llm_service.generate_text(
            request.user_id,
            request.provider,
            prompt,
        )
        data = _parse_intent_response(content)
        steps = int(data.get("steps", 1))
        variants = int(data.get("variants", 1))
        steps = max(1, min(10, steps))
        variants = max(1, min(5, variants))
        return ParseStepsVariantsResponse(steps=steps, variants=variants)
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        raise HTTPException(status_code=400, detail=f"Could not parse steps/variants: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
