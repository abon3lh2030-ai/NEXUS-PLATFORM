import { useCallback, useEffect, useRef, useState } from 'react';
import { env } from '@/lib/env';

/**
 * NEXUS internal video meeting (browser side). Audio/video go directly between participants
 * (WebRTC, peer-to-peer); the NEXUS API only relays signaling over a WebSocket.
 * Negotiation uses the "perfect negotiation" pattern so either side may (re)offer safely.
 */

export interface PeerState {
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand: boolean;
}

export interface RemotePeer {
  peerId: string;
  userId: string;
  name: string;
  state: PeerState;
  stream: MediaStream | null;
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  at: string;
}

export interface CaptionLine {
  key: string;
  name: string;
  text: string;
  final: boolean;
}

export interface AiMessage {
  askedBy: string;
  question: string;
  answer: string;
  at: string;
}

export interface Reaction {
  key: string;
  peerId: string;
  emoji: string;
}

export interface RoomTicket {
  ticket: string;
  ice_servers: RTCIceServer[];
  max_participants: number;
}

type Status = 'idle' | 'connecting' | 'joined' | 'left' | 'full' | 'removed' | 'error';

/** Modest video so a 6-person mesh stays within ordinary home/office upload bandwidth. */
const VIDEO_CONSTRAINTS: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } };
const VIDEO_MAX_BITRATE = 600_000;

interface Conn {
  pc: RTCPeerConnection;
  /** The sender carrying camera or screen video (null until there is video to send). */
  videoSender: RTCRtpSender | null;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

function wsUrl(ticket: string): string {
  const base = env.apiBaseUrl.replace(/^http/, 'ws');
  return `${base}/meetings/room/ws?ticket=${encodeURIComponent(ticket)}`;
}

export function useMeetingRoom() {
  const [status, setStatus] = useState<Status>('idle');
  const [me, setMe] = useState<{ peerId: string; name: string; canModerate: boolean } | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [state, setState] = useState<PeerState>({ audio: true, video: true, screen: false, hand: false });
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [ai, setAi] = useState<AiMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const conns = useRef(new Map<string, Conn>());
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStreamTrack | null>(null);
  const iceRef = useRef<RTCIceServer[]>([]);
  const myId = useRef('');
  const stateRef = useRef(state);
  stateRef.current = state;

  const send = useCallback((msg: Record<string, unknown>) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  }, []);

  const patchPeer = useCallback((peerId: string, patch: Partial<RemotePeer>) => {
    setPeers((list) => list.map((p) => (p.peerId === peerId ? { ...p, ...patch } : p)));
  }, []);

  const removePeer = useCallback((peerId: string) => {
    conns.current.get(peerId)?.pc.close();
    conns.current.delete(peerId);
    setPeers((list) => list.filter((p) => p.peerId !== peerId));
  }, []);

  /** Starts camera + mic (also used by the pre-join preview). */
  const startMedia = useCallback(async (opts: { audio: boolean; video: boolean }) => {
    localRef.current?.getTracks().forEach((t) => t.stop());
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: VIDEO_CONSTRAINTS });
    } catch {
      // No camera (or camera blocked): continue with audio only, then with nothing.
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        opts = { ...opts, video: false };
      } catch {
        stream = new MediaStream();
        opts = { audio: false, video: false };
        setNotice('media_unavailable');
      }
    }
    stream.getAudioTracks().forEach((t) => (t.enabled = opts.audio));
    stream.getVideoTracks().forEach((t) => (t.enabled = opts.video));
    localRef.current = stream;
    setLocal(stream);
    setState((s) => ({ ...s, audio: opts.audio && stream.getAudioTracks().length > 0, video: opts.video && stream.getVideoTracks().length > 0 }));
    return stream;
  }, []);

  const connectionFor = useCallback(
    (peerId: string): Conn => {
      const existing = conns.current.get(peerId);
      if (existing) return existing;
      const pc = new RTCPeerConnection({ iceServers: iceRef.current });
      const conn: Conn = { pc, videoSender: null, polite: myId.current > peerId, makingOffer: false, ignoreOffer: false };
      conns.current.set(peerId, conn);

      const stream = localRef.current ?? new MediaStream();
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
      const video = screenRef.current ?? stream.getVideoTracks()[0];
      if (video) addVideoSender(conn, video, stream);
      pc.ontrack = ({ streams }) => {
        if (streams[0]) patchPeer(peerId, { stream: streams[0] });
      };
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) send({ type: 'signal', to: peerId, data: { candidate } });
      };
      pc.onnegotiationneeded = async () => {
        try {
          conn.makingOffer = true;
          await pc.setLocalDescription();
          send({ type: 'signal', to: peerId, data: { description: pc.localDescription } });
        } catch {
          /* renegotiation will retry */
        } finally {
          conn.makingOffer = false;
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') pc.restartIce();
      };
      return conn;
    },
    [patchPeer, send],
  );

  const onSignal = useCallback(
    async (from: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      const conn = connectionFor(from);
      const { pc } = conn;
      try {
        if (data.description) {
          const collision = data.description.type === 'offer' && (conn.makingOffer || pc.signalingState !== 'stable');
          conn.ignoreOffer = !conn.polite && collision;
          if (conn.ignoreOffer) return;
          await pc.setRemoteDescription(data.description);
          if (data.description.type === 'offer') {
            await pc.setLocalDescription();
            send({ type: 'signal', to: from, data: { description: pc.localDescription } });
          }
        } else if (data.candidate) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch (err) {
            if (!conn.ignoreOffer) throw err;
          }
        }
      } catch {
        /* a failed step is recovered by the next negotiation / ICE restart */
      }
    },
    [connectionFor, send],
  );

  const join = useCallback(
    (room: RoomTicket) => {
      iceRef.current = room.ice_servers;
      setStatus('connecting');
      const socket = new WebSocket(wsUrl(room.ticket));
      ws.current = socket;
      let ping: ReturnType<typeof setInterval> | null = null;

      socket.onopen = () => {
        ping = setInterval(() => send({ type: 'ping' }), 25_000);
      };
      socket.onclose = (ev) => {
        if (ping) clearInterval(ping);
        if (ev.code === 4003) setStatus('full');
        else if (ev.code === 4004) setStatus('removed');
        else setStatus((s) => (s === 'left' || s === 'removed' ? s : s === 'joined' ? 'error' : s === 'connecting' ? 'error' : s));
      };
      socket.onmessage = (ev) => {
        // Messages come from our own signaling server, which validates and stamps everything it relays.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let msg: Record<string, any>;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        switch (msg.type) {
          case 'welcome': {
            myId.current = msg.you.peerId;
            setMe(msg.you);
            setStatus('joined');
            setPeers(msg.peers.map((p: RemotePeer) => ({ ...p, stream: null })));
            send({ type: 'state', ...stateRef.current });
            for (const p of msg.peers as RemotePeer[]) connectionFor(p.peerId);
            return;
          }
          case 'peer-joined':
            setPeers((list) => [...list.filter((p) => p.peerId !== msg.peer.peerId), { ...msg.peer, stream: null }]);
            connectionFor(msg.peer.peerId);
            send({ type: 'state', ...stateRef.current });
            return;
          case 'peer-left':
            removePeer(msg.peerId);
            return;
          case 'signal':
            void onSignal(msg.from, msg.data);
            return;
          case 'state':
            patchPeer(msg.peerId, { state: msg.state });
            return;
          case 'chat':
            setChat((c) => [...c.slice(-199), msg as ChatMessage]);
            return;
          case 'reaction': {
            const key = `${msg.from}-${Date.now()}-${Math.random()}`;
            setReactions((r) => [...r, { key, peerId: msg.from, emoji: msg.emoji }]);
            setTimeout(() => setReactions((r) => r.filter((x) => x.key !== key)), 3500);
            return;
          }
          case 'caption':
            setCaptions((c) => upsertCaption(c, msg.from, msg.name, msg.text, msg.final));
            return;
          case 'ai':
            setAi((a) => [...a, msg as AiMessage]);
            return;
          case 'muted-by-host':
            localRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
            setState((s) => {
              const next = { ...s, audio: false };
              send({ type: 'state', ...next });
              return next;
            });
            setNotice('muted_by_host');
            return;
          case 'removed':
            setStatus('removed');
            return;
          case 'error':
            if (msg.code === 'room_full') setStatus('full');
        }
      };
    },
    [connectionFor, onSignal, patchPeer, removePeer, send],
  );

  const update = useCallback(
    (patch: Partial<PeerState>) => {
      setState((s) => {
        const next = { ...s, ...patch };
        send({ type: 'state', ...next });
        return next;
      });
    },
    [send],
  );

  const toggleAudio = useCallback(() => {
    const tracks = localRef.current?.getAudioTracks() ?? [];
    if (!tracks.length) return;
    const on = !stateRef.current.audio;
    tracks.forEach((t) => (t.enabled = on));
    update({ audio: on });
  }, [update]);

  const toggleVideo = useCallback(() => {
    const tracks = localRef.current?.getVideoTracks() ?? [];
    if (!tracks.length) return;
    const on = !stateRef.current.video;
    tracks.forEach((t) => (t.enabled = on));
    update({ video: on });
  }, [update]);

  const replaceVideo = useCallback((track: MediaStreamTrack | null) => {
    for (const conn of conns.current.values()) {
      if (conn.videoSender) void conn.videoSender.replaceTrack(track);
      else if (track) addVideoSender(conn, track, localRef.current ?? new MediaStream());
    }
  }, []);

  const stopScreen = useCallback(() => {
    screenRef.current?.stop();
    screenRef.current = null;
    replaceVideo(localRef.current?.getVideoTracks()[0] ?? null);
    update({ screen: false });
  }, [replaceVideo, update]);

  const toggleScreen = useCallback(async () => {
    if (screenRef.current) return stopScreen();
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      screenRef.current = track;
      track.onended = () => stopScreen();
      replaceVideo(track);
      update({ screen: true });
    } catch {
      /* user cancelled */
    }
  }, [replaceVideo, stopScreen, update]);

  const toggleHand = useCallback(() => update({ hand: !stateRef.current.hand }), [update]);
  const sendChat = useCallback((text: string) => send({ type: 'chat', text }), [send]);
  const react = useCallback((emoji: string) => send({ type: 'reaction', emoji }), [send]);
  const moderate = useCallback((action: 'mute' | 'remove', to: string) => send({ type: 'moderate', action, to }), [send]);
  const sendCaption = useCallback(
    (text: string, final: boolean) => {
      send({ type: 'caption', text, final });
      setCaptions((c) => upsertCaption(c, myId.current, me?.name ?? '', text, final));
    },
    [me?.name, send],
  );

  /** Releases the camera, connections and socket. */
  const teardown = useCallback(() => {
    ws.current?.close(1000, 'left');
    ws.current = null;
    for (const { pc } of conns.current.values()) pc.close();
    conns.current.clear();
    screenRef.current?.stop();
    screenRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const leave = useCallback(() => {
    setStatus('left');
    teardown();
    setPeers([]);
  }, [teardown]);

  // Leaving the page always hangs up (without touching state of an unmounted component).
  useEffect(() => teardown, [teardown]);

  return {
    status,
    me,
    peers,
    local,
    state,
    chat,
    captions,
    ai,
    reactions,
    notice,
    clearNotice: () => setNotice(null),
    startMedia,
    join,
    leave,
    toggleAudio,
    toggleVideo,
    toggleScreen,
    toggleHand,
    sendChat,
    react,
    moderate,
    sendCaption,
  };
}

function addVideoSender(conn: Conn, track: MediaStreamTrack, stream: MediaStream): void {
  const sender = conn.pc.addTrack(track, stream);
  conn.videoSender = sender;
  const p = sender.getParameters();
  p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: VIDEO_MAX_BITRATE }];
  void sender.setParameters(p).catch(() => undefined);
}

/** Interim captions replace the speaker's current line; a final caption closes it. */
function upsertCaption(list: CaptionLine[], from: string, name: string, text: string, final: boolean): CaptionLine[] {
  const open = list.findIndex((c) => c.key.startsWith(`${from}:`) && !c.final);
  const line = { key: open >= 0 ? list[open]!.key : `${from}:${Date.now()}`, name, text, final };
  const next = open >= 0 ? list.map((c, i) => (i === open ? line : c)) : [...list, line];
  return next.slice(-100);
}
