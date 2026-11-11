import { Badge, Button, Input, Spinner, cn } from '@nexus/ui';
import { useMutation } from '@tanstack/react-query';
import { Captions, Hand, MessageSquare, Mic, MicOff, MonitorUp, PhoneOff, Send, Smile, Sparkles, UserX, Users, Video, VideoOff, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { api, apiPost, ApiError } from '@/lib/api';
import { useMeetingRoom, type PeerState, type RemotePeer, type RoomTicket } from './use-meeting-room';

const REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '🤔'] as const;
type Panel = 'chat' | 'people' | 'ai' | 'captions' | null;

interface TicketResponse extends RoomTicket {
  in_room: number;
  meeting: { id: string; title: string };
}

/** NEXUS internal video meeting room: pre-join check, then the live room. */
export function MeetingRoomPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const room = useMeetingRoom();
  const [title, setTitle] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    void room.startMedia({ audio: true, video: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!room.notice) return;
    toast.message(t(`room.notice.${room.notice}`));
    room.clearNotice();
  }, [room, t]);

  const enter = async () => {
    setJoining(true);
    try {
      const r = await apiPost<TicketResponse>(`/meetings/${id}/room/ticket`);
      setTitle(r.meeting.title);
      if (r.in_room >= r.max_participants) {
        toast.error(t('room.full', { max: r.max_participants }));
        return;
      }
      room.join(r);
    } catch (err) {
      toast.error(err instanceof ApiError ? t(`errors.${err.code}`, { defaultValue: t('room.joinFailed') }) : t('room.joinFailed'));
    } finally {
      setJoining(false);
    }
  };

  const leave = () => {
    room.leave();
    navigate(`/app/meetings/${id}`);
  };

  if (room.status === 'idle' || room.status === 'connecting') {
    return (
      <div className="mx-auto grid max-w-xl gap-5 py-6">
        <h1 className="text-xl font-semibold">{t('room.prejoinTitle')}</h1>
        <VideoBox stream={room.local} muted mirror label={t('room.you')} state={room.state} />
        <div className="flex justify-center gap-2">
          <RoundButton active={room.state.audio} onClick={room.toggleAudio} label={room.state.audio ? t('room.muteMic') : t('room.unmuteMic')}>{room.state.audio ? <Mic /> : <MicOff />}</RoundButton>
          <RoundButton active={room.state.video} onClick={room.toggleVideo} label={room.state.video ? t('room.cameraOff') : t('room.cameraOn')}>{room.state.video ? <Video /> : <VideoOff />}</RoundButton>
        </div>
        <Button size="lg" onClick={() => void enter()} disabled={joining || room.status === 'connecting'}>
          {joining || room.status === 'connecting' ? <Spinner /> : null} {t('room.join')}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t('room.prejoinHint')}</p>
        <Link to={`/app/meetings/${id}`} className="text-center text-sm text-muted-foreground hover:text-foreground">{t('common.back')}</Link>
      </div>
    );
  }

  if (room.status !== 'joined') {
    return (
      <div className="mx-auto grid max-w-md gap-4 py-16 text-center">
        <p className="text-lg font-medium">{t(`room.ended.${room.status}`)}</p>
        <Button asChild><Link to={`/app/meetings/${id}`}>{t('room.backToMeeting')}</Link></Button>
      </div>
    );
  }

  return <LiveRoom meetingId={id} title={title} room={room} onLeave={leave} />;
}

function LiveRoom({ meetingId, title, room, onLeave }: { meetingId: string; title: string; room: ReturnType<typeof useMeetingRoom>; onLeave: () => void }) {
  const { t, i18n } = useTranslation();
  const [panel, setPanel] = useState<Panel>(null);
  const [showReactions, setShowReactions] = useState(false);
  const captioning = useCaptions(room.sendCaption, i18n.language === 'ar' ? 'ar-SA' : 'en-US');
  const started = useRef(Date.now());
  const elapsed = useElapsed(started.current);
  const total = room.peers.length + 1;
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const lastCaptions = room.captions.slice(-2);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-zinc-950 text-zinc-50" dir={i18n.dir()}>
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate font-medium" dir="auto">{title}</p>
        <Badge className="bg-white/10 text-zinc-100">{t('room.count', { count: total })}</Badge>
        <span className="tabular-nums text-sm text-zinc-400">{elapsed}</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col p-3">
          <div className={cn('grid min-h-0 flex-1 gap-3', gridFor(total))}>
            <Tile stream={room.local} muted mirror={!room.state.screen} name={`${room.me?.name ?? ''} (${t('room.you')})`} state={room.state} reactions={room.reactions.filter((r) => r.peerId === room.me?.peerId)} />
            {room.peers.map((p) => (
              <Tile key={p.peerId} stream={p.stream} name={p.name} state={p.state} reactions={room.reactions.filter((r) => r.peerId === p.peerId)} />
            ))}
          </div>
          {captioning.on && lastCaptions.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 mx-auto grid max-w-3xl gap-1 px-4 text-center">
              {lastCaptions.map((c) => (
                <p key={c.key} className="rounded-md bg-black/70 px-3 py-1.5 text-sm" dir="auto"><span className="text-zinc-400">{c.name}: </span>{c.text}</p>
              ))}
            </div>
          )}
        </main>

        {panel && (
          <aside className="flex w-full max-w-sm flex-col border-s border-white/10 bg-zinc-900">
            {panel === 'chat' && <ChatPanel room={room} />}
            {panel === 'people' && <PeoplePanel room={room} />}
            {panel === 'ai' && <AiPanel meetingId={meetingId} room={room} />}
            {panel === 'captions' && <CaptionsPanel room={room} captioning={captioning} />}
          </aside>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 px-3 py-3">
        <RoundButton active={room.state.audio} onClick={room.toggleAudio} label={room.state.audio ? t('room.muteMic') : t('room.unmuteMic')}>{room.state.audio ? <Mic /> : <MicOff />}</RoundButton>
        <RoundButton active={room.state.video} onClick={room.toggleVideo} label={room.state.video ? t('room.cameraOff') : t('room.cameraOn')}>{room.state.video ? <Video /> : <VideoOff />}</RoundButton>
        {'getDisplayMedia' in (navigator.mediaDevices ?? {}) && (
          <RoundButton active={!room.state.screen} highlight={room.state.screen} onClick={() => void room.toggleScreen()} label={room.state.screen ? t('room.stopShare') : t('room.share')}><MonitorUp /></RoundButton>
        )}
        <RoundButton active={!room.state.hand} highlight={room.state.hand} onClick={room.toggleHand} label={room.state.hand ? t('room.lowerHand') : t('room.raiseHand')}><Hand /></RoundButton>
        <div className="relative">
          <RoundButton active onClick={() => setShowReactions((v) => !v)} label={t('room.react')}><Smile /></RoundButton>
          {showReactions && (
            <div className="absolute bottom-14 start-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-zinc-800 p-1.5 shadow-lg rtl:translate-x-1/2">
              {REACTIONS.map((e) => (
                <button key={e} type="button" className="rounded-full px-2 py-1 text-xl hover:bg-white/10" onClick={() => { room.react(e); setShowReactions(false); }}>{e}</button>
              ))}
            </div>
          )}
        </div>
        <span className="mx-1 h-8 w-px bg-white/10" />
        <RoundButton active={panel !== 'chat'} highlight={panel === 'chat'} onClick={() => toggle('chat')} label={t('room.chat')} badge={room.chat.length || undefined}><MessageSquare /></RoundButton>
        <RoundButton active={panel !== 'people'} highlight={panel === 'people'} onClick={() => toggle('people')} label={t('room.people')}><Users /></RoundButton>
        <RoundButton active={panel !== 'captions'} highlight={panel === 'captions' || captioning.on} onClick={() => toggle('captions')} label={t('room.captions')}><Captions /></RoundButton>
        <RoundButton active={panel !== 'ai'} highlight={panel === 'ai'} onClick={() => toggle('ai')} label={t('room.ai')}><Sparkles /></RoundButton>
        <span className="mx-1 h-8 w-px bg-white/10" />
        <Button variant="destructive" className="rounded-full" onClick={onLeave}><PhoneOff /> {t('room.leave')}</Button>
      </footer>
    </div>
  );
}

/* ------------------------------ tiles ------------------------------ */

function gridFor(n: number): string {
  if (n <= 1) return 'grid-cols-1';
  if (n === 2) return 'grid-cols-1 md:grid-cols-2';
  if (n <= 4) return 'grid-cols-2';
  return 'grid-cols-2 lg:grid-cols-3';
}

function Tile({ stream, name, state, muted, mirror, reactions }: { stream: MediaStream | null; name: string; state: PeerState; muted?: boolean; mirror?: boolean; reactions: Array<{ key: string; emoji: string }> }) {
  return (
    <div className="relative min-h-0">
      <VideoBox stream={stream} muted={muted} mirror={mirror} label={name} state={state} />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {reactions.slice(-3).map((r, i) => (
          <span key={r.key} className="animate-bounce text-5xl" style={{ animationDelay: `${i * 120}ms` }}>{r.emoji}</span>
        ))}
      </div>
    </div>
  );
}

function VideoBox({ stream, muted, mirror, label, state }: { stream: MediaStream | null; muted?: boolean | undefined; mirror?: boolean | undefined; label: string; state: PeerState }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  const showVideo = Boolean(stream) && (state.video || state.screen);
  const initials = label.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  return (
    <div className="relative flex aspect-video h-full max-h-full w-full items-center justify-center overflow-hidden rounded-xl bg-zinc-800">
      <video ref={ref} autoPlay playsInline muted={muted} className={cn('size-full object-cover', !showVideo && 'invisible', mirror && 'scale-x-[-1]', state.screen && 'object-contain')} />
      {!showVideo && <span className="absolute flex size-20 items-center justify-center rounded-full bg-zinc-700 text-2xl font-semibold">{initials}</span>}
      <div className="absolute bottom-2 start-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs">
        {!state.audio && <MicOff className="size-3.5 text-red-400" />}
        {state.screen && <MonitorUp className="size-3.5 text-sky-400" />}
        <span className="max-w-[12rem] truncate" dir="auto">{label}</span>
      </div>
      {state.hand && <span className="absolute end-2 top-2 rounded-full bg-amber-400 p-1.5 text-zinc-900"><Hand className="size-4" /></span>}
    </div>
  );
}

function RoundButton({ children, onClick, label, active, highlight, badge }: { children: React.ReactNode; onClick: () => void; label: string; active: boolean; highlight?: boolean; badge?: number | undefined }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn('relative flex size-11 items-center justify-center rounded-full transition [&_svg]:size-5', highlight ? 'bg-sky-500 text-white' : active ? 'bg-white/10 hover:bg-white/20' : 'bg-red-500/90 text-white hover:bg-red-500')}
    >
      {children}
      {badge ? <span className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-sky-500 px-1 text-[10px] leading-4">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

/* ------------------------------ side panels ------------------------------ */

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="border-b border-white/10 px-4 py-3 text-sm font-semibold">{children}</h2>;
}

function ChatPanel({ room }: { room: ReturnType<typeof useMeetingRoom> }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: newer browsers return a Promise from scrollIntoView, which must not become the effect cleanup.
    end.current?.scrollIntoView({ block: 'end' });
  }, [room.chat.length]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    room.sendChat(text.trim());
    setText('');
  };
  return (
    <>
      <PanelTitle>{t('room.chat')}</PanelTitle>
      <div className="grid flex-1 content-start gap-3 overflow-y-auto p-4 text-sm">
        {room.chat.length === 0 && <p className="text-zinc-400">{t('room.noMessages')}</p>}
        {room.chat.map((m) => (
          <div key={m.id}>
            <p className="text-xs text-zinc-400">{m.name}</p>
            <p className="whitespace-pre-wrap" dir="auto">{m.text}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-white/10 p-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={t('room.messagePlaceholder')} className="border-white/10 bg-zinc-800" dir="auto" />
        <Button type="submit" size="icon" aria-label={t('room.send')}><Send className="rtl:-scale-x-100" /></Button>
      </form>
    </>
  );
}

function PeoplePanel({ room }: { room: ReturnType<typeof useMeetingRoom> }) {
  const { t } = useTranslation();
  const people: Array<RemotePeer | { peerId: string; name: string; state: PeerState; self: true }> = [{ peerId: room.me?.peerId ?? 'me', name: `${room.me?.name ?? ''} (${t('room.you')})`, state: room.state, self: true }, ...room.peers];
  return (
    <>
      <PanelTitle>{t('room.peopleCount', { count: people.length })}</PanelTitle>
      <ul className="grid content-start gap-1 overflow-y-auto p-3 text-sm">
        {people.map((p) => (
          <li key={p.peerId} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/5">
            <span className="min-w-0 flex-1 truncate" dir="auto">{p.name}</span>
            {p.state.hand && <Hand className="size-4 text-amber-400" />}
            {p.state.audio ? <Mic className="size-4 text-zinc-400" /> : <MicOff className="size-4 text-red-400" />}
            {room.me?.canModerate && !('self' in p) && (
              <>
                <Button size="icon-sm" variant="ghost" onClick={() => room.moderate('mute', p.peerId)} aria-label={t('room.muteOther')} title={t('room.muteOther')}><VolumeX /></Button>
                <Button size="icon-sm" variant="ghost" onClick={() => room.moderate('remove', p.peerId)} aria-label={t('room.remove')} title={t('room.remove')}><UserX className="text-red-400" /></Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function AiPanel({ meetingId, room }: { meetingId: string; room: ReturnType<typeof useMeetingRoom> }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const ask = useMutation({
    mutationFn: (question: string) => api<{ answer: string }>(`/meetings/${meetingId}/room/ask`, { method: 'POST', body: { question, language: i18n.language === 'ar' ? 'ar' : 'en' } }),
    onError: (err) => toast.error(err instanceof ApiError ? t(`errors.${err.code}`, { defaultValue: t('room.aiFailed') }) : t('room.aiFailed')),
  });
  const quick = [t('room.aiQuick.summary'), t('room.aiQuick.decisions'), t('room.aiQuick.actions')];
  const submit = (question: string) => {
    if (question.trim().length < 2 || ask.isPending) return;
    ask.mutate(question.trim());
    setQ('');
  };
  return (
    <>
      <PanelTitle>{t('room.ai')}</PanelTitle>
      <div className="grid flex-1 content-start gap-3 overflow-y-auto p-4 text-sm">
        <p className="text-xs text-zinc-400">{t('room.aiHint')}</p>
        <div className="flex flex-wrap gap-1.5">
          {quick.map((x) => (
            <button key={x} type="button" onClick={() => submit(x)} disabled={ask.isPending} className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20 disabled:opacity-50">{x}</button>
          ))}
        </div>
        {room.ai.map((m, i) => (
          <div key={i} className="grid gap-1 rounded-lg bg-white/5 p-3">
            <p className="text-xs text-zinc-400" dir="auto">{m.askedBy}: {m.question}</p>
            <p className="whitespace-pre-wrap" dir="auto">{m.answer}</p>
          </div>
        ))}
        {ask.isPending && <p className="flex items-center gap-2 text-zinc-400"><Spinner /> {t('room.aiThinking')}</p>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); submit(q); }} className="flex gap-2 border-t border-white/10 p-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder={t('room.aiPlaceholder')} className="border-white/10 bg-zinc-800" dir="auto" />
        <Button type="submit" size="icon" disabled={ask.isPending} aria-label={t('room.send')}><Sparkles /></Button>
      </form>
    </>
  );
}

function CaptionsPanel({ room, captioning }: { room: ReturnType<typeof useMeetingRoom>; captioning: ReturnType<typeof useCaptions> }) {
  const { t } = useTranslation();
  return (
    <>
      <PanelTitle>{t('room.captions')}</PanelTitle>
      <div className="grid gap-2 border-b border-white/10 p-4 text-sm">
        {captioning.supported ? (
          <Button variant={captioning.on ? 'secondary' : 'default'} onClick={captioning.toggle}><Captions /> {captioning.on ? t('room.captionsStop') : t('room.captionsStart')}</Button>
        ) : (
          <p className="text-zinc-400">{t('room.captionsUnsupported')}</p>
        )}
        <p className="text-xs text-zinc-400">{t('room.captionsHint')}</p>
      </div>
      <div className="grid flex-1 content-start gap-2 overflow-y-auto p-4 text-sm">
        {room.captions.map((c) => (
          <p key={c.key} className={cn(!c.final && 'text-zinc-400')} dir="auto"><span className="text-zinc-400">{c.name}: </span>{c.text}</p>
        ))}
      </div>
    </>
  );
}

/* ------------------------------ helpers ------------------------------ */

function useElapsed(since: number): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/**
 * Live captions of the user's own voice, using the browser's built-in speech recognition (each person
 * captions themselves, so speaker names are always right). Off until the user turns it on.
 */
function useCaptions(send: (text: string, final: boolean) => void, lang: string) {
  const Ctor = useMemo(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }, []);
  const [on, setOn] = useState(false);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const wanted = useRef(false);
  const lastInterim = useRef(0);

  useEffect(() => () => {
    wanted.current = false;
    rec.current?.stop();
  }, []);

  const toggle = () => {
    if (!Ctor) return;
    if (wanted.current) {
      wanted.current = false;
      rec.current?.stop();
      setOn(false);
      return;
    }
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) send(text.slice(0, 500), true);
        else if (Date.now() - lastInterim.current > 700) {
          lastInterim.current = Date.now();
          send(text.slice(0, 500), false);
        }
      }
    };
    // Recognition stops by itself after silence; keep it going while captions are on.
    r.onend = () => {
      if (wanted.current) r.start();
    };
    rec.current = r;
    wanted.current = true;
    r.start();
    setOn(true);
  };

  return { supported: Boolean(Ctor), on, toggle };
}
