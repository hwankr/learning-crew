/* 지금 상태 체크인 — 장소 칩을 탭하면 켜지고, 켜진 칩을 다시 탭하면 꺼진다. */
import { PLACES, isStatusActive, type MemberStatus, type Place } from '../../shared/types';
import { PLACE_ICON, fmtElapsed, type CopySet } from '../lib/constants';

export function StatusBar({
  status, wit, now, onSet,
}: {
  status: MemberStatus | undefined;
  wit: CopySet;
  now: number;
  onSet: (on: boolean, place: Place | null) => void;
}) {
  const active = isStatusActive(status, now);
  return (
    <div className={'status-bar' + (active ? ' on' : '')}>
      <div className="status-line">
        {active ? (
          <>
            <span className="live-dot" />
            <span className="status-live">{wit.statusLive(status.place ?? '기타')}</span>
            <span className="status-elapsed">{status.since ? fmtElapsed(status.since, now) : ''}</span>
            <button className="status-end" onClick={() => onSet(false, null)}>{wit.statusEnd}</button>
          </>
        ) : (
          <span className="status-ask">{wit.statusAsk}</span>
        )}
      </div>
      <div className="status-places">
        {PLACES.map((p) => {
          const sel = active && status.place === p;
          return (
            <button key={p} className={'status-chip' + (sel ? ' sel' : '')}
              onClick={() => onSet(!sel, sel ? null : p)}>
              <span className="status-chip-ico">{PLACE_ICON[p]}</span>
              {p}
            </button>
          );
        })}
      </div>
    </div>
  );
}
