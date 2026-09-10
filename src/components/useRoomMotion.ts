import { useSyncExternalStore } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
function subscribe(cb: () => void): () => void {
  const media = window.matchMedia(REDUCED_MOTION);
  media.addEventListener('change', cb);
  document.addEventListener('visibilitychange', cb);
  return () => {
    media.removeEventListener('change', cb);
    document.removeEventListener('visibilitychange', cb);
  };
}
function allowed(): boolean {
  return !window.matchMedia(REDUCED_MOTION).matches && document.visibilityState !== 'hidden';
}
export function useRoomMotion(): boolean {
  return useSyncExternalStore(subscribe, allowed, () => false);
}
