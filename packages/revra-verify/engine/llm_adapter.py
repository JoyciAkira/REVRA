#!/usr/bin/env python3
"""
Adapter LLM BYOM (ADR-0003): Anthropic Messages o OpenAI Chat, config via env.

Env:
  REVRA_LLM_PROTOCOL  anthropic | openai   (default anthropic)
  REVRA_LLM_BASE_URL  default proxy GhostCLI http://127.0.0.1:18899
  REVRA_LLM_API_KEY   chiave (mai nel repo)
  REVRA_LLM_MODEL     default claude-sonnet-5
"""
import json
import os
import random
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

PROTOCOL = os.environ.get("REVRA_LLM_PROTOCOL", "anthropic")
BASE_URL = os.environ.get("REVRA_LLM_BASE_URL", "http://127.0.0.1:18899").rstrip("/")
MODEL = os.environ.get("REVRA_LLM_MODEL", "claude-sonnet-5")


def _default_key() -> str:
    """REVRA_LLM_API_KEY -> GHOSTCLI_API_KEY -> default nella launcher cc-ghost.
    La chiave non viene mai scritta nel repo."""
    for var in ("REVRA_LLM_API_KEY", "GHOSTCLI_API_KEY"):
        if os.environ.get(var):
            return os.environ[var]
    try:
        launcher = Path.home() / ".local" / "bin" / "cc-ghost"
        text = launcher.read_text()
        m = re.search(r'GHOSTCLI_API_KEY:-([A-Za-z0-9_]+)', text)
        if m:
            return m.group(1)
    except OSError:
        pass
    return ""


API_KEY = _default_key()


_last_request = 0.0
_throttle_lock = threading.Lock()
THROTTLE_INTERVAL = float(os.environ.get("REVRA_LLM_MIN_INTERVAL", "0.5"))


def _throttle() -> None:
    """Intervallo minimo tra le richieste (il proxy GhostCLI limita il sustained load)."""
    global _last_request
    with _throttle_lock:
        now = time.monotonic()
        wait = _last_request + THROTTLE_INTERVAL - now
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()


def chat(system: str, user: str, max_tokens: int = 2048, retries: int = 8) -> str:
    """Una chiamata chat; ritorna il testo della risposta.
    429/5xx/connection-refused: retry con backoff esponenziale + jitter;
    su connection-refused prova a riavviare il proxy GhostCLI (come fa cc-ghost)."""
    last_err = None
    for attempt in range(retries):
        try:
            _throttle()
            return _chat_once(system, user, max_tokens)
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code < 500 and e.code != 429:
                raise
            ensure_proxy()
            time.sleep(min(90, 4 * (2 ** attempt)) + random.uniform(0, 2))
        except (urllib.error.URLError, TimeoutError, RuntimeError) as e:
            last_err = e
            if isinstance(e, urllib.error.URLError):
                ensure_proxy()
            time.sleep(min(90, 4 * (2 ** attempt)) + random.uniform(0, 2))
    raise RuntimeError(f"LLM chat fallita dopo {retries} tentativi: {last_err}")


def ensure_proxy() -> None:
    """Health-check del proxy locale; se giù, lo riavvia (bun + ghostcli-proxy.ts)."""
    try:
        urllib.request.urlopen(f"{BASE_URL}/health", timeout=2)
        return
    except Exception:
        pass
    bun = os.path.expanduser("~/.bun/bin/bun")
    proxy_ts = os.path.expanduser("~/.claude/ghostcli-proxy.ts")
    if not (os.path.exists(bun) and os.path.exists(proxy_ts)):
        return
    log_path = os.path.expanduser("~/.claude/logs/ghostcli-proxy.log")
    with open(log_path, "ab") as log:
        subprocess.Popen([bun, "run", proxy_ts], stdout=log, stderr=log)
    for _ in range(30):
        time.sleep(0.3)
        try:
            urllib.request.urlopen(f"{BASE_URL}/health", timeout=1)
            return
        except Exception:
            continue


def _chat_once(system: str, user: str, max_tokens: int) -> str:
    if PROTOCOL == "anthropic":
        body = {
            "model": MODEL,
            "max_tokens": max_tokens,
            "temperature": 0,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        req = urllib.request.Request(
            f"{BASE_URL}/v1/messages",
            data=json.dumps(body).encode(),
            headers={
                "content-type": "application/json",
                "x-api-key": API_KEY,
                "authorization": f"Bearer {API_KEY}",
                "anthropic-version": "2023-06-01",
            },
        )
        raw = urllib.request.urlopen(req, timeout=300).read().decode()
        return _extract_anthropic(raw)
    # openai-compat
    body = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "temperature": 0,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
    }
    req = urllib.request.Request(
        f"{BASE_URL}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {API_KEY}"},
    )
    raw = urllib.request.urlopen(req, timeout=300).read().decode()
    return json.loads(raw)["choices"][0]["message"]["content"]


def _extract_anthropic(raw: str) -> str:
    """Il proxy GhostCLI può rispondere JSON o SSE: gestisce entrambi."""
    raw = raw.strip()
    if raw.startswith("{"):
        data = json.loads(raw)
        return "".join(b.get("text", "") for b in data.get("content", []))
    text = []
    for line in raw.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            ev = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "content_block_delta":
            text.append(ev.get("delta", {}).get("text", ""))
    return "".join(text)
