import { cn } from '@nexus/ui';
import type { DeckSpec, Slide } from '@nexus/shared';

/**
 * In-app slide preview rendered from the SAME deck spec used to generate the .pptx,
 * so reviewers approve exactly what gets exported.
 */
function SlideBody({ s, rtl, primary, accent }: { s: Slide; rtl: boolean; primary: string; accent: string }) {
  const title = <h3 className="text-[1.6cqw] font-bold leading-tight text-[#1F2433]">{s.title}</h3>;
  switch (s.kind) {
    case 'cover':
      return (
        <div className="flex h-full flex-col justify-end gap-[1cqw] p-[5cqw] text-white" style={{ background: `#${primary}` }}>
          <p className="text-[3.6cqw] font-bold leading-tight">{s.title}</p>
          <p className="text-[1.7cqw] opacity-85">{s.subtitle}</p>
          <p className="mt-[2cqw] text-[1.2cqw] opacity-80">{s.presenter}</p>
        </div>
      );
    case 'closing':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-[1cqw] p-[5cqw] text-center text-white" style={{ background: `#${primary}` }}>
          <p className="text-[3.6cqw] font-bold">{s.title}</p>
          <p className="text-[1.7cqw] opacity-85">{s.subtitle}</p>
          {s.contact && <p className="text-[1.2cqw] opacity-80">{s.contact}</p>}
        </div>
      );
    case 'agenda':
      return (
        <div className="p-[4cqw]">{title}<ol className="mt-[2cqw] grid grid-cols-2 gap-[1.2cqw]">{s.items.map((it, i) => <li key={i} className="flex items-center gap-[1cqw] text-[1.4cqw]"><span className="flex size-[3cqw] shrink-0 items-center justify-center rounded-full text-[1.2cqw] font-bold text-white" style={{ background: `#${primary}` }}>{i + 1}</span>{it}</li>)}</ol></div>
      );
    case 'bullets':
      return (
        <div className="grid h-full grid-cols-3 gap-[2cqw] p-[4cqw]">
          <div className={cn(s.note ? 'col-span-2' : 'col-span-3')}>{title}<ul className="mt-[2cqw] list-disc space-y-[0.8cqw] ps-[2.5cqw] text-[1.4cqw]">{s.points.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
          {s.note && <div className="mt-[4cqw] rounded-[1cqw] border-2 bg-[#F3F4F8] p-[1.5cqw] text-[1.2cqw] italic" style={{ borderColor: `#${accent}` }}>{s.note}</div>}
        </div>
      );
    case 'two_column':
      return (
        <div className="p-[4cqw]">{title}<div className="mt-[2cqw] grid grid-cols-2 gap-[2cqw]">{[[s.left_title, s.left_points, primary], [s.right_title, s.right_points, accent]].map(([t, p, c], i) => <div key={i} className="rounded-[1cqw] bg-[#F3F4F8] p-[1.5cqw]" style={{ borderTop: `0.5cqw solid #${c as string}` }}><p className="text-[1.5cqw] font-bold" style={{ color: `#${c as string}` }}>{t as string}</p><ul className="mt-[1cqw] list-disc space-y-[0.5cqw] ps-[2cqw] text-[1.2cqw]">{(p as string[]).map((x, j) => <li key={j}>{x}</li>)}</ul></div>)}</div></div>
      );
    case 'kpis':
      return (
        <div className="p-[4cqw]">{title}<div className="mt-[2cqw] grid grid-cols-3 gap-[1.5cqw]">{s.metrics.map((m, i) => <div key={i} className="rounded-[1cqw] border bg-[#F3F4F8] p-[1.5cqw] text-center"><p className="text-[3cqw] font-bold" style={{ color: `#${primary}` }}>{m.value}</p><p className="text-[1.3cqw] font-bold">{m.label}</p><p className="text-[1cqw] text-[#5B6275]">{m.detail}</p></div>)}</div></div>
      );
    case 'chart': {
      const max = Math.max(1, ...s.series.flatMap((x) => x.values));
      const colors = [primary, accent, '10B981', 'F59E0B'];
      return (
        <div className="flex h-full flex-col p-[4cqw]">{title}
          {s.chart_type === 'pie' ? (
            <div className="mt-[2cqw] flex flex-1 items-center justify-center gap-[3cqw]">
              <div className="size-[18cqw] rounded-full" style={{ background: `conic-gradient(${(() => { const vals = s.series[0]?.values ?? []; const total = vals.reduce((a, b) => a + b, 0) || 1; let acc = 0; return vals.map((v, i) => { const from = (acc / total) * 360; acc += v; return `#${colors[i % 4]} ${from}deg ${(acc / total) * 360}deg`; }).join(','); })()})` }} />
              <ul className="space-y-[0.6cqw] text-[1.2cqw]">{s.categories.map((c, i) => <li key={i} className="flex items-center gap-[0.8cqw]"><span className="size-[1.2cqw] rounded-full" style={{ background: `#${colors[i % 4]}` }} />{c}: {s.series[0]?.values[i] ?? 0}</li>)}</ul>
            </div>
          ) : (
            <div className="mt-[2cqw] flex flex-1 items-end gap-[1.5cqw] border-b pb-[0.5cqw]" dir="ltr">
              {s.categories.map((c, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-[0.5cqw]">
                  <div className="flex h-[22cqw] w-full items-end justify-center gap-[0.4cqw]">{s.series.map((ser, j) => <div key={j} className="w-full max-w-[4cqw] rounded-t-[0.4cqw]" style={{ height: `${((ser.values[i] ?? 0) / max) * 100}%`, background: `#${colors[j % 4]}` }} title={`${ser.name}: ${ser.values[i] ?? 0}`} />)}</div>
                  <span className="text-[1cqw] text-[#5B6275]">{c}</span>
                </div>
              ))}
            </div>
          )}
          {s.caption && <p className="mt-[1cqw] text-[1cqw] text-[#5B6275]">{s.caption}</p>}
        </div>
      );
    }
    case 'table':
      return (
        <div className="p-[4cqw]">{title}
          <table className="mt-[2cqw] w-full border-collapse text-[1.1cqw]"><thead><tr>{s.headers.map((h, i) => <th key={i} className="border p-[0.6cqw] text-white" style={{ background: `#${primary}` }}>{h}</th>)}</tr></thead><tbody>{s.rows.map((r, i) => <tr key={i} className={i % 2 ? 'bg-white' : 'bg-[#F3F4F8]'}>{s.headers.map((_, j) => <td key={j} className="border p-[0.6cqw]">{r[j] ?? ''}</td>)}</tr>)}</tbody></table>
        </div>
      );
    case 'timeline':
      return (
        <div className="p-[4cqw]">{title}
          <div className="relative mt-[6cqw] flex justify-between"><div className="absolute inset-x-0 top-[0.9cqw] h-[0.3cqw]" style={{ background: `#${primary}` }} />
            {s.milestones.map((m, i) => <div key={i} className="relative flex flex-1 flex-col items-center text-center"><span className="size-[2cqw] rounded-full border-[0.3cqw] border-white" style={{ background: `#${i === 0 ? accent : primary}` }} /><p className="mt-[1cqw] text-[1.2cqw] font-bold" style={{ color: `#${primary}` }}>{m.date}</p><p className="text-[1.2cqw] font-bold">{m.title}</p><p className="text-[1cqw] text-[#5B6275]">{m.detail}</p></div>)}
          </div>
        </div>
      );
    case 'quote':
      return <div className="flex h-full flex-col justify-center p-[5cqw]">{title}<blockquote className="mt-[2cqw] border-s-[0.6cqw] ps-[2cqw] text-[2.2cqw] italic" style={{ borderColor: `#${accent}` }}>“{s.quote}”</blockquote><p className="mt-[1cqw] text-[1.3cqw] text-[#5B6275]">— {s.attribution}</p></div>;
  }
  void rtl;
}

export function SlidePreview({ slide, index, spec, primary = '312E81', accent = '0EA5E9', company }: { slide: Slide; index: number; spec: DeckSpec; primary?: string; accent?: string; company: string }) {
  const rtl = spec.language === 'ar';
  const full = slide.kind === 'cover' || slide.kind === 'closing';
  return (
    <div className="@container relative aspect-video w-full overflow-hidden rounded-lg border bg-white text-[#1F2433] shadow-sm" dir={rtl ? 'rtl' : 'ltr'} style={{ containerType: 'inline-size' }}>
      {!full && <div className="absolute inset-x-0 top-0 h-[0.9cqw]" style={{ background: `#${primary}` }} />}
      <SlideBody s={slide} rtl={rtl} primary={primary} accent={accent} />
      {!full && <div className="absolute inset-x-[4cqw] bottom-[1.5cqw] flex justify-between text-[0.9cqw] text-[#5B6275]"><span>{company}</span><span>{index + 1}</span></div>}
    </div>
  );
}
