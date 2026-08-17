import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/* 오버레이 퇴장 자리 — 조건부 렌더는 조건이 꺼지는 순간 unmount라 퇴장 모션이 설 틈이 없다.
   <Exit>{cond && <오버레이/>}</Exit>로 감싸면 꺼진 뒤에도 마지막 children을 EXIT_MS 동안
   쥐고 .closing을 흘려 CSS가 역방향 모션을 돌린다. 래퍼는 display:contents(.exit-scope)라
   레이아웃·z-index에 아무 자리도 차지하지 않는다.
   children을 상태에 담지 않는다 — 아이덴티티가 렌더마다 새라 열려 있는 내내 재렌더가 돈다.
   닫힘도 렌더 중 파생으로 그린다(tail은 이미 참) — effect로 미루면 닫히는 커밋에 한 번
   unmount됐다 되살아나며 진입 모션·포커스 정리가 헛돈다. */

/** CSS의 퇴장 애니메이션 길이와 맞물려 있다 — styles.css의 fade-out/pop-out과 같이 움직일 것 */
export const EXIT_MS = 150;

export function Exit({ children }: { children: ReactNode }) {
  const live = children || null;
  const on = live !== null;
  const held = useRef<ReactNode>(null);
  if (live) held.current = live;

  /* 세대 key — 닫히는 150ms 안에 같은 오버레이를 다시 열면 React가 같은 타입의 child를
     업데이트로 이어 붙여 입력·포커스 상태가 지난 세션에서 이월된다. 열림마다 key를 바꿔
     반드시 새 마운트로 세운다(닫히던 트리는 그 자리에서 조용히 걷힌다). */
  const gen = useRef(0);
  const prevOn = useRef(false);
  if (on !== prevOn.current) {
    if (on) gen.current++;
    prevOn.current = on;
  }

  // 닫힌 뒤에도 붙잡는 꼬리 — 열림에서 세워 두고, 닫히면 타이머가 걷는다
  const [tail, setTail] = useState(false);
  if (on && !tail) setTail(true);
  useEffect(() => {
    if (on || !tail) return;
    const t = setTimeout(() => {
      setTail(false);
      held.current = null;
    }, EXIT_MS);
    return () => clearTimeout(t);
  }, [on, tail]);

  if (live) return <div key={gen.current} className="exit-scope">{live}</div>;
  if (tail && held.current) {
    /* inert — 퇴장하는 150ms 동안 포커스 트랩·Tab이 이 서브트리에 들르지 못하게.
       초점이 안에 남아 있었다면 브라우저가 blur시키고, 진짜 unmount 때 트랩 정리가
       열었던 자리(없으면 fallback)로 되돌린다. 보조기기 트리에서도 함께 빠진다. */
    return <div key={gen.current} className="exit-scope closing" inert>{held.current}</div>;
  }
  return null;
}
