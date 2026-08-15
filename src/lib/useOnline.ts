/* 지금 연결돼 있는지 — 사진 대기 안내가 업로드 큐(photoUpload.ts)와 같은 기준을 봐야
   "저장하면 대기로 남는다"는 안내와 실제 상태가 어긋나지 않는다. */
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
