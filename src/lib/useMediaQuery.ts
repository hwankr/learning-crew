/* 화면 폭 갈림길 — 데스크톱(≥900px)과 모바일은 알림을 서로 다른 컴포넌트로 본다
   (벨 드롭다운 / 전체 화면 내역). 레이아웃 차이라면 CSS가 맡았겠지만 무엇을 그릴지가
   갈리므로 렌더 중에 알아야 한다. 그 외의 반응형은 전부 styles.css의 미디어 쿼리다. */
import { useSyncExternalStore } from 'react';

const DESKTOP = '(min-width: 900px)';

function subscribe(onChange: () => void): () => void {
  const mq = matchMedia(DESKTOP);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(DESKTOP).matches);
}
