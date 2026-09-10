/* 지금 상태 체크인 — 꺼져 있으면 장소 타일 2×2, 켜면 경과 시간을 세는 초록 카드.
   끄기는 카드의 "공부 종료" 하나뿐이다(장소 타일을 다시 눌러 끄던 예전 규칙은
   켜진 동안 타일이 아예 안 보이므로 사라졌다). */
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
  if (isStatusActive(status, now)) {
    const place = status.place ?? '기타';
    return (
      // key — 켬/끔이 같은 div의 클래스 교체로 이어지면 진입 모션이 다시 돌지 않는다
      <div key="on" className="chk-card">
        <div className="chk-head">
          <span className="live-dot" />
          <span className="chk-on">{wit.statusOn}</span>
          <span className="chk-place-ico">{PLACE_ICON[place]}</span>
        </div>
        <div className="chk-time">
          <span className="chk-elapsed">{status.since ? fmtElapsed(status.since, now) : ''}</span>
          <span className="chk-place">{wit.placeAt(place)}</span>
        </div>
        <button className="chk-end" onClick={() => onSet(false, null)}>{wit.statusEnd}</button>
      </div>
    );
  }
  return (
    // 종료 쪽도 같은 등장으로 — 카드가 사라진 자리에 타일이 뚝 서지 않는다
    <div key="off" className="chk-off">
      <div className="chk-cap">
        <span className="chk-cap-dot" />
        <span className="chk-cap-text">{wit.statusAsk}</span>
      </div>
      <div className="chk-places">
        {PLACES.map((p) => (
          <button key={p} className="chk-tile" onClick={() => onSet(true, p)}>
            <span className="chk-tile-ico">{PLACE_ICON[p]}</span>
            <span className="chk-tile-label">{p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
