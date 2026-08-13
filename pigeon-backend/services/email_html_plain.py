"""Shared HTML → text/plain conversion for multipart email alternatives."""

import html as html_stdlib
import re


def html_email_fragment_to_plain(fragment: str) -> str:
    """
    Build a readable text/plain alternative from HTML email body fragments.

    Strips scripts/styles, maps block tags and <br> to newlines, expands <a href>
    and <img alt=...>, decodes entities, then normalizes whitespace — better than
    deleting tags only (which jams words together and drops link targets).
    """
    if not fragment:
        return ""
    text = fragment.strip()
    if not text:
        return ""
    if "<" not in text:
        return text

    text = re.sub(r"<script[\s\S]*?</script>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<noscript[\s\S]*?</noscript>", "", text, flags=re.IGNORECASE)

    def _img_plain(m) -> str:
        tag = m.group(0)
        alt_m = re.search(r'alt\s*=\s*["\']([^"\']*)["\']', tag, re.IGNORECASE)
        alt = (alt_m.group(1) or "").strip() if alt_m else ""
        return f"\n[{alt}]\n" if alt else "\n[image]\n"

    text = re.sub(r"<img[^>]*>", _img_plain, text, flags=re.IGNORECASE)

    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</div\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</tr\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</h[1-6]\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</blockquote\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li\s*>", "\n- ", text, flags=re.IGNORECASE)
    text = re.sub(r"</li\s*>", "\n", text, flags=re.IGNORECASE)

    def _a_plain(m) -> str:
        href = (m.group(1) or "").strip()
        inner_html = m.group(2) or ""
        inner = re.sub(r"<[^>]+>", "", inner_html)
        inner = html_stdlib.unescape(inner).strip()
        href = html_stdlib.unescape(href)
        if not href or href.startswith("#"):
            return inner
        if inner and inner.casefold() != href.casefold():
            return f"{inner} ({href})"
        return href

    text = re.sub(
        r'<a\s+[^>]*href\s*=\s*["\']([^"\']*)["\'][^>]*>([\s\S]*?)</a\s*>',
        _a_plain,
        text,
        flags=re.IGNORECASE,
    )

    text = re.sub(r"<[^>]+>", "", text)
    text = html_stdlib.unescape(text)
    text = text.replace("\xa0", " ").replace("\u2007", " ").replace("\u202f", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
