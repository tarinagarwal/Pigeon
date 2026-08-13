import asyncio
import logging
import os
import random
import re
from typing import Awaitable, Callable, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

# Retries for rate limits (429), overload (503), timeouts, and 5xx.
_MAX_LLM_RETRIES = 5


class LLMService:
    def __init__(self, db):
        self.db = db

    async def get_api_key(self, user_id: str, provider: str) -> str:
        """Get API key for provider"""
        config = await self.db.llm_configs.find_one(
            {
                "user_id": user_id,
                "provider": provider,
            }
        )

        if not config:
            raise Exception(f"No API key configured for {provider}")

        return config["api_key"]

    async def generate_text(
        self,
        user_id: str,
        provider: str,
        prompt: str,
        model: str = None,
        timeout: float = 30.0,
        *,
        inter_request_delay_sec: float = 0.0,
    ) -> str:
        """Generate text using specified LLM provider.

        inter_request_delay_sec: optional pause after a successful call (reduces burst traffic; Smart Leads uses ~0.35s).
        """
        api_key = await self.get_api_key(user_id, provider)

        if provider == "openai":
            out = await self._call_openai(api_key, prompt, model or "gpt-4o", timeout=timeout)
        elif provider == "anthropic":
            out = await self._call_anthropic(api_key, prompt, model or "claude-4-sonnet-20250514", timeout=timeout)
        elif provider == "gemini":
            out = await self._call_gemini(api_key, prompt, model or "gemini-2.5-pro", timeout=timeout)
        elif provider == "deepseek":
            out = await self._call_deepseek(api_key, prompt, model or "deepseek-chat", timeout=timeout)
        elif provider == "grok":
            out = await self._call_grok(api_key, prompt, model or "grok-2-latest", timeout=timeout)
        elif provider == "groq":
            out = await self._call_groq(api_key, prompt, model or "llama-3.3-70b-versatile", timeout=timeout)
        else:
            raise Exception(f"Unsupported provider: {provider}")

        if inter_request_delay_sec and inter_request_delay_sec > 0:
            await asyncio.sleep(inter_request_delay_sec)
        return out

    async def _request_with_retry(
        self,
        label: str,
        fetch: Callable[[], Awaitable[httpx.Response]],
    ) -> httpx.Response:
        """POST with exponential backoff on rate limits; long random wait if provider gives no Retry-After."""
        last_err: Optional[str] = None
        for attempt in range(_MAX_LLM_RETRIES):
            try:
                resp = await fetch()
            except httpx.TimeoutException:
                if attempt < _MAX_LLM_RETRIES - 1:
                    wait = min(2**attempt, 60)
                    logging.warning("%s timeout (attempt %s), retry in %ss", label, attempt + 1, wait)
                    await asyncio.sleep(wait)
                    continue
                raise

            if resp.status_code < 400:
                return resp
            if resp.status_code in (401, 403):
                resp.raise_for_status()

            body_sample = ""
            try:
                body_sample = (resp.text or "")[:2000]
            except Exception:
                pass
            last_err = body_sample or str(resp.status_code)

            retryable = (
                resp.status_code in (408, 429, 503)
                or resp.status_code >= 500
            )
            if retryable and attempt < _MAX_LLM_RETRIES - 1:
                await self._sleep_for_rate_limit(attempt, resp, body_sample, label)
                continue

            resp.raise_for_status()

        raise RuntimeError(f"{label} failed after {_MAX_LLM_RETRIES} retries: {last_err[:400] if last_err else 'unknown'}")

    async def _sleep_for_rate_limit(
        self,
        attempt: int,
        response: httpx.Response,
        body_sample: str,
        label: str,
    ) -> None:
        ra = response.headers.get("Retry-After")
        if ra:
            try:
                w = float(ra)
                w = min(max(w, 0.0), 600.0)
                logging.warning("%s: HTTP %s — Retry-After %.1fs", label, response.status_code, w)
                await asyncio.sleep(w)
                return
            except ValueError:
                pass

        msg = body_sample
        try:
            j = response.json()
            err = j.get("error")
            if isinstance(err, dict):
                msg = (err.get("message") or "") + " " + str(err.get("code") or "")
            elif err is not None:
                msg = str(err)
        except Exception:
            pass
        msg_l = (msg or "").lower()

        m = re.search(r"retry[_\s-]*after[:\s]+(\d+(?:\.\d+)?)\s*s", msg_l)
        if not m:
            m = re.search(r"try again in (\d+(?:\.\d+)?)\s*s", msg_l)
        if m:
            w = min(float(m.group(1)), 600.0)
            logging.warning("%s: parsed %.1fs from error body", label, w)
            await asyncio.sleep(w)
            return

        m_ms = re.search(r"(\d+)\s*ms", msg_l)
        if m_ms:
            w = min(float(m_ms.group(1)) / 1000.0, 600.0)
            await asyncio.sleep(w)
            return

        # No explicit hint: exponential backoff; later attempts use 4–5 min random wait (user request).
        if attempt < 3:
            wait = min(2**attempt, 60.0)
        else:
            wait = random.uniform(240.0, 300.0)
        logging.warning(
            "%s: rate limited / overloaded (HTTP %s, attempt %s), sleeping %.1fs (no Retry-After)",
            label,
            response.status_code,
            attempt + 1,
            wait,
        )
        await asyncio.sleep(wait)

    async def _call_openai(self, api_key: str, prompt: str, model: str, timeout: float = 30.0) -> str:
        async def fetch() -> httpx.Response:
            async with httpx.AsyncClient() as client:
                return await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.7,
                    },
                    timeout=timeout,
                )

        response = await self._request_with_retry("openai", fetch)
        data = response.json()
        return data["choices"][0]["message"]["content"]

    async def _call_anthropic(self, api_key: str, prompt: str, model: str, timeout: float = 30.0) -> str:
        async def fetch() -> httpx.Response:
            async with httpx.AsyncClient() as client:
                return await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 4096,
                    },
                    timeout=timeout,
                )

        response = await self._request_with_retry("anthropic", fetch)
        data = response.json()
        return data["content"][0]["text"]

    async def _call_gemini(self, api_key: str, prompt: str, model: str, timeout: float = 30.0) -> str:
        async def fetch() -> httpx.Response:
            async with httpx.AsyncClient() as client:
                return await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
                    headers={"Content-Type": "application/json"},
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                    timeout=timeout,
                )

        response = await self._request_with_retry("gemini", fetch)
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]

    async def _call_deepseek(self, api_key: str, prompt: str, model: str, timeout: float = 30.0) -> str:
        async def fetch() -> httpx.Response:
            async with httpx.AsyncClient() as client:
                return await client.post(
                    "https://api.deepseek.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.7,
                    },
                    timeout=timeout,
                )

        response = await self._request_with_retry("deepseek", fetch)
        data = response.json()
        return data["choices"][0]["message"]["content"]

    async def _call_grok(self, api_key: str, prompt: str, model: str, timeout: float = 30.0) -> str:
        async def fetch() -> httpx.Response:
            async with httpx.AsyncClient() as client:
                return await client.post(
                    "https://api.x.ai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.7,
                    },
                    timeout=timeout,
                )

        response = await self._request_with_retry("grok", fetch)
        data = response.json()
        return data["choices"][0]["message"]["content"]

    async def _call_groq(self, api_key: str, prompt: str, model: str, timeout: float = 30.0) -> str:
        async def fetch() -> httpx.Response:
            async with httpx.AsyncClient() as client:
                return await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.7,
                    },
                    timeout=timeout,
                )

        response = await self._request_with_retry("groq", fetch)
        data = response.json()
        return data["choices"][0]["message"]["content"]
