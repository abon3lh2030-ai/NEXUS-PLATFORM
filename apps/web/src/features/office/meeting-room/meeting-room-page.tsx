import '@livekit/components-styles';
import { LiveKitRoom, RoomAudioRenderer, VideoConference, useRoomContext } from '@livekit/components-react';
import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Spinner, Textarea } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bot, CircleDot } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { useErrorMessage } from '@/components/common';
import { apiPost } from '@/lib/api';

interface RoomAccess { url: string; token: string; room: string; recording: boolean; can_moderate: boolean }

/** Topic the meeting agent listens on for "ask the AI employee" (text streams). */
const ASK_TOPIC = 'nexus.ask';

function AskAgent() {
  const { t } = useTranslation();
  const room = useRoomContext();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const send = async () => {
    const question = q.trim();
    if (!question) return;
    await room.localParticipant.sendText(question, { topic: ASK_TOPIC });
    setQ('');
    setOpen(false);
    toast.success(t('room.askSent'));
  };
  return (
    <>
      <Button size="sm" variant="brand" onClick={() => setOpen(true)}><Bot /> {t('room.askAgent')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader><DialogTitle>{t('room.askAgent')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('room.askHint')}</p>
          <Textarea rows={3} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('room.askPlaceholder')} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button onClick={() => void send()} disabled={!q.trim()}>{t('common.send')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** NEXUS meeting room on LiveKit: video, audio, screen share, chat; the AI employee joins as a participant. */
export function MeetingRoomPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const msg = useErrorMessage();
  const access = useQuery({ queryKey: ['meeting-room-token', id], queryFn: () => apiPost<RoomAccess>(`/meetings/${id}/room/token`), retry: false, staleTime: 60 * 60_000, refetchOnWindowFocus: false });

  if (access.isLoading) return <div className="flex h-[70dvh] items-center justify-center"><Spinner /></div>;
  if (access.error || !access.data) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border bg-card p-6 text-center">
        <p className="font-medium">{t('room.joinFailed')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{msg(access.error)}</p>
        <Button asChild variant="outline" className="mt-4"><Link to={`/app/meetings/${id}`}>{t('room.backToMeeting')}</Link></Button>
      </div>
    );
  }
  const a = access.data;
  return (
    <LiveKitRoom serverUrl={a.url} token={a.token} connect video={false} audio data-lk-theme="default" className="flex h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-xl" onDisconnected={() => navigate(`/app/meetings/${id}`)} onError={(e) => toast.error(e.message)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/40 px-3 py-2 text-white">
        <Button asChild size="sm" variant="ghost" className="text-white hover:bg-white/10"><Link to={`/app/meetings/${id}`}><ArrowRight className="rtl:rotate-0 ltr:rotate-180" /> {t('room.backToMeeting')}</Link></Button>
        {a.recording && <Badge tone="danger"><CircleDot /> {t('room.recording')}</Badge>}
        <span className="text-xs text-white/70">{t('room.transcribedNotice')}</span>
        <div className="ms-auto"><AskAgent /></div>
      </div>
      <div className="min-h-0 flex-1" dir="ltr"><VideoConference /></div>
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}
