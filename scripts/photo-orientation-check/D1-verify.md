# D1 이미지 방향 실브라우저 검증

검증일: 2026-08-15 (KST)

## 자동 하네스

- 위치: `scripts/photo-orientation-check/`
- 실행: 저장소 루트에서 `npm run check:orientation`
- 경로: Vite가 실제 `src/lib/image.ts`의 `prepareUpload`를 로드하고, Windows 헤드리스 Chrome이 페이지를 실행한다.
- fixture: EXIF orientation 1/6/8 JPEG. 각 파일은 회전 후 좌상단 빨강, 우상단 초록, 좌하단 파랑, 우하단 노랑이 되도록 raw pixel을 배치했다.
- 판정: `prepareUpload`의 full JPEG를 다시 픽셀로 읽어 네 marker 순서와 `120x80` 크기를 JSON으로 비교한다. IndexedDB는 사용하지 않는다.

## 판정 결과

| 브라우저 | 상태 | 결과 |
|---|---|---|
| Windows Chrome 151.0.7922.138 (headless) | 확인 | EXIF 1/6/8 모두 `120x80`, marker `red/green/blue/yellow`, 전부 PASS |
| Safari 16 | 미확인 | 수동 확인 필요 |
| Safari 17.1 | 미확인 | 수동 확인 필요 |
| 현행 Safari | 미확인 | 수동 확인 필요 |

Chrome JSON 요약:

```json
{
  "pass": true,
  "browser": "HeadlessChrome/151.0.0.0 (Windows NT 10.0; Win64; x64)",
  "results": [
    { "orientation": 1, "output": { "w": 120, "h": 80 }, "markers": ["red", "green", "blue", "yellow"], "pass": true },
    { "orientation": 6, "output": { "w": 120, "h": 80 }, "markers": ["red", "green", "blue", "yellow"], "pass": true },
    { "orientation": 8, "output": { "w": 120, "h": 80 }, "markers": ["red", "green", "blue", "yellow"], "pass": true }
  ]
}
```

## Safari 수동 확인 방법

Safari가 있는 머신의 저장소 루트에서 `npm install` 후 아래를 실행한다.

```sh
npm run dev -- --host 0.0.0.0
```

같은 머신의 Safari에서는 `http://localhost:5173/scripts/photo-orientation-check/`를 연다. Safari가 다른 머신에 있으면 `localhost`를 개발 머신의 접근 가능한 호스트명/IP로 바꾸며, 페이지 JSON의 최상위 `pass: true`와 orientation 1/6/8 각 `pass: true`를 확인한다.
