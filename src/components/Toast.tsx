/* 짧은 알림 — 화면이 스스로 말해 주지 못하는 변화만 알린다(체크인은 크루 패널이
   접혀 있으면 아무것도 안 바뀐 것처럼 보인다). 초점은 뺏지 않고 읽어만 준다. */

/** 토스트를 띄우는 함수 — App이 타이머를 쥐고 있고, 필요한 화면에 이걸 내려 준다. */
export type ShowToast = (text: string) => void;

export function Toast({ text }: { text: string }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      {text}
    </div>
  );
}
