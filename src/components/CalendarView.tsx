import type { Entry, MemberId } from '../../shared/types';
import { MEMBERS, W, dayKey, type CopySet } from '../lib/constants';
import { Icon } from './icons';
import { EntryCard, type EntryActions } from './EntryCard';

export function CalendarView({
  entries, calOff, setCalOff, selDay, setSelDay, todayKey, meId, editingId, wit, actions,
}: {
  entries: Entry[];
  calOff: number;
  setCalOff: (n: number) => void;
  selDay: string;
  setSelDay: (k: string) => void;
  todayKey: string;
  meId: MemberId;
  editingId: string | null;
  wit: CopySet;
  actions: EntryActions;
}) {
  const now = new Date();
  const calBase = new Date(now.getFullYear(), now.getMonth() + calOff, 1);
  const daysIn = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 0).getDate();
  const lead = calBase.getDay();

  const byDay = new Map<string, Set<MemberId>>();
  for (const e of entries) {
    if (!byDay.has(e.day)) byDay.set(e.day, new Set());
    byDay.get(e.day)!.add(e.m);
  }

  const cells = [];
  for (let i = 0; i < lead; i++) {
    cells.push(<button key={'lead' + i} className="cal-cell" style={{ visibility: 'hidden' }} />);
  }
  for (let n = 1; n <= daysIn; n++) {
    const k = dayKey(new Date(calBase.getFullYear(), calBase.getMonth(), n));
    const isToday = k === todayKey;
    const isSel = k === selDay;
    const isFuture = k > todayKey;
    const dots = MEMBERS.filter((m) => byDay.get(k)?.has(m.id));
    cells.push(
      <button key={k}
        className={'cal-cell' + (isSel ? ' sel' : '') + (isToday ? ' today' : '') + (isFuture ? ' future' : '')}
        onClick={() => setSelDay(k)}>
        <span className="cal-num">{n}</span>
        <span className="cal-day-dots">
          {dots.map((m) => (
            <span key={m.id} className="cal-day-dot" style={{ background: m.color }} />
          ))}
        </span>
      </button>,
    );
  }

  const selList = entries.filter((e) => e.day === selDay).sort((a, b) => b.time.localeCompare(a.time));
  const selD = new Date(selDay + 'T12:00:00');

  return (
    <div>
      <div className="cal-head">
        <div className="cal-title">{calBase.getFullYear()}년 {calBase.getMonth() + 1}월</div>
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => setCalOff(calOff - 1)}>
            <Icon d="M15 6l-6 6 6 6" size={17} sw={2.4} />
          </button>
          <button className="icon-btn" onClick={() => setCalOff(calOff + 1)}>
            <Icon d="M9 6l6 6-6 6" size={17} sw={2.4} />
          </button>
        </div>
      </div>
      <div className="cal-week">
        {W.map((d, i) => (
          <span key={d} className={'cal-wd' + (i === 0 ? ' sun' : '')}>{d}</span>
        ))}
      </div>
      <div className="cal-grid">{cells}</div>
      <div className="sel-head">
        <span className="sel-label">
          {selD.getMonth() + 1}월 {selD.getDate()}일 ({W[selD.getDay()]}) · {selList.length}개
        </span>
        <span className="group-line" />
      </div>
      {selList.length === 0 && <div className="sel-empty">{wit.calEmpty}</div>}
      <div>
        {selList.map((e) => (
          <EntryCard key={e.id} e={e} compact mine={e.m === meId} editing={e.id === editingId}
            actions={actions} />
        ))}
      </div>
    </div>
  );
}
