import type { Member } from '../lib/constants';
import { ROOM_PERSONALITY, type RoomAction, type RoomFacing } from '../lib/pixelRoom';

/** Original layered sprites; half-pixel accents add fabric, hair and skin shading. */
export function PixelCharacter({ m, pose = 'idle', facing = 'south', action = 'rest' }: {
  m: Member;
  pose?: 'idle' | 'walk' | 'study';
  facing?: RoomFacing;
  action?: RoomAction;
}) {
  const personality = ROOM_PERSONALITY[m.id];
  const rest = action === 'coffee' ? 'sip' : action === 'read' || action === 'browse' ? 'read' : action === 'rest' ? personality.rest : 'still';
  const hairLight = `color-mix(in srgb, ${m.hairC} 68%, #bfa181)`;
  const hairMid = `color-mix(in srgb, ${m.hairC} 84%, #bfa181)`;
  const clothDark = `color-mix(in srgb, ${m.color} 65%, #344846)`;
  const clothLight = `color-mix(in srgb, ${m.color} 72%, #ffebbd)`;
  return (
    <g className={`px-person px-person-${pose} px-study-${personality.study} px-rest-${rest} px-action-${action}`} data-facing={facing}>
      <g className="px-facing-front">
      <g className="px-person-body">
        {m.id === 'kj' && <path d="M4 7h16v20h-4V15H8v12H4z" fill={m.hairC} />}
        {m.id === 'jj' && <path d="M0 7h5v8H0zM19 7h5v8h-5z" fill={m.hairC} />}
        <path d="M7 2h10v2h3v3h2v10h-3v3H5v-3H2V7h2V4h3z" fill={m.hairC} />
        <path d="M7 2h10v1H7zM4 5h2v2H4zM3 8h1v6H3z" fill={hairLight} />
        <path d="M7 4h8v1H7zM5 6h5v2H5zM16 5h3v3h-3zM19 9h2v6h-2z" fill={hairMid} />
        <path d="M3 16h3v3h12v-2h3v2h-3v2H6v-1H3z" fill="#293137" opacity=".5" />
        <path d="M6 9h12v3h2v4h-2v3H6v-3H4v-4h2z" fill="#efc4a4" />
        <path d="M6 9h12v5H6z" fill="#f8d9b7" />
        <path d="M7 10h3v1H7zM5 12h2v3H5zM8 14h4v2H8z" fill="#ffe7c6" />
        <path d="M18 12h1v4h-2v2H7v-1h9v-2h2zM4 14h2v2H4z" fill="#d5a18b" />
        <path d="M6 15h2v1H6zM16 15h2v1h-2z" fill="#e8ae96" />
        {m.id === 'wg' ? <path d="M4 6h16v3h-3v3h-3V9h-3v2H8V9H4z" fill={m.hairC} />
          : m.id === 'kj' ? <path d="M4 6h16v5h-4V8h-5v3H4z" fill={m.hairC} />
            : <path d="M4 6h16v4h-6V8H9v3H4z" fill={m.hairC} />}
        <path d="M6 5h5v1H6zM12 4h4v1h-4zM5 7h2v1H5z" fill={hairLight} />
        {m.id === 'wg' && <path d="M14 6h4v1h-4zM8 8h2v1H8z" fill={hairMid} />}
        {m.id === 'jj' && <path d="M1 8h3v2H1zM20 8h3v2h-3z" fill="#d8a264" />}
        {m.id === 'kj' && <><path d="M17 7h4v2h-4zM19 6h1v4h-1z" fill="#ebc1b0" /><path d="M5 18h1v7H5zM18 18h1v7h-1z" fill={hairLight} /></>}
        <g className="px-eyes" fill="#35363b">
          <path d="M8 12h2v2H8zM15 12h2v2h-2z" />
          <path d="M8 12h.7v.7H8zM15 12h.7v.7h-.7z" fill="#fff3d7" />
        </g>
        {m.id === 'th' && <path d="M6 11h5v4H6zM14 11h5v4h-5zM11 12h3" fill="none" stroke="#5d6464" />}
        <path d="M11 16h3v1h-3z" fill="#c98c7a" />
        <path d="M8 19h8v3H8z" fill="#e8b493" />
        <path d="M5 20h4v2h6v-2h4v7H5z" fill={m.color} />
        <path d="M5 21h2v6H5zM16 21h3v6h-3zM7 26h9v1H7z" fill={clothDark} />
        <path d="M7 21h2v5H7zM9 22h7v1H9z" fill={clothLight} />
        <path d="M8 20h1v2h6v-2h1v3H8z" fill="#fff0d4" />
        {m.id === 'sh' && <><path d="M10 24h5v2h-5z" fill={clothDark} /><path d="M10 24h5v.5h-5zM9 22h.5v2H9zM15 22h.5v2H15z" fill="#ffe4a2" /></>}
        {m.id === 'wg' && <path d="M11.5 23h1v4h-1zM9 24h.7v.7H9zM14 24h.7v.7H14z" fill="#f6e7c8" />}
        {m.id === 'th' && <><path d="M8 22h1v5H8zM15 22h1v5h-1z" fill="#dec69c" /><path d="M10 24h4v2h-4z" fill={clothDark} /></>}
        {m.id === 'jj' && <path d="M11 23h3v4h-3zM7 24h2v1H7zM15 24h2v1h-2z" fill="#f7d89f" />}
        {m.id === 'kj' && <path d="M6 25h12v3H6zM8 26h1v2H8zM14 26h1v2h-1z" fill={clothDark} />}
        {pose === 'walk' && <path d="M6 20h2v7H6zM16 20h2v7h-2z" fill="#af875f" />}
        <g className="px-arm-left">
          <path d="M3 21h3v5H3z" fill={m.color} />
          <path d="M3 21h1v4H3z" fill={clothLight} /><path d="M5 23h1v3H5z" fill={clothDark} />
          <path d="M3 26h3v3H3z" fill="#efc4a4" />
          <path d="M3 26h2v1H3z" fill="#ffe0b8" /><path d="M5 27h1v2H5z" fill="#c98e75" />
        </g>
        <g className="px-arm-right">
          <path d="M18 21h3v5h-3z" fill={m.color} />
          <path d="M18 21h2v1h-2z" fill={clothLight} /><path d="M20 22h1v4h-1z" fill={clothDark} />
          <path d="M18 26h3v3h-3z" fill="#efc4a4" />
          <path d="M18 26h2v1h-2z" fill="#ffe0b8" /><path d="M20 27h1v2h-1z" fill="#c98e75" />
          {pose === 'study' && personality.study === 'write' && <path d="M20 25h1v6h-1z" fill="#675044" />}
          {pose === 'idle' && rest === 'sip' && <g className="px-held-cup"><path d="M17 23h5v5h-5zM22 24h2v3h-2" fill="#fbebc8" /><path d="M18 24h3v1h-3z" fill="#95765e" /></g>}
        </g>
        <g className="px-leg-left"><path d="M6 27h5v4H5v-2h1z" fill="#3b4852" /><path d="M7 27h2v3H7z" fill="#62727a" /><path d="M5 30h6v2H5z" fill="#dbd5bd" /><path d="M5 30h5v1H5z" fill="#fff0ce" /><path d="M6 30h2v.5H6z" fill="#8f998f" /></g>
        <g className="px-leg-right"><path d="M13 27h5v2h1v2h-6z" fill="#3b4852" /><path d="M14 27h2v3h-2z" fill="#62727a" /><path d="M13 30h6v2h-6z" fill="#dbd5bd" /><path d="M14 30h5v1h-5z" fill="#fff0ce" /><path d="M16 30h2v.5h-2z" fill="#8f998f" /></g>
        {pose === 'idle' && rest === 'read' && <g className="px-held-book"><path d="M5 23h7v1h7v6h-7v-1H5z" fill="#788b71" /><path d="M6 23h5v1h6v4h-5v-1H6z" fill="#f3e2b7" /><path className="px-page" d="M12 24h5v4h-5z" fill="#fff0c9" /></g>}
      </g>
      </g>
      <g className="px-facing-back">
        <g className="px-person-body">
          <path d="M7 2h10v2h3v3h2v10h-3v3H5v-3H2V7h2V4h3z" fill={m.hairC} />
          <path d="M7 4h8v2H7zM4 7h3v8H4z" fill="#fff0d3" opacity=".12" />
          <path d="M7 3h9v1H7zM5 5h4v1H5zM4 8h1v5H4z" fill={hairLight} />
          <path d="M7 7h5v1H7zM13 10h5v1h-5zM6 15h2v2H6zM16 15h3v2h-3z" fill={hairMid} />
          {m.id === 'jj' && <path d="M0 7h5v8H0zM19 7h5v8h-5z" fill={m.hairC} />}
          <path d="M5 20h14v8H5z" fill={m.color} />
          <path d="M5 21h2v6H5zM17 21h2v7h-2z" fill={clothDark} /><path d="M7 20h10v1H7z" fill={clothLight} />
          <g className="px-arm-left"><path d="M3 21h3v5H3z" fill={m.color} /><path d="M3 26h3v3H3z" fill="#efc4a4" /></g>
          <g className="px-arm-right"><path d="M18 21h3v5h-3z" fill={m.color} /><path d="M18 26h3v3h-3z" fill="#efc4a4" />{action === 'coffee' && pose === 'idle' && <path d="M18 23h5v5h-5zM23 24h2v3h-2z" fill="#f8e7c3" />}</g>
          <path d="M7 19h10v11H7zM9 17h6v3H9z" fill="#92704f" /><path d="M8 20h8v6H8z" fill="#ba9a6f" /><path d="M9 26h6v3H9z" fill="#a1845d" /><path d="M11 22h3v2h-3z" fill={m.soft} />
          <path d="M8 20h1v8H8zM9 20h6v1H9zM9 26h6v1H9z" fill="#e0c297" /><path d="M16 20h1v10h-1zM10 29h6v1h-6z" fill="#6c5846" /><path d="M10 27h4v.5h-4z" fill="#705c47" />
          {m.id === 'kj' && <path d="M4 10h4v14H4zM16 10h4v14h-4z" fill={m.hairC} />}
          <g className="px-leg-left"><path d="M6 28h5v4H5v-2h1z" fill="#48525a" /><path d="M5 31h6v1H5z" fill="#faf2dc" /></g>
          <g className="px-leg-right"><path d="M13 28h5v2h1v2h-6z" fill="#48525a" /><path d="M13 31h6v1h-6z" fill="#faf2dc" /></g>
        </g>
      </g>
      <g className="px-facing-side">
        <g className="px-person-body">
          <path d="M7 3h10v3h3v10h-3v4H6v-4H3V7h4z" fill={m.hairC} />
          <path d="M7 3h8v1H7zM5 6h4v1H5zM4 9h1v4H4z" fill={hairLight} /><path d="M7 8h5v1H7zM6 13h3v2H6z" fill={hairMid} />
          <path d="M12 9h6v4h3v3h-3v3h-6z" fill="#f4cfa9" /><path d="M15 12h2v2h-2z" fill="#35363b" />
          <path d="M12 10h2v4h-2zM18 13h2v1h-2z" fill="#ffe4bc" /><path d="M17 16h1v2h-4v-1h3z" fill="#cf9b80" />
          {m.id === 'th' && <path d="M13 11h6v4h-6z" fill="none" stroke="#5d6464" />}
          <path d="M8 20h10v8H8z" fill={m.color} /><path d="M8 22h3v4H8z" fill={m.soft} opacity=".5" />
          <path d="M9 20h6v1H9z" fill={clothLight} /><path d="M17 21h1v7h-1zM10 27h7v1h-7z" fill={clothDark} />
          <path d="M4 20h6v9H4z" fill="#a17f56" /><path d="M4 20h5v3H4z" fill="#c6a676" />
          <path d="M4 20h1v7H4zM5 20h3v1H5z" fill="#dfc397" /><path d="M9 22h1v7H9zM5 28h4v1H5z" fill="#776048" />
          <g className="px-arm-right"><path d="M13 21h4v5h-4z" fill={m.color} /><path d="M14 26h3v3h-3z" fill="#efc4a4" />
            {pose === 'idle' && rest === 'read' && <g className="px-held-book"><path d="M17 22h8v7h-8z" fill="#74886b" /><path d="M18 22h6v5h-6z" fill="#f7e3b3" /><path d="M19 24h4v1h-4z" fill="#b4a076" /></g>}
            {pose === 'idle' && action === 'water' && <g className="px-watering-can">
              <path d="M17 24h8v7h-8zM18 22h6v2h-6zM25 25h3v-3h3v3h-2v4h-4z" fill="#567e79" /><path d="M18 24h6v2h-6zM18 26h2v4h-2zM29 22h3v2h-3z" fill="#aac2a1" />
              <path d="M15 24h3v5h-3z" fill="none" stroke="#aec6a8" strokeWidth="1" />
              <path className="px-water-drops" d="M33 25h1v2h-1zM35 29h1v2h-1zM32 31h1v2h-1zM37 33h1v2h-1z" fill="#c5e2d6" />
            </g>}
          </g>
          <g className="px-leg-left"><path d="M8 28h5v4H7v-2h1z" fill="#48525a" /><path d="M7 31h6v1H7z" fill="#faf2dc" /></g>
          <g className="px-leg-right"><path d="M13 28h4v2h2v2h-6z" fill="#48525a" /><path d="M13 31h6v1h-6z" fill="#faf2dc" /></g>
        </g>
      </g>
    </g>
  );
}

export function PixelPortrait({ m }: { m: Member }) {
  return (
    <svg className="px-portrait" viewBox="0 0 32 40" aria-hidden="true" shapeRendering="crispEdges">
      <g transform="translate(4 4)"><PixelCharacter m={m} /></g>
    </svg>
  );
}
