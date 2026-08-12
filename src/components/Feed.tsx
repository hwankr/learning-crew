import type { Entry, MemberId } from '../../shared/types';
import { W } from '../lib/constants';
import { EntryCard, type EntryActions } from './EntryCard';

export function Feed({
  entries, todayKey, yKey, meId, editingId, actions,
}: {
  entries: Entry[];
  todayKey: string;
  yKey: string;
  meId: MemberId;
  editingId: string | null;
  actions: EntryActions;
}) {
  const dayLabel = (k: string): string => {
    if (k === todayKey) return '오늘';
    if (k === yKey) return '어제';
    const d = new Date(k + 'T12:00:00');
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${W[d.getDay()]})`;
  };
  const keys = [...new Set(entries.map((e) => e.day))].sort().reverse();

  return (
    <div>
      {keys.map((k) => (
        <div key={k}>
          <div className="group-head">
            <span className="group-label">{dayLabel(k)}</span>
            <span className="group-line" />
          </div>
          <div>
            {entries
              .filter((e) => e.day === k)
              .sort((a, b) => b.time.localeCompare(a.time))
              .map((e) => (
                <EntryCard key={e.id} e={e} compact={false} mine={e.m === meId}
                  editing={e.id === editingId} actions={actions} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
