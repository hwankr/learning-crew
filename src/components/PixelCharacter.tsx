import type { Member } from '../lib/constants';

/** Original pixel artwork on a 24 × 32 grid. Shared by the scene and demo controls. */
export function PixelCharacter({ m, pose = 'idle' }: {
  m: Member;
  pose?: 'idle' | 'walk' | 'study';
}) {
  return (
    <g className={`px-person px-person-${pose}`}>
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
        <g className="px-arm-left">
          <path d="M3 21h3v5H3z" fill={m.color} />
          <path d="M3 26h3v3H3z" fill="#efc4a4" />
        </g>
        <g className="px-arm-right">
          <path d="M18 21h3v5h-3z" fill={m.color} />
          <path d="M18 26h3v3h-3z" fill="#efc4a4" />
          {pose === 'study' && <path d="M20 25h1v6h-1z" fill="#675044" />}
        </g>
        <g className="px-leg-left"><path d="M6 27h5v4H5v-2h1z" fill="#48525a" /><path d="M5 30h6v2H5z" fill="#faf2dc" /></g>
        <g className="px-leg-right"><path d="M13 27h5v2h1v2h-6z" fill="#48525a" /><path d="M13 30h6v2h-6z" fill="#faf2dc" /></g>
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
