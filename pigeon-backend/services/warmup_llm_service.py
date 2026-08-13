import os
import random
import re
from typing import Dict, List, Optional

import httpx


# Groq sees this on every warmup reply; tokens match EmailService + warmup sender/receiver pipeline.
_WARMUP_MERGE_AND_FORMAT_RULES = (
    "Merge variables (optional): you may include {{sender_name}}, {{sender_email}}, {{receiver_name}}, "
    "{{receiver_email}} (and camelCase senderName, senderEmail, receiverName, receiverEmail). "
    "They are replaced with the real warming inbox and pool receiver before the message is sent. "
    "Format: this reply must be plain text only—no HTML tags, no markdown, no links. "
    "Warmup follow-ups are sent as text/plain even if earlier messages in the thread used HTML."
)


class WarmupLLMService:
    """Generate human-like warmup replies using Groq with deterministic fallback."""

    def __init__(self):
        self.api_key = (os.getenv("GROQ_API_KEY") or "").strip()
        self.model = (os.getenv("WARMUP_GROQ_MODEL") or "llama-3.3-70b-versatile").strip()
        self.timeout_ms = int(os.getenv("WARMUP_GROQ_TIMEOUT_MS") or "15000")
        self.enabled = (os.getenv("WARMUP_GROQ_ENABLED") or "1").lower() in ("1", "true", "yes")

    def _sanitize(self, text: str) -> str:
        body = (text or "").strip()
        if not body:
            return ""
        body = re.sub(r"https?://\S+", "", body)
        body = re.sub(r"\bwww\.\S+", "", body)
        body = re.sub(r"\bas an ai[^.]*\.?", "", body, flags=re.IGNORECASE)
        body = re.sub(r"\s+", " ", body).strip()
        if len(body) > 240:
            body = body[:240].rsplit(" ", 1)[0].strip()
        return body

    def _fallback(self, style_samples: List[str], turn_index: int) -> str:
        seed = [s.strip() for s in style_samples if (s or "").strip()]
        openings = ["Sounds good.", "Got it.", "Makes sense.", "Thanks for the note.", "That works."]
        closers = [
            "Will follow up shortly.",
            "Happy to continue this.",
            "Let's keep in touch.",
            "I'll circle back soon.",
            "Appreciate it.",
        ]
        base = random.choice(seed) if seed else random.choice(openings)
        if len(base) > 140:
            base = base[:140].rsplit(" ", 1)[0]
        if turn_index >= 2:
            base = f"{base} {random.choice(closers)}"
        return self._sanitize(base) or "Thanks for the update."

    async def generate_reply(
        self,
        style_samples: List[str],
        thread_history: List[Dict[str, str]],
        turn_index: int,
        intent: str = "continue",
        banned_phrases: Optional[List[str]] = None,
    ) -> Dict[str, Optional[str]]:
        """Return reply text + metadata source."""
        if not self.enabled or not self.api_key:
            body = self._fallback(style_samples, turn_index)
            return {"body": body, "source": "fallback", "model": None, "quality_score": 0.55}

        history_lines = []
        for msg in thread_history[-4:]:
            role = msg.get("role", "other")
            txt = (msg.get("body", "") or "").strip()
            if txt:
                history_lines.append(f"{role}: {txt}")
        style = "\n".join(f"- {s.strip()[:120]}" for s in style_samples[:6] if (s or "").strip())
        context = "\n".join(history_lines) if history_lines else "No prior context."
        prompt = (
            "Write a short natural email reply for warmup. "
            "Rules: plain text only, 1-3 sentences, no links, no sales pitch, no signatures, no emojis. "
            "Tone should be casual professional and human.\n"
            f"{_WARMUP_MERGE_AND_FORMAT_RULES}\n"
            f"Turn: {turn_index}\n"
            f"Intent: {intent}\n"
            "Intent policy:\n"
            "- answer_directly: respond to the direct ask first, then optionally add one short follow-up line.\n"
            "- clarify_and_continue: ask one concise clarifying question and keep the thread open.\n"
            "- acknowledge: acknowledge receipt, no hard close.\n"
            "- continue: advance the conversation with one concrete next-step sentence.\n"
            "- close_softly: only soft-close if no pending question exists.\n"
            f"Style hints:\n{style or '- concise and friendly'}\n"
            f"Avoid these phrases:\n{chr(10).join(f'- {p}' for p in (banned_phrases or [])[:8]) or '- none'}\n"
            f"Recent thread:\n{context}\n"
            "Reply:"
        )
        try:
            async with httpx.AsyncClient(timeout=self.timeout_ms / 1000.0) as client:
                response = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.8,
                        "max_tokens": 120,
                    },
                )
                response.raise_for_status()
                data = response.json()
                raw = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content", "")
                body = self._sanitize(raw)
                if not body:
                    raise ValueError("empty llm output")
                if any(p and p.lower() in body.lower() for p in (banned_phrases or [])):
                    raise ValueError("repetitive output")
                quality = 0.85 if len(body) >= 20 else 0.7
                return {"body": body, "source": "groq", "model": self.model, "quality_score": quality}
        except Exception:
            body = self._fallback(style_samples, turn_index)
            return {"body": body, "source": "fallback", "model": None, "quality_score": 0.55}
