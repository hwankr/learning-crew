import type { Member } from '../lib/constants';
import { ROOM_PERSONALITY, type RoomFacing } from '../lib/pixelRoom';

/** Original pixel artwork on a 24 × 32 grid. Shared by the scene and demo controls. */
export function PixelCharacter({ m, pose = 'idle', facing = 'south' }: {
  m: Member;
  pose?: 'idle' | 'walk' | 'study';
  facing?: RoomFacing;
}) {
  const personality = ROOM_PERSONALITY[m.id];
  return (
    <g className={`px-person px-person-${pose} px-study-${personality.study} px-rest-${personality.rest}`} data-facing={facing}>
      <g className="px-facing-front">
      <g className="px-person-body">
        {m.id === 'kj' && <path d="M4 7h16v20h-4V15H8v12H4z" fill={m.hairC} />}
        {m.id === 'jj' && <path d="M0 7h5v8H0zM19 7h5v8h-5z" fill={m.hairC} />}
        <path d="M7 2h10v2h3v3h2v10h-3v3H5v-3H2V7h2V4h3z" fill={m.hairC} />
        <path d="M6 9h12v3h2v4h-2v3H6v-3H4v-4h2z" fill="#efc4a4" />
        <path d="M6 9h12v5H6z" fill="#f8d9b7" />
        {m.id === 'wg' ? <path d="M4 6h16v3h-3v3h-3V9h-3v2H8V9H4z" fill={m.hairC} />
          : m.id === 'kj' ? <path d="M4 6h16v5h-4V8h-5v3H4z" fill={m.hairC} />
            : <path d="M4 6h16v4h-6V8H9v3H4z" fill={m.hairC} />}
        <g className="px-eyes" fill="#35363b">
          <path d="M8 12h2v2H8zM15 12h2v2h-2z" />
        </g>
        {m.id === 'th' && <path d="M6 11h5v4H6zM14 11h5v4h-5zM11 12h3" fill="none" stroke="#5d6464" />}
        <path d="M11 16h3v1h-3z" fill="#c98c7a" />
        <path d="M8 19h8v3H8z" fill="#e8b493" />
        <path d="M5 20h4v2h6v-2h4v7H5z" fill={m.color} />
        <path d="M7 22h2v4H7z" fill={m.soft} opacity=".6" />
        {pose === 'walk' && <path d="M6 20h2v7H6zM16 20h2v7h-2z" fill="#af875f" />}
        <g className="px-arm-left">
          <path d="M3 21h3v5H3z" fill={m.color} />
          <path d="M3 26h3v3H3z" fill="#efc4a4" />
        </g>
        <g className="px-arm-right">
          <path d="M18 21h3v5h-3z" fill={m.color} />
          <path d="M18 26h3v3h-3z" fill="#efc4a4" />
          {pose === 'study' && personality.study === 'write' && <path d="M20 25h1v6h-1z" fill="#675044" />}
          {pose === 'idle' && personality.rest === 'sip' && <g className="px-held-cup"><path d="M17 23h5v5h-5zM22 24h2v3h-2" fill="#fbebc8" /><path d="M18 24h3v1h-3z" fill="#95765e" /></g>}
        </g>
        <g className="px-leg-left"><path d="M6 27h5v4H5v-2h1z" fill="#48525a" /><path d="M5 30h6v2H5z" fill="#faf2dc" /></g>
        <g className="px-leg-right"><path d="M13 27h5v2h1v2h-6z" fill="#48525a" /><path d="M13 30h6v2h-6z" fill="#faf2dc" /></g>
        {pose === 'idle' && personality.rest === 'read' && <g><path d="M5 23h7v1h7v6h-7v-1H5z" fill="#788b71" /><path d="M6 23h5v1h6v4h-5v-1H6z" fill="#f3e2b7" /></g>}
      </g>
      </g>
      <g className="px-facing-back">
        <g className="px-person-body">
          <path d="M7 2h10v2h3v3h2v10h-3v3H5v-3H2V7h2V4h3z" fill={m.hairC} />
          <path d="M7 4h8v2H7zM4 7h3v8H4z" fill="#fff0d3" opacity=".12" />
          {m.id === 'jj' && <path d="M0 7h5v8H0zM19 7h5v8h-5z" fill={m.hairC} />}
          <path d="M5 20h14v8H5z" fill={m.color} />
          <g className="px-arm-left"><path d="M3 21h3v5H3z" fill={m.color} /><path d="M3 26h3v3H3z" fill="#efc4a4" /></g>
          <g className="px-arm-right"><path d="M18 21h3v5h-3z" fill={m.color} /><path d="M18 26h3v3h-3z" fill="#efc4a4" /></g>
          <path d="M7 19h10v11H7zM9 17h6v3H9z" fill="#92704f" /><path d="M8 20h8v6H8z" fill="#ba9a6f" /><path d="M9 26h6v3H9z" fill="#a1845d" /><path d="M11 22h3v2h-3z" fill={m.soft} />
          {m.id === 'kj' && <path d="M4 10h4v14H4zM16 10h4v14h-4z" fill={m.hairC} />}
          <g className="px-leg-left"><path d="M6 28h5v4H5v-2h1z" fill="#48525a" /><path d="M5 31h6v1H5z" fill="#faf2dc" /></g>
          <g className="px-leg-right"><path d="M13 28h5v2h1v2h-6z" fill="#48525a" /><path d="M13 31h6v1h-6z" fill="#faf2dc" /></g>
        </g>
      </g>
      <g className="px-facing-side">
        <g className="px-person-body">
          <path d="M7 3h10v3h3v10h-3v4H6v-4H3V7h4z" fill={m.hairC} />
          <path d="M12 9h6v4h3v3h-3v3h-6z" fill="#f4cfa9" /><path d="M15 12h2v2h-2z" fill="#35363b" />
          {m.id === 'th' && <path d="M13 11h6v4h-6z" fill="none" stroke="#5d6464" />}
          <path d="M8 20h10v8H8z" fill={m.color} /><path d="M8 22h3v4H8z" fill={m.soft} opacity=".5" />
          <path d="M4 20h6v9H4z" fill="#a17f56" /><path d="M4 20h5v3H4z" fill="#c6a676" />
          <g className="px-arm-right"><path d="M13 21h4v5h-4z" fill={m.color} /><path d="M14 26h3v3h-3z" fill="#efc4a4" /></g>
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
