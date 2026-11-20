import asyncio
import logging

import httpx
import pytest

from nexus_agent.agent import mentions, notice_text
from nexus_agent.voice import (
    ElevenLabsSTT,
    ElevenLabsTTS,
    FallbackSTT,
    FallbackTTS,
    LocalSTT,
    VoiceError,
    build_providers,
    pcm_to_wav,
)


class Slow:
    name = "local"

    def __init__(self, delay: float):
        self.delay, self.calls = delay, 0

    async def transcribe(self, wav, language):
        self.calls += 1
        await asyncio.sleep(self.delay)
        return "محلي"

    async def synthesize(self, text, voice, language):
        self.calls += 1
        await asyncio.sleep(self.delay)
        return b"local"


class Broken:
    name = "local"

    async def transcribe(self, wav, language):
        raise VoiceError("local_stt_500")

    async def synthesize(self, text, voice, language):
        raise httpx.ConnectError("refused")


class External:
    name = "elevenlabs"

    def __init__(self):
        self.calls = []

    async def transcribe(self, wav, language):
        self.calls.append(language)
        return "خارجي"

    async def synthesize(self, text, voice, language):
        self.calls.append(voice)
        return b"external"


@pytest.mark.asyncio
async def test_local_answering_in_time_is_used():
    ext = External()
    assert await FallbackSTT(Slow(0.01), ext, timeout=0.5).transcribe(b"", "ar") == "محلي"
    assert ext.calls == []


@pytest.mark.asyncio
async def test_falls_back_when_local_is_too_slow_and_logs_it(caplog):
    ext = External()
    with caplog.at_level(logging.WARNING, logger="nexus.voice"):
        assert await FallbackSTT(Slow(1.0), ext, timeout=0.05).transcribe(b"", "ar") == "خارجي"
    assert "voice_fallback stt primary=local fallback=elevenlabs reason=TimeoutError" in caplog.text


@pytest.mark.asyncio
async def test_default_timeout_is_five_seconds():
    assert FallbackSTT(Slow(0), External()).timeout == 5.0
    assert FallbackTTS(Slow(0), External()).timeout == 5.0


@pytest.mark.asyncio
async def test_falls_back_on_errors_and_external_uses_its_own_voice():
    ext = External()
    assert await FallbackSTT(Broken(), ext).transcribe(b"", "ar") == "خارجي"
    assert await FallbackTTS(Broken(), ext).synthesize("مرحبا", "local-voice-7", "ar") == b"external"
    assert ext.calls == ["ar", None]


@pytest.mark.asyncio
async def test_no_fallback_configured_raises():
    with pytest.raises(VoiceError):
        await FallbackSTT(Broken(), None).transcribe(b"", "ar")


def test_provider_selection_from_env():
    stt, tts = build_providers({"ELEVENLABS_API_KEY": "k"})
    assert isinstance(stt, ElevenLabsSTT) and isinstance(tts, ElevenLabsTTS)
    stt, tts = build_providers({"ELEVENLABS_API_KEY": "k", "STT_PROVIDER": "local", "TTS_PROVIDER": "local", "LOCAL_VOICE_URL": "http://voice.local", "LOCAL_VOICE_KEY": "x"})
    assert isinstance(stt, FallbackSTT) and isinstance(stt.primary, LocalSTT) and isinstance(stt.fallback, ElevenLabsSTT)
    assert isinstance(tts, FallbackTTS)
    # local requested but not configured → external, never silently nothing
    stt, _ = build_providers({"ELEVENLABS_API_KEY": "k", "STT_PROVIDER": "local"})
    assert isinstance(stt, ElevenLabsSTT)
    with pytest.raises(ValueError):
        build_providers({"STT_PROVIDER": "whatever"})


@pytest.mark.asyncio
async def test_elevenlabs_requests_are_well_formed():
    seen = {}

    def handler(req: httpx.Request):
        seen[req.url.path] = req
        if req.url.path.endswith("speech-to-text"):
            return httpx.Response(200, json={"text": " مرحبا "})
        return httpx.Response(200, content=b"\x00\x01")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    assert await ElevenLabsSTT("key", client=client).transcribe(pcm_to_wav(b"\x00\x00" * 160), "ar") == "مرحبا"
    stt_req = seen["/v1/speech-to-text"]
    assert stt_req.headers["xi-api-key"] == "key" and b"scribe_v1" in stt_req.content
    assert await ElevenLabsTTS("key", default_voice="V1", client=client).synthesize("أهلا", None, "ar") == b"\x00\x01"
    tts_req = seen["/v1/text-to-speech/V1"]
    assert tts_req.url.params["output_format"] == "pcm_24000"


def test_name_detection_and_notice():
    assert mentions("ليان", "يا ليان وش قررنا؟")
    assert mentions("أطلس", "اطلس لخص لنا")
    assert not mentions("ليان", "البيانات جاهزة")
    assert "يُفرَّغ" in notice_text("ليان", "ar", False) and "يُسجَّل" in notice_text("ليان", "ar", True)
    assert "recorded" in notice_text("Lian", "en", True)
