import { memo, useId } from 'react';
import type { StudyPose } from '../lib/pixelRoom';

export const PixelDeskLight = memo(function PixelDeskLight({ x, y, lit }: { x: number; y: number; lit: boolean }) {
  const glowId = useId();
  return <g transform={`translate(${x} ${y})`}>
    <defs><radialGradient id={glowId}><stop offset="0" stopColor="#ffe0a0" stopOpacity=".62" /><stop offset=".48" stopColor="#efb961" stopOpacity=".24" /><stop offset="1" stopColor="#efa74d" stopOpacity="0" /></radialGradient></defs>
    {lit && <ellipse className="px-desk-glow" cx={-21} cy={-12} rx={48} ry={35} fill={`url(#${glowId})`} shapeRendering="auto" />}
  </g>;
});

export const PixelDesk = memo(function PixelDesk({ x, y, lit, kind, color }: { x: number; y: number; lit: boolean; kind: StudyPose; color: string }) {
  return <g className="px-desk" data-lit={lit} transform={`translate(${x} ${y})`}>
    <ellipse cx={5} cy={29} rx={40} ry={8} fill="#162b28" opacity=".22" />
    <path d="M-30 4h7v30h-7zM24 4h7v30h-7z" fill="#3c3027" />
    <path d="M-29 6h3v27h-3zM25 6h3v27h-3z" fill="#86613e" /><path d="M-29 7h1v24h-1zM25 7h1v24h-1z" fill="#c1965c" />
    <path d="M-31 31h9v3h-9zM23 31h9v3h-9zM-24 21h49v3h-49z" fill="#55422f" />
    <path d="M-24 21h49v1h-49z" fill="#9c774c" />
    <path d="M-37-10h74V4h-74z" fill="#342b23" /><path d="M-36-12h72V0h-72z" fill="#8e623c" />
    <path d="M-35-11h70v2h-70zM-35-5h70v1h-70z" fill="#bb8b54" /><path d="M-35-8h70v1h-70zM-34-2h67v1h-67z" fill="#744c30" />
    <path d="M-37-1h74v2h-74z" fill="#d0a36b" /><path d="M-36 2h72v2h-72z" fill="#5a3d28" />
    {Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${-33 + i * 5.5} ${-10 + i % 4 * 2}h${3 + i % 3 * 2}m-2 1h3`} fill="none" stroke={i % 2 ? '#dbab6d' : '#543a2a'} strokeWidth=".5" opacity=".6" />)}
    <path d="M-23-7h5v2h-5zM19-4h4v1h-4z" fill="#67472e" opacity=".7" /><path d="M-21-7h2v1h-2z" fill="#b78650" />
    <path d="M-32 4h64v12h-64z" fill="#69472d" /><path d="M-30 5h28v9h-28zM1 5h29v9H1z" fill="#92673f" />
    <path d="M-29 6H-3v1h-26zM2 6h26v1H2z" fill="#c4945b" /><path d="M-29 13H-3v1h-26zM2 13h26v1H2z" fill="#4e3626" />
    <path d="M-19 8h5v2h-5zM13 8h5v2h-5z" fill="#473a2b" /><path d="M-18 8h3v1h-3zM14 8h3v1h-3z" fill="#d5b775" />
    <path d="M-4 6h6v3h-6z" fill={color} opacity={lit ? .85 : .35} /><path d="M-3 6h4v.5h-4z" fill="#fff0c9" opacity=".65" />
    <path d="M-29-28h2v15h-2zM-34-14h13v2h-13z" fill="#514637" /><path d="M-28-28h1v14h-1zM-33-14h11v1h-11z" fill="#cfb67c" />
    <path d="M-34-33h13v2h3v6h-20v-6h4z" fill="#203e38" /><path d="M-33-32h11v2h3v3h-18v-3h4z" fill={lit ? '#578675' : '#48655a'} />
    <path d="M-32-32h9v1h-9zM-36-29h3v2h-3z" fill="#91aa88" /><path d="M-37-25h19v1h-19z" fill="#ac925d" />
    <path d="M-35-24h15v1h-15z" fill={lit ? '#ffebb6' : '#7b7959'} />
    {kind === 'type' ? <g transform="translate(2 1) scale(.9 .65)">
      <path d="M-8-28h27v18H-8z" fill="#223b3d" /><path d="M-7-27h25v1H-7zM-8-26h1v15h-1z" fill="#a6b6a7" />
      <path d="M-6-26h23v14H-6z" fill={lit ? '#477d79' : '#4b5e55'} /><path d="M-5-25h21v2H-5z" fill="#263f3b" />
      <path d="M-4-25h1v1h-1zM-2-25h1v1h-1zM0-25h1v1H0z" fill="#d8b27c" />
      <path d="M-4-21h9v1H-4zM-4-18h17v1H-4zM-4-15h11v1H-4z" fill="#e2e9c5" opacity={lit ? .95 : .2} />
      <path d="M-10-10h31v4h-31z" fill="#b5beac" /><path d="M-10-6h31v1h-31z" fill="#4f665e" />
      <path d="M-6-9h3m1 0h3m1 0h3m1 0h3m1 0h3" stroke="#6a8075" strokeWidth="1" />
      <path className={lit ? 'px-screen-cursor' : undefined} d="M8-15h1v2H8z" fill="#ffda8a" />
    </g> : <g>
      <path d="M-12-16h11v1h3v-1h11v10H2v1H0v-1h-12z" fill="#443b2e" />
      <path d="M-12-17h11v1h3v-1h11v10H2v1H0v-1h-12z" fill="#cbb58c" />
      <path d="M-11-18h10v1h3v-1h10v10H2v1H0v-1h-11z" fill="#f2dfb2" />
      <path d="M-10-17h9v2h-9zM3-17h8v2H3z" fill="#fff1cd" /><path d="M0-16h2v8H0z" fill="#b69c74" />
      <path d="M-9-13h6M-9-11h5M4-13h6M4-11h4" stroke="#a98c66" strokeWidth=".6" />
      <g className={lit && kind === 'read' ? 'px-page' : undefined}><path d="M3-18h9v10H3z" fill="#ffecc4" opacity=".6" /><path d="M5-15h5M5-13h4" stroke="#b39a70" strokeWidth=".6" /></g>
      {kind === 'write' && <><path d="m15-17 2 1-3 9-2-1z" fill="#344c42" /><path d="m15-17 1 .5-3 8-1-.5z" fill="#8daa76" /><path d="m12-8 1 1-2 1z" fill="#e9cf9f" /></>}
    </g>}
    <ellipse cx={27} cy={-7} rx={6} ry={2} fill="#e2c694" /><path d="M24-14h7v6h-1v1h-5v-1h-1zM31-13h3v4h-3" fill="#d7b98d" /><path d="M24-13h2v5h-2z" fill="#f8e1b4" /><path d="M25-14h5v2h-5z" fill="#674830" /><path d="M26-14h3v.5h-3z" fill="#b48050" />
    {lit && <path className="px-steam" d="M27-18q-2-2 0-4t0-4" fill="none" stroke="#fff0cc" strokeWidth=".8" opacity=".7" shapeRendering="auto" />}
    <path d="M-30 17h10v12h-10zM-27 15h5v3h-5z" fill="#324b41" /><path d="M-29 18h8v8h-8z" fill="#617157" /><path d="M-28 18h6v1h-6zM-28 21h1v4h-1z" fill="#9d9b71" /><path d="M-27 24h5v4h-5z" fill="#4b5e48" /><path d="M-25 25h1v1h-1z" fill="#d1bb7b" />
  </g>;
});
