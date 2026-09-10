import { useState, type CSSProperties } from 'react';
import { MEMBERS } from '../lib/constants';
import type { CharacterClip } from '../lib/pixelCharacter';
import { PixelCharacter } from './PixelCharacter';
import { useRoomMotion } from './useRoomMotion';

const SCENES: { clip: CharacterClip; label: string; caption: string }[] = [
  { clip: 'idle', label: '눈 맞추기', caption: '눈을 깜빡이고, 가만히 숨을 쉬어요.' },
  { clip: 'walk-side', label: '산책', caption: '발걸음에 맞춰 팔과 머리카락도 살랑.' },
  { clip: 'study', label: '공부', caption: '책장을 넘기고, 필기하고, 키보드를 두드려요.' },
  { clip: 'sip', label: '차 한 모금', caption: '따뜻한 한 모금에 살짝 미소 지어요.' },
  { clip: 'chat', label: '이야기', caption: '고개를 끄덕이며 서로의 이야기에 귀 기울여요.' },
  { clip: 'water', label: '물 주기', caption: '물뿌리개를 기울여 작은 정원을 돌봐요.' },
  { clip: 'greet', label: '쉬어가기', caption: '반가운 손인사, 그리고 기분 좋은 기지개.' },
];

/** A close-up of the same frames used in the campus; preview controls never change check-ins. */
export function PixelCharacterGallery() {
  const [scene, setScene] = useState(SCENES[0]!);
  const [direction, setDirection] = useState<'east' | 'west' | 'south' | 'north'>('east');
  const [paused, setPaused] = useState(false);
  const allowed = useRoomMotion();
  const walking = scene.clip === 'walk-side';
  const clip = walking ? direction === 'south' ? 'walk-front' : direction === 'north' ? 'walk-back' : 'walk-side' : scene.clip;
  return <section className="pixel-character-gallery" aria-label="크루 캐릭터 가까이 보기">
    <div className="pixel-character-gallery-head">
      <div><p>MEET YOUR LITTLE CREW</p><h2>작은 표정까지, 가까이.</h2></div>
      <button type="button" className="pixel-character-pause" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
        {paused ? '미리보기 재생' : '미리보기 멈춤'}
      </button>
    </div>
    <div className="pixel-character-scenes" role="group" aria-label="캐릭터 동작 미리보기">
      {SCENES.map((option) => <button type="button" key={option.clip} aria-pressed={scene.clip === option.clip}
        onClick={() => setScene(option)}>{option.label}</button>)}
    </div>
    <div className="pixel-character-cast" data-preview-clip={clip}>
      {MEMBERS.map((m, index) => <figure key={m.id} style={{ '--character-tint': m.soft, '--px-delay': `${index * -.47}s` } as CSSProperties}>
        <div className="pixel-character-plinth"><span className="pixel-character-ground" />
          <svg viewBox="0 0 192 224" className="pixel-character-closeup" aria-hidden="true">
            <PixelCharacter m={m} previewClip={clip} facing={walking ? direction : 'east'} motion={allowed && !paused} />
          </svg>
        </div>
        <figcaption><span style={{ background: m.color }} />{m.name}</figcaption>
      </figure>)}
    </div>
    <div className="pixel-character-gallery-foot">
      <p>{scene.caption}</p>
      {walking && <div className="pixel-character-directions" role="group" aria-label="산책 방향">
        {([['east', '오른쪽'], ['south', '앞모습'], ['west', '왼쪽'], ['north', '뒷모습']] as const).map(([value, label]) =>
          <button type="button" key={value} aria-pressed={direction === value} onClick={() => setDirection(value)}>{label}</button>)}
      </div>}
    </div>
  </section>;
}
