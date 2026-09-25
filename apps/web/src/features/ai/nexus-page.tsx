import { Button, Textarea, cn } from '@nexus/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, MessageSquarePlus, Send, Sparkles, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorNotice, Markdown, MockBanner } from '@/components/common';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useSession } from '@/providers/session';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: Array<{ tool: string; ok: boolean; summary: string }>;
  created_at: string;
}

export function NexusPage() {
  const { t, i18n } = useTranslation();
  const { org } = useSession();
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const conversations = useQuery({ queryKey: ['nexus-conversations'], queryFn: () => api<Array<{ id: string; title: string; updated_at: string }>>('/nexus/conversations') });
  const conversation = useQuery({ queryKey: ['nexus-conversation', conversationId], queryFn: () => api<{ messages: Msg[] }>(`/nexus/conversations/${conversationId}`), enabled: Boolean(conversationId) });
  const messages = conversation.data?.messages ?? [];

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages.length, pending]);

  const send = async (text: string) => {
    if (!text.trim() || pending) return;
    setError(null);
    setPending(text);
    setInput('');
    try {
      const res = await api<{ conversation_id: string }>('/nexus/chat', { method: 'POST', body: { conversation_id: conversationId, message: text, locale: i18n.language } });
      setConversationId(res.conversation_id);
      await qc.invalidateQueries({ queryKey: ['nexus-conversation', res.conversation_id] });
      await qc.invalidateQueries({ queryKey: ['nexus-conversations'] });
    } catch (e) {
      setError(e);
      setInput(text);
    } finally {
      setPending(null);
    }
  };

  const suggestions = t('nexus.suggestions', { returnObjects: true }) as string[];

  return (
    <div className="grid h-[calc(100dvh-8rem)] gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="hidden flex-col overflow-hidden rounded-xl border bg-card lg:flex">
        <div className="border-b p-3"><Button variant="outline" className="w-full" onClick={() => setConversationId(null)}><MessageSquarePlus /> {t('nexus.new')}</Button></div>
        <ul className="flex-1 overflow-y-auto p-2">
          {conversations.data?.map((c) => (
            <li key={c.id}>
              <button onClick={() => setConversationId(c.id)} className={cn('w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-muted', conversationId === c.id && 'bg-muted')}>
                <p className="truncate">{c.title || t('nexus.untitled')}</p>
                <p className="text-xs text-muted-foreground">{formatRelative(c.updated_at)}</p>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span className="flex size-8 items-center justify-center rounded-lg brand-gradient text-white"><Sparkles className="size-4" /></span>
          <div><p className="text-sm font-semibold">Nexus AI</p><p className="text-xs text-muted-foreground">{t('nexus.subtitle')}</p></div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <MockBanner show={Boolean(org?.ai.is_mock)} />
          {!conversationId && !pending && (
            <div className="mx-auto mt-10 max-w-2xl text-center">
              <Sparkles className="mx-auto size-10 text-primary" />
              <h2 className="mt-4 text-xl font-semibold">{t('nexus.welcome')}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t('nexus.welcomeBody')}</p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {suggestions.map((s) => <button key={s} onClick={() => void send(s)} className="rounded-xl border p-3 text-start text-sm hover:bg-muted">{s}</button>)}
              </div>
            </div>
          )}
          <div className="mx-auto grid max-w-3xl gap-4">
            {messages.map((m) => <Bubble key={m.id} m={m} />)}
            {pending && (
              <>
                <Bubble m={{ id: 'p', role: 'user', content: pending, created_at: '' }} />
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><span className="size-2 animate-bounce rounded-full bg-primary" /><span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:120ms]" /><span className="size-2 animate-bounce rounded-full bg-primary [animation-delay:240ms]" /> {t('nexus.thinking')}</div>
              </>
            )}
            <ErrorNotice error={error} />
            <div ref={endRef} />
          </div>
        </div>
        <form className="border-t p-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <Textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }} placeholder={t('nexus.placeholder')} className="max-h-40 min-h-11 resize-none" />
            <Button type="submit" size="icon" disabled={!input.trim() || Boolean(pending)} aria-label={t('common.send')}><Send /></Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (m.role === 'user') return <div className="ms-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground" dir="auto">{m.content}</div>;
  return (
    <div className="max-w-[92%]">
      {m.tool_calls && m.tool_calls.length > 0 && (
        <button onClick={() => setOpen(!open)} className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <Wrench className="size-3.5" /> {t('nexus.usedTools', { count: m.tool_calls.length })} <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        </button>
      )}
      {open && <ul className="mb-2 grid gap-1 rounded-lg bg-muted/60 p-2 font-mono text-xs">{m.tool_calls?.map((c, i) => <li key={i} className={c.ok ? '' : 'text-destructive'}>{c.ok ? '✓' : '✗'} {c.tool}</li>)}</ul>}
      <div className="rounded-2xl bg-muted/60 px-4 py-3"><Markdown>{m.content}</Markdown></div>
    </div>
  );
}
