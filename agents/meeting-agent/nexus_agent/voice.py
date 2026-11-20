"""Swappable speech providers for the NEXUS meeting agent.

Two small interfaces — STTProvider and TTSProvider — so the external provider (ElevenLabs today)
can be replaced by NEXUS's own voice server ("local": Whisper for STT, NAMAA for TTS) without
touching the agent. If the local provider does not answer within LOCAL_TIMEOUT_S (5s), the call
falls back to the external provider automatically and the fallback is logged.

Local voice API contract (implemented by the owner's server at LOCAL_VOICE_URL):
  POST /v1/stt   multipart: file=<16 kHz mono WAV>, language=<ar|en>        → {"text": "..."}
  POST /v1/tts   json: {"text", "voice", "language", "sample_rate": 24000}   → raw PCM s16le mono
  Both with header "Authorization: Bearer <LOCAL_VOICE_KEY>".
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import wave
from dataclasses import dataclass
from typing import Protocol

import httpx

log = logging.getLogger("nexus.voice")

LOCAL_TIMEOUT_S = 5.0
TTS_SAMPLE_RATE = 24000
STT_SAMPLE_RATE = 16000
ELEVENLABS_BASE = "https://api.elevenlabs.io"


class VoiceError(RuntimeError):
    pass


class STTProvider(Protocol):
    name: str

    async def transcribe(self, wav: bytes, language: str) -> str: ...


class TTSProvider(Protocol):
    name: str

    async def synthesize(self, text: str, voice: str | None, language: str) -> bytes:
        """Returns raw PCM s16le, mono, TTS_SAMPLE_RATE Hz."""
        ...


def pcm_to_wav(pcm: bytes, sample_rate: int = STT_SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


# ───────────────────────── ElevenLabs (external) ─────────────────────────


@dataclass
class ElevenLabsSTT:
    api_key: str
    model: str = "scribe_v1"
    client: httpx.AsyncClient | None = None
    name: str = "elevenlabs"

    async def transcribe(self, wav: bytes, language: str) -> str:
        c = self.client or httpx.AsyncClient(timeout=30)
        try:
            r = await c.post(
                f"{ELEVENLABS_BASE}/v1/speech-to-text",
                headers={"xi-api-key": self.api_key},
                data={"model_id": self.model, "language_code": language, "tag_audio_events": "false"},
                files={"file": ("speech.wav", wav, "audio/wav")},
            )
            if r.status_code != 200:
                raise VoiceError(f"elevenlabs_stt_{r.status_code}")
            return str(r.json().get("text", "")).strip()
        finally:
            if self.client is None:
                await c.aclose()


@dataclass
class ElevenLabsTTS:
    api_key: str
    default_voice: str | None = None
    model: str = "eleven_multilingual_v2"
    client: httpx.AsyncClient | None = None
    name: str = "elevenlabs"

    async def synthesize(self, text: str, voice: str | None, language: str) -> bytes:
        voice_id = voice or self.default_voice
        if not voice_id:
            raise VoiceError("no_voice_id")
        c = self.client or httpx.AsyncClient(timeout=60)
        try:
            r = await c.post(
                f"{ELEVENLABS_BASE}/v1/text-to-speech/{voice_id}",
                params={"output_format": f"pcm_{TTS_SAMPLE_RATE}"},
                headers={"xi-api-key": self.api_key},
                json={"text": text, "model_id": self.model, "language_code": language},
            )
            if r.status_code != 200:
                raise VoiceError(f"elevenlabs_tts_{r.status_code}")
            return r.content
        finally:
            if self.client is None:
                await c.aclose()


# ───────────────────────── NEXUS local voice server ─────────────────────────


@dataclass
class LocalSTT:
    url: str
    key: str
    client: httpx.AsyncClient | None = None
    name: str = "local"

    async def transcribe(self, wav: bytes, language: str) -> str:
        c = self.client or httpx.AsyncClient(timeout=LOCAL_TIMEOUT_S + 1)
        try:
            r = await c.post(
                f"{self.url.rstrip('/')}/v1/stt",
                headers={"Authorization": f"Bearer {self.key}"},
                data={"language": language},
                files={"file": ("speech.wav", wav, "audio/wav")},
            )
            if r.status_code != 200:
                raise VoiceError(f"local_stt_{r.status_code}")
            return str(r.json().get("text", "")).strip()
        finally:
            if self.client is None:
                await c.aclose()


@dataclass
class LocalTTS:
    url: str
    key: str
    client: httpx.AsyncClient | None = None
    name: str = "local"

    async def synthesize(self, text: str, voice: str | None, language: str) -> bytes:
        c = self.client or httpx.AsyncClient(timeout=LOCAL_TIMEOUT_S + 30)
        try:
            r = await c.post(
                f"{self.url.rstrip('/')}/v1/tts",
                headers={"Authorization": f"Bearer {self.key}"},
                json={"text": text, "voice": voice, "language": language, "sample_rate": TTS_SAMPLE_RATE},
            )
            if r.status_code != 200:
                raise VoiceError(f"local_tts_{r.status_code}")
            return r.content
        finally:
            if self.client is None:
                await c.aclose()


# ───────────────────────── fallback ─────────────────────────


class FallbackSTT:
    """Uses `primary` (the local server); on error or after LOCAL_TIMEOUT_S, uses `fallback`."""

    def __init__(self, primary: STTProvider, fallback: STTProvider | None, timeout: float = LOCAL_TIMEOUT_S):
        self.primary, self.fallback, self.timeout = primary, fallback, timeout
        self.name = f"{primary.name}→{fallback.name if fallback else 'none'}"

    async def transcribe(self, wav: bytes, language: str) -> str:
        try:
            return await asyncio.wait_for(self.primary.transcribe(wav, language), self.timeout)
        except (asyncio.TimeoutError, VoiceError, httpx.HTTPError) as err:
            if not self.fallback:
                raise
            log.warning("voice_fallback stt primary=%s fallback=%s reason=%s", self.primary.name, self.fallback.name, type(err).__name__ if isinstance(err, asyncio.TimeoutError) else err)
            return await self.fallback.transcribe(wav, language)


class FallbackTTS:
    def __init__(self, primary: TTSProvider, fallback: TTSProvider | None, timeout: float = LOCAL_TIMEOUT_S):
        self.primary, self.fallback, self.timeout = primary, fallback, timeout
        self.name = f"{primary.name}→{fallback.name if fallback else 'none'}"

    async def synthesize(self, text: str, voice: str | None, language: str) -> bytes:
        try:
            return await asyncio.wait_for(self.primary.synthesize(text, voice, language), self.timeout)
        except (asyncio.TimeoutError, VoiceError, httpx.HTTPError) as err:
            if not self.fallback:
                raise
            log.warning("voice_fallback tts primary=%s fallback=%s reason=%s", self.primary.name, self.fallback.name, type(err).__name__ if isinstance(err, asyncio.TimeoutError) else err)
            # The local server may have its own voice ids; the external provider uses its default voice.
            return await self.fallback.synthesize(text, None, language)


def build_providers(env: dict[str, str] | None = None) -> tuple[STTProvider | None, TTSProvider | None]:
    """STT_PROVIDER / TTS_PROVIDER = elevenlabs | local. "local" always falls back to ElevenLabs when its key is set."""
    e = dict(os.environ if env is None else env)
    el_key = e.get("ELEVENLABS_API_KEY") or ""
    el_stt = ElevenLabsSTT(el_key, model=e.get("ELEVENLABS_STT_MODEL", "scribe_v1")) if el_key else None
    el_tts = ElevenLabsTTS(el_key, default_voice=e.get("ELEVENLABS_DEFAULT_VOICE_ID") or None, model=e.get("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2")) if el_key else None
    local_url, local_key = e.get("LOCAL_VOICE_URL") or "", e.get("LOCAL_VOICE_KEY") or ""

    def pick(kind: str, external, local_cls, fallback_cls):
        choice = (e.get(f"{kind}_PROVIDER") or "elevenlabs").strip().lower()
        if choice == "local":
            if not (local_url and local_key):
                log.warning("voice_config %s_PROVIDER=local but LOCAL_VOICE_URL/LOCAL_VOICE_KEY missing; using external", kind)
                return external
            return fallback_cls(local_cls(local_url, local_key), external)
        if choice != "elevenlabs":
            raise ValueError(f"unknown {kind}_PROVIDER: {choice}")
        return external

    return pick("STT", el_stt, LocalSTT, FallbackSTT), pick("TTS", el_tts, LocalTTS, FallbackTTS)
