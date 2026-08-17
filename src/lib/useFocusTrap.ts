import { useEffect, useRef, type RefObject } from 'react';

/** 초점이 갈 수 있는 요소. inert 하위·disabled·tabindex="-1"은 뺀다 —
    화면 밖으로 밀어 둔 단계 패널이나 지난 달의 미래 날짜 버튼까지 Tab이 들르면 안 된다. */
const TABBABLE = 'a[href],button,input,select,textarea,[tabindex]';

function tabbables(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.hasAttribute('disabled') && !el.closest('[inert]'),
  );
}

/** 떠 있는 동안 Tab을 상자 안에 가두고, 닫히면 열었던 자리로 초점을 돌려준다.
    오버레이는 마우스만 막는다 — Tab은 덮개를 그냥 통과해서 뒤 화면 버튼까지 초점이 새고,
    거기서 Enter를 누르면 보이지도 않는 버튼이 눌린다(모달이 뒤에 겹쳐 열리는 식으로).
    transform으로 밀어 둔 부분은 여전히 탭 순서에 남으므로, 가려진 쪽에는 inert를 달아야
    이 훅과 브라우저의 기본 Tab 이동이 같은 범위를 본다. */
export function useFocusTrap(
  box: RefObject<HTMLElement | null>,
  /** 열었던 요소가 닫는 사이 사라졌을 때 초점을 받을 자리(예: 기록 남기기 버튼).
      없으면 초점이 문서 맨 앞(body)으로 떨어져 키보드·낭독기 사용자가 위치를 잃는다. */
  fallback?: RefObject<HTMLElement | null>,
): void {
  /* 열기 직전의 초점은 첫 렌더에서 잡아 둔다 — effect까지 미루면 늦는다.
     autoFocus(기록 모달의 본문 칸)는 커밋 단계에서 이미 초점을 가져가므로,
     그때 읽으면 "열었던 자리"가 아니라 모달 안의 요소가 잡히고, 닫힐 때
     그 요소는 사라진 뒤라 초점이 body로 떨어진다. */
  const opener = useRef<Element | null | undefined>(undefined);
  // document가 없는 정적 렌더(테스트의 renderToStaticMarkup)에서도 컴포넌트가 그려져야 한다
  if (opener.current === undefined) {
    opener.current = typeof document === 'undefined' ? null : document.activeElement;
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Tab') return;
      const root = box.current;
      if (!root) return;
      const items = tabbables(root);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      // 상자 밖으로 샌 초점은 회수하고, 양 끝에서는 반대쪽 끝으로 돌린다
      if (!(active instanceof Node) || !root.contains(active)) {
        ev.preventDefault();
        first.focus();
      } else if (ev.shiftKey && active === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && active === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      /* 닫히는 사이 다른 대화상자가 이미 초점을 가져갔으면 그대로 두고 나온다.
         작성 메뉴에서 갈래를 고르면 메뉴가 닫히고 시트가 같은 커밋에서 열리는데, 시트의
         autoFocus는 커밋 단계라 이 정리(패시브 단계)보다 먼저다 — 여기서 초점을 도로
         끌어오면 방금 연 시트 밖에 초점이 남아 키보드로는 시트에 들어갈 수가 없다. */
      const active = document.activeElement;
      const dialog = active instanceof HTMLElement ? active.closest('[role="dialog"]') : null;
      if (dialog?.isConnected && dialog !== box.current) return;
      /* 퇴장 모션이 unmount를 늦춘 사이(<Exit>의 150ms) 사용자가 이미 뒤 화면 어딘가에
         초점을 옮겼다면 그대로 둔다 — 늦게 도는 이 정리가 도로 빼앗으면 안 된다.
         정상 닫힘에서는 inert가 초점을 body로 떨어뜨려 놓으므로 여기 걸리지 않는다. */
      if (
        active instanceof HTMLElement && active.isConnected &&
        active !== document.body && !box.current?.contains(active)
      ) return;
      /* 열었던 요소가 그새 사라졌으면(삭제 확정, 날짜를 바꿔 저장해 카드가 다른 날로 옮겨간
         경우 등) 정해 둔 자리로 보낸다. 살아 있어도 초점을 못 받는 상태(숨김·disabled)일 수
         있으니 "정말 들어갔는지" 확인하고, 안 들어갔으면 그때도 대체 자리로 보낸다. */
      const back = opener.current;
      const restorable = back instanceof HTMLElement && back.isConnected && back !== document.body;
      if (restorable) back.focus();
      if (!restorable || document.activeElement !== back) fallback?.current?.focus();
    };
  }, [box, fallback]);
}
