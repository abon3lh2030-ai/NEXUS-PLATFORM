"""NEXUS meeting agent — a LiveKit Agents worker.

Joins a NEXUS meeting room when dispatched (agent_name = LIVEKIT_AGENT_NAME), then:
  * posts a chat message that the meeting is transcribed (and recorded, if the company records audio);
  * transcribes every speaker (VAD → STTProvider), sending lines to NEXUS, which names the speaker
    from their NEXUS account;
  * answers out loud (TTSProvider) and in the chat when called by name or via the "Ask" button
    (text stream topic "nexus.ask"). The answer comes from the NEXUS API (Claude), not from here.
Post-meeting summary and tasks are produced by the NEXUS API when the room finishes.

Nothing here depends on LiveKit Cloud specifically: point LIVEKIT_URL at any LiveKit server.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import unicodedata

from livekit import rtc
from livekit.agents import AutoSubscribe, JobContext, JobProcess, WorkerOptions, cli
from livekit.plugins import silero

from .nexus_api import NexusApi
from .voice import STT_SAMPLE_RATE, TTS_SAMPLE_RATE, build_providers, pcm_to_wav

log = logging.getLogger("nexus.meeting_agent")

CHAT_TOPIC = "lk.chat"  # LiveKit components chat
ASK_TOPIC = "nexus.ask"  # "Ask the AI employee" button in the NEXUS meeting page
FLUSH_EVERY_S = 3.0


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).lower()
    t = re.sub(r"[ً-ْـ]", "", t)
    t = re.sub("[أإآٱ]", "ا", t).replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", t)).strip()


def mentions(name: str, text: str) -> bool:
    """True when the AI employee's name is said as a word (also with the Arabic vocative "يا")."""
    n = normalize(name)
    if not n:
        return False
    return f" {n} " in f" {normalize(text)} " or f" يا{n} " in f" {normalize(text)} "


def notice_text(name: str, language: str, recording: bool) -> str:
    if language == "en":
        return f"Hello, I'm {name}, an AI employee from NEXUS. This meeting is being transcribed{' and recorded' if recording else ''} according to company policy. Say my name or use “Ask the AI employee” to ask me."
    return f"مرحبًا، أنا {name}، موظف ذكاء اصطناعي من نيكسوس. هذا الاجتماع يُفرَّغ نصيًا{' ويُسجَّل صوتيًا' if recording else ''} حسب سياسة الشركة. نادِني باسمي أو استخدم زر «اسأل الموظف» لتسألني."


class MeetingAgent:
    def __init__(self, ctx: JobContext, api: NexusApi, vad):
        self.ctx, self.api, self.vad = ctx, api, vad
        self.room: rtc.Room = ctx.room
        self.stt, self.tts = build_providers()
        self.info: dict = {}
        self.buffer: list[dict] = []
        self.speaking = asyncio.Lock()
        self.source = rtc.AudioSource(TTS_SAMPLE_RATE, 1)
        self.tasks: set[asyncio.Task] = set()

    def spawn(self, coro) -> None:
        t = asyncio.create_task(coro)
        self.tasks.add(t)
        t.add_done_callback(self.tasks.discard)

    @property
    def name(self) -> str:
        return (self.info.get("ai_employee") or {}).get("name") or "NEXUS"

    @property
    def language(self) -> str:
        return self.info.get("language") or "ar"

    async def start(self) -> None:
        self.info = await self.api.context(self.room.name)
        track = rtc.LocalAudioTrack.create_audio_track("ai-voice", self.source)
        await self.room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        await self.room.local_participant.send_text(notice_text(self.name, self.language, bool(self.info.get("recording_enabled"))), topic=CHAT_TOPIC)
        log.info("joined room=%s stt=%s tts=%s", self.room.name, getattr(self.stt, "name", None), getattr(self.tts, "name", None))

        @self.room.on("track_subscribed")
        def _on_track(track: rtc.Track, _pub: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            if track.kind == rtc.TrackKind.KIND_AUDIO and participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
                self.spawn(self.listen(track, participant))

        for p in self.room.remote_participants.values():
            for pub in p.track_publications.values():
                if pub.track and pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                    self.spawn(self.listen(pub.track, p))

        def _on_ask(reader: rtc.TextStreamReader, identity: str):
            self.spawn(self._read_question(reader, identity))

        self.room.register_text_stream_handler(ASK_TOPIC, _on_ask)
        self.spawn(self.flush_loop())
        self.ctx.add_shutdown_callback(self.flush)

    async def _read_question(self, reader: rtc.TextStreamReader, identity: str) -> None:
        question = (await reader.read_all()).strip()
        p = self.room.remote_participants.get(identity)
        if question:
            await self.answer(question, p.name if p else "")

    async def listen(self, track: rtc.Track, participant: rtc.RemoteParticipant) -> None:
        """One task per speaker: VAD cuts speech into utterances, each goes to the STT provider."""
        if not self.info.get("transcripts_enabled") or not self.stt:
            return
        stream = rtc.AudioStream(track, sample_rate=STT_SAMPLE_RATE, num_channels=1)
        vad_stream = self.vad.stream()

        async def feed():
            async for ev in stream:
                vad_stream.push_frame(ev.frame)

        feeder = asyncio.create_task(feed())
        try:
            async for ev in vad_stream:
                if ev.type.value != "end_of_speech" or not ev.frames:
                    continue
                pcm = rtc.combine_audio_frames(ev.frames).data.tobytes()
                self.spawn(self.transcribe(pcm, participant))
        finally:
            feeder.cancel()
            await stream.aclose()

    async def transcribe(self, pcm: bytes, participant: rtc.RemoteParticipant) -> None:
        try:
            text = await self.stt.transcribe(pcm_to_wav(pcm), self.language)
        except Exception as err:  # a failed line must not stop the meeting
            log.warning("stt_failed participant=%s err=%s", participant.identity, err)
            return
        if not text:
            return
        self.buffer.append({"identity": participant.identity, "text": text})
        if mentions(self.name, text):
            await self.answer(text, participant.name)

    async def answer(self, question: str, asked_by: str) -> None:
        try:
            res = await self.api.ask(self.room.name, question, asked_by)
        except Exception as err:
            log.warning("ask_failed err=%s", err)
            return
        answer = res.get("answer")
        if not answer:
            msg = "الذكاء الاصطناعي غير مفعّل بعد في نيكسوس؛ أكتفي بالتفريغ الآن." if self.language == "ar" else "AI answers are not enabled in NEXUS yet; I'm only transcribing for now."
            await self.room.local_participant.send_text(msg, topic=CHAT_TOPIC)
            return
        await self.room.local_participant.send_text(answer, topic=CHAT_TOPIC)
        self.buffer.append({"identity": "agent", "text": answer})
        if self.tts:
            async with self.speaking:
                await self.say(answer)

    async def say(self, text: str) -> None:
        try:
            pcm = await self.tts.synthesize(text, (self.info.get("ai_employee") or {}).get("voice_id"), self.language)
        except Exception as err:
            log.warning("tts_failed err=%s", err)
            return
        chunk = TTS_SAMPLE_RATE // 50  # 20 ms frames
        for i in range(0, len(pcm) // 2, chunk):
            data = pcm[i * 2 : (i + chunk) * 2]
            n = len(data) // 2
            if n:
                await self.source.capture_frame(rtc.AudioFrame(data, TTS_SAMPLE_RATE, 1, n))

    async def flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_EVERY_S)
            await self.flush()

    async def flush(self, *_args) -> None:
        if not self.buffer:
            return
        lines, self.buffer = self.buffer, []
        try:
            await self.api.transcript(self.room.name, lines)
        except Exception as err:
            log.warning("transcript_send_failed lines=%d err=%s", len(lines), err)
            self.buffer[:0] = lines  # retry next time


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load(sample_rate=STT_SAMPLE_RATE)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    api = NexusApi(os.environ["NEXUS_API_URL"], os.environ["MEETING_AGENT_TOKEN"])
    ctx.add_shutdown_callback(api.aclose)
    agent = MeetingAgent(ctx, api, ctx.proc.userdata["vad"])
    await agent.start()


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, agent_name=os.environ.get("LIVEKIT_AGENT_NAME", "nexus-meeting-agent")))


if __name__ == "__main__":
    main()
