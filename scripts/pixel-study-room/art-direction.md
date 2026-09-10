# 픽셀 도서관 그래픽 제작 기록

2026-09-10 · `feat/pixel-study-room`

## 적용한 그래픽

숲속 도서관의 기존 640 × 400 좌표계를 기준으로 배경을 새로 제작했다.
노을·밤·비 각각의 조명과 소재 반사를 그린 이미지 위에, 실시간 상태를 따르는
캐릭터·책상·의자·발걸음·입자 효과를 별도로 렌더링한다.
캐릭터의 머리카락·피부·옷·신발과 가구의 나뭇결·황동 손잡이도 보강했다.
책상 조명은 가장자리가 부드럽게 사라지는 그라데이션을 사용한다.

이미지 로딩 중이거나 실패한 경우 기존 SVG 배경을 보여준다.
캐릭터 선택·이동·상태 반영은 배경 이미지 로딩과 독립적으로 동작한다.

## 파일과 생성 방법

| 분위기 | 프로젝트 파일 | 전송 크기 |
| --- | --- | --- |
| 노을 | [library-sunset-v3.webp](../../src/assets/pixel-room/library-sunset-v3.webp) | 약 586 kB |
| 밤 | [library-night-v3.webp](../../src/assets/pixel-room/library-night-v3.webp) | 약 491 kB |
| 비 | [library-rain-v3.webp](../../src/assets/pixel-room/library-rain-v3.webp) | 약 511 kB |

- 생성: **내장 `image_gen` 도구**. API/CLI 생성 방식은 사용하지 않았다.
- 참조: [기존 코드로 렌더링한 빈 도서관 배치](art-layout-reference.png). 공부 책상과 캐릭터를 제외한 화면을 사용했다.
- 변형: 노을 배경을 참조하여 밤·비의 조명만 변경했다.
- 저장: 생성한 PNG를 그림 편집 없이 Sharp CLI로 WebP 품질 92, effort 6으로 인코딩했다.
- 전달: Vite가 파일명에 해시를 붙여 빌드 자산으로 제공한다. 추가 런타임 패키지는 없다.
- 원본 생성 파일은 Codex의 기본 생성 이미지 폴더에 유지하며, 앱은 위 프로젝트 내부 파일만 참조한다.

## 실제 사용한 프롬프트

### 배경

```text
Use case: sketch-to-render.
Asset type: production background art for a live, animated cozy pixel-art study room. Deliver one finished 1280 x 800 landscape bitmap (8:5), edge to edge.
Image 1 is a STRICT FLOOR-PLAN AND CAMERA REFERENCE, but its simplistic graphics must be completely repainted at a much higher artistic quality.
Primary request: transform this flat mockup into a beautiful, richly crafted pixel-art forest library, with the polish of a premium indie game. Fine intentional pixel clusters, layered botanical silhouettes, irregular leaf clusters in at least five shades, mossy bark, tiny fern fronds, rich oiled walnut wood grain, worn floorboards, carved window frames, glass reflections, individually shaded books, woven rug fibers, stone edging around the pond and reflected sky in deep teal water. Restrained warm amber highlights against lush cool forest shadows. Delicate ambient occlusion, directional edge lighting and substantial material depth. Sharp and clearly pixel-art, not vector shapes, not blurry digital painting, not photorealistic, not a 3D render. Avoid coarse giant square leaves and flat rectangular shapes.
LOCK COMPOSITION: elevated straight-on orthographic cutaway, horizontal back wall, horizontal floorboards; absolutely no isometric rotation. Do not move, resize, or reframe the building, windows, perimeter bookcases, rug, garden benches, path or pond. In a 640x400 logical coordinate system (image is exactly 2x this): building occupies x=130..562, back wall y=40..96; open walkable wooden floor x=185..506,y=100..278; lower front edge at y=280 with a clear centered entry x=323..377; path center x=350 from entry to bottom. Left pond x=25..133,y=300..370. Garden bench seats centered (220,350) and (468,351). Keep all these positions. No protruding props or vegetation on the open central floor.
Perimeter dressing: deepen the existing bookcases and coffee cabinet; lush ivy around exterior posts, leafy plants, mossy stones, layered woodland at the edges. The back wall has two arched windows where they already are. Keep the existing five study-desk positions COMPLETELY EMPTY open floor, because animated desks and people will be composited there by the app. NO study desks, NO study chairs, NO table lamps, NO people, NO animals. Keep the two existing outdoor benches and green rug.
Lighting: soft warm late-afternoon ambient light, subtle contact shadows, no bright shafts of light baked across the central floor. No visible sun or moon, no rain or particles; the app animates those separately. Small lanterns and string lights can stay, with restrained warm illumination.
Text: no text, letters, symbols, logos or watermark. Keep the upper signboard as elegant blank dark stained wood with a thin brass edge.
Constraints: preserve the camera and the empty floor plan exactly; fill the entire frame with the scene, no UI, no surrounding page, no border, no scrollbar. High quality original game-ready background, detailed but calm.
```

### 밤

```text
Use case: lighting-weather. Image 1 is the EXACT edit target. This is a live game background, so retain EVERY object, edge, pixel-art texture, room and furniture footprint, bench position, clear empty floor, camera, framing, proportions and exact image dimensions. Do not add furniture, people, animals or text. Do not shift any geometry. Change ONLY lighting, sky and weather. Keep original crisp finely detailed pixel art. Output one full-frame landscape 8:5 scene. Turn this exact forest library into a magical quiet night: deep midnight teal and blue woodland, warm amber pools of light from the existing wall lanterns and string bulbs, soft warm reflections in the polished wood, dark blue window glass with a tiny crescent moon through the right window only. Outside the lamp pools, deep cool garden shadows and moonlit foliage edges, subtle stars through the foliage gaps. The indoor empty floor and rug remain readable under soft amber bounce light. Pond reflects blue night sky and a few warm lantern highlights. High quality cinematic pixel-game lighting with smooth falloff, not harsh round spotlights. No visible sun, no golden daytime light, no daylight streaks on the floor. No rain and no fireflies baked into the bitmap; the app adds animated fireflies.
```

### 비

```text
Use case: lighting-weather. Image 1 is the EXACT edit target. This is a live game background, so retain EVERY object, edge, pixel-art texture, room and furniture footprint, bench position, clear empty floor, camera, framing, proportions and exact image dimensions. Do not add furniture, people, animals or text. Do not shift any geometry. Change ONLY lighting, sky and weather. Keep original crisp finely detailed pixel art. Output one full-frame landscape 8:5 scene. Turn this exact forest library into a calm rainy overcast afternoon. Cool muted sage and blue-gray foliage, slate blue sky through both windows, soft diffuse light, glistening wet stone path, damp moss and subtle reflected window lights on water. Keep the indoor library warmly sheltered with softly lit amber wall lanterns; the wooden floor and rug are dry. Fine droplets and condensation on the window glass only. NO rain streaks in the air, no ripples or splashes baked into the image, because the app will animate those. No sun, no moon, no bright shafts of daylight. Detailed elegant premium pixel art with rich material texture and restrained color.
```
