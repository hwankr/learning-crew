import { memo, useId, useState, type CSSProperties } from 'react';
import { MEMBERS } from '../lib/constants';
import { roomDestination, type RoomMood, type StudyPose } from '../lib/pixelRoom';
import librarySunset from '../assets/pixel-room/library-sunset-v3.webp';
import libraryNight from '../assets/pixel-room/library-night-v3.webp';
import libraryRain from '../assets/pixel-room/library-rain-v3.webp';

function Tree({ x, y, scale = 1, delay = 0 }: { x: number; y: number; scale?: number; delay?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M-26-4h51v7h-51zM-18 3h35v4h-35z" fill="var(--px-deep)" opacity=".3" />
    <path d="M-7-60H8V1H-7zM-11-4h22v6h-22z" fill="#594739" />
    <path d="M-5-52h4v48h-4zM-1-31h5v4h-5zM4-15h3v12H4z" fill="#987052" />
    <g className="px-canopy" style={{ '--px-delay': `${delay}s` } as CSSProperties}>
      <path d="M-15-105h30v8h16v11h11v15h9v23H40v12H23v8H-6v-5h-25v-9h-14v-15h-8v-17h10v-16h13v-10h15z" fill="var(--px-leaf-dark)" />
      <path d="M-19-101H9v9h17v12h14v22H25v12H-5v-4h-22v-12h-16v-16h12v-14h12z" fill="var(--px-leaf)" />
      <path d="M-17-98H5v7h10v10H-6v8h-24v-12h13zM8-72h20v12H8zM-30-57h15v7h-15z" fill="var(--px-leaf-light)" />
      <path d="M-11-91h9v4h-9zM-27-78h7v4h-7zM14-65h6v3h-6zM31-49h7v3h-7z" fill="var(--px-leaf-glint)" />
    </g>
  </g>;
}

function Plant({ x, y, scale = 1, flowers = false }: { x: number; y: number; scale?: number; flowers?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M-10 11h23v5h-23z" fill="#352d32" opacity=".15" />
    <path d="M-7 0H7v9H5v5H-5V9H-7z" fill="#ae6551" /><path d="M-8-1H8v4H-8z" fill="#e9a979" />
    <path d="M-5 4h3v7h-3z" fill="#ca8261" /><path d="M-1-21h2V1h-2z" fill="#4d6b50" />
    <path d="M-12-17h7v3h5v8h-7v-5h-5zM1-24h8v4h5v6H8v6H1z" fill="#628763" />
    <path d="M-11-16h6v3h-6zM4-23h5v5H4z" fill="#9fac69" />
    {flowers && <path d="M-10-19h4v5h-4zM4-26h5v5H4zM11-17h4v4h-4z" fill="#efa29d" />}
  </g>;
}

function Bookshelf({ x, y, width = 94, rows = 2 }: { x: number; y: number; width?: number; rows?: number }) {
  const colors = ['#8bada0', '#d3a164', '#a26761', '#c3bf8a', '#60868a', '#ae8fa2', '#d5bc8b'];
  const books = Math.floor((width - 10) / 7);
  return <g transform={`translate(${x} ${y})`}>
    <rect x={-3} y={-3} width={width + 6} height={rows * 20 + 7} fill="#513c38" />
    <rect width={width} height={rows * 20 + 2} fill="#785440" />
    {Array.from({ length: rows }, (_, row) => <g key={row} transform={`translate(0 ${row * 20})`}>
      {Array.from({ length: books }, (_, i) => <g key={i}>
        <rect x={5 + i * 7} y={3 + (i + row) % 4} width={5} height={14 - (i + row) % 4} fill={colors[(i * 3 + row) % colors.length]} />
        <path d={`M${6 + i * 7} ${6 + (i + row) % 4}h3v1h-3zM${6 + i * 7} 14h3v1h-3z`} fill="#f5dcc2" opacity=".7" />
      </g>)}
      <path d={`M0 17h${width}v3H0z`} fill="#b78459" />
      <path d={`M0 20h${width}v2H0z`} fill="#523a33" />
    </g>)}
    <path d={`M-3-4h${width + 6}v3H-3z`} fill="#cb9c65" />
  </g>;
}

function Window({ x, celestial = false }: { x: number; celestial?: boolean }) {
  return <g transform={`translate(${x} 41)`}>
    <path d="M9-4h41V0h9v8h4v46H-4V8H0V0h9z" fill="#5d4540" />
    <path d="M10 0h39v4h9v47H1V4h9z" fill="var(--px-window)" />
    <path d="M1 35h11v-8h11v9h14v-5h13v-7h8v27H1z" fill="var(--px-horizon)" />
    <path d="M1 44h17v-7h12v8h17v-8h11v14H1z" fill="var(--px-leaf-dark)" />
    <g className="px-sunset-only">{celestial && <path d="M33 9h12v3h3v9h-3v3H33v-3h-3v-9h3z" fill="#ffd397" />}<path d="M5 18h16v2H5zM9 21h15v2H9z" fill="#f4b3a0" />{!celestial && <path d="M30 10h23v2H30zM36 13h14v2H36z" fill="#f4b3a0" />}</g>
    <g className="px-night-only">{celestial && <><path d="M37 7h10v3h3v10h-3v3H37v-3h-3V10h3z" fill="#efe4b5" /><path d="M42 5h10v13H42z" fill="var(--px-window)" /></>}<path d="M11 11h2v2h-2zM23 23h2v2h-2zM8 29h1v2H8z" fill="#fff3c4" />{!celestial && <path d="M44 8h2v2h-2zM37 18h1v2h-1zM48 29h2v2h-2z" fill="#fff3c4" />}</g>
    <g className="px-rain-only px-window-rain" stroke="#c4e0dc" strokeWidth="1" opacity=".55"><path d="m12 5-3 11m19-9-3 13m23-15-3 12m-25 5-3 9m22-9-4 13" /></g>
    <path d="M27 0h5v51h-5zM1 24h57v4H1z" fill="#ad8059" />
    <path d="M28 0h2v51h-2zM1 24h57v2H1z" fill="#e7b97c" />
    <path d="M-8 51h74v5H-8zM-4 56h67v3H-4z" fill="#c89662" />
    <path d="M-8 51h74v2H-8z" fill="#f5d89f" />
    <path d="M-9-3H4v45H0v4h-9zM57-3h12v49h-9v-5h-3z" fill="#9b7459" />
    <path d="M-8 0h3v39h-3zM62 0h3v39h-3z" fill="#c6a07b" />
  </g>;
}

function GardenBench({ x, y, width }: { x: number; y: number; width: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M-4 22h${width + 12}v5H-4z`} fill="var(--px-deep)" opacity=".28" />
    <path d={`M0 0h${width}v12H0zM-4 14h${width + 8}v6H-4z`} fill="#966d54" />
    <path d={`M1 1h${width - 2}v3H1zM1 7h${width - 2}v3H1zM-4 14h${width + 8}v2H-4z`} fill="#cb9d71" />
    <path d={`M4 19h4v10H4zM${width - 8} 19h4v10h-4z`} fill="#5d5344" />
  </g>;
}

function Lantern({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <ellipse className="px-lantern-glow" cy={-32} rx={30} ry={33} fill="#fac787" opacity=".1" />
    <path d="M-3-38h6V0h-6zM-6 0H6v4H-6zM-9-45H9v3H-9z" fill="#405954" />
    <path d="M-7-42H7v15H-7z" fill="#526760" /><path d="M-4-39H4v10H-4z" fill="#ffe1a3" />
    <path d="M-7-27H7v3H-7zM-5-47H5v2H-5z" fill="#2b4443" />
  </g>;
}

const VectorBackdrop = memo(function VectorBackdrop() {
  return <g>
    <path d="M0 0h640v400H0z" fill="var(--px-sky)" />
    <path d="M0 78h640v322H0z" fill="var(--px-ground)" />
    <path d="M0 270h640v130H0z" fill="var(--px-grass)" />
    {Array.from({ length: 100 }, (_, i) => <path key={i} d={`M${(i * 83 + 19) % 640} ${80 + (i * 47) % 320}h4v-2h2v5h-6z`} fill={i % 2 ? 'var(--px-grass-light)' : 'var(--px-ground)'} opacity=".65" />)}
    {[[-5, 125, 1.25], [67, 109, 1.2], [132, 83, .9], [218, 56, .8], [410, 57, .75], [492, 82, 1], [580, 105, 1.15], [646, 137, 1.1], [51, 226, 1.4], [609, 236, 1.05]].map(([x, y, scale], i) => <Tree key={i} x={x!} y={y!} scale={scale!} delay={i * -.9} />)}
    <path d="M34 307h17v-12h52v8h22v13h16v36h-12v14H97v9H51v-9H29v-17H20v-29h14z" fill="var(--px-pond-edge)" />
    <path d="M39 311h16v-10h46v8h22v12h11v26h-10v13H95v8H54v-8H35v-14h-8v-24h12z" fill="var(--px-water)" />
    <path d="M49 307h49v5H53v7H36v-5h13zM103 352h19v4h-19zM44 351h7v9h-7z" fill="var(--px-water-light)" />
    <g className="px-water-flow" stroke="var(--px-water-light)" strokeWidth="2" opacity=".75"><path d="M45 329h21m13-11h26m-52 23h13m12 15h18m-4-22h23" /></g>
    <g className="px-pond-ripple" fill="none" stroke="#c8d4b1" strokeWidth="1"><path d="M70 326h13v5H70zM65 323h23v10H65z" /></g>
    <path d="M43 314h10v5H43zM107 346h12v4h-12z" fill="#749476" /><path d="M47 313h4v3h-4zM111 345h4v3h-4z" fill="#e4b0a7" />
    <path d="M148 292h492v31H148zM336 279h28v121h-28z" fill="var(--px-path-shadow)" />
    <path d="M148 289h492v29H148zM336 276h28v124h-28z" fill="var(--px-path)" />
    {Array.from({ length: 17 }, (_, i) => <g key={i} fill="var(--px-stone)" opacity=".7"><path d={`M${152 + i * 29} 294h23v8h-23zM${163 + i * 29} 306h16v7h-16z`} /></g>)}
    <path d="M338 329h22v8h-22zM342 345h19v8h-19zM338 378h21v9h-21z" fill="var(--px-stone)" />
    <path d="M150 62h426v228H150zM145 287h431v9H145z" fill="var(--px-deep)" opacity=".3" />
    <path d="M130 45h432v240H130z" fill="#493c38" />
    <path d="M138 49h416v231H138z" fill="var(--px-wall)" />
    <path d="M140 96h412v184H140z" fill="var(--px-floor)" />
    {Array.from({ length: 12 }, (_, row) => <g key={row} stroke="var(--px-floor-line)" strokeWidth="1">
      <path d={`M140 ${100 + row * 15}h412`} />
      {Array.from({ length: 7 }, (_, col) => <g key={col}><path d={`M${145 + col * 62 + (row % 2) * 25} ${100 + row * 15}v15`} /><path d={`M${150 + col * 60} ${106 + row * 15}h${12 + (row + col) % 3 * 6}`} opacity=".45" /></g>)}
    </g>)}
    <path d="M139 90h415v7H139z" fill="#7e5c47" /><path d="M139 91h415v2H139z" fill="#e1af76" />
    <path d="M129 45h11v240h-11zM552 45h11v240h-11z" fill="#694d40" />
    <path d="M131 47h4v232h-4zM554 47h3v233h-3z" fill="#af7c52" />
    <path d="M125 40h441v7H125zM131 36h428v4H131z" fill="#563e37" /><path d="M126 39h439v3H126z" fill="#ce9865" />
    <path d="M219 14h230v22H219z" fill="#443f3a" /><path d="M223 17h222v16H223z" fill="#b38e60" />
    <path d="M226 18h216v12H226z" fill="#ede0b0" /><text x={334} y={27} textAnchor="middle" className="px-sign">L E A R N I N G  ·  L I B R A R Y</text>
    <Bookshelf x={154} y={50} width={101} /><Bookshelf x={429} y={50} width={104} />
    <Window x={284} /><Window x={354} celestial />
    <path d="M265 51h13v17h-13z" fill="#c7a16c" /><path d="M267 53h9v13h-9z" fill="#f1dfaf" /><path d="M271 55v6h4" stroke="#715d4c" strokeWidth="1.5" fill="none" />
    <Bookshelf x={148} y={129} width={36} rows={4} />
    <path d="M148 215h36v5h-36z" fill="#493c37" /><Plant x={163} y={126} scale={.7} />
    <path d="M221 204h279v54H221z" fill="#596e62" /><path d="M225 208h271v46H225z" fill="#6f8270" />
    <path d="M228 211h265v40H228z" fill="none" stroke="#b7b591" strokeWidth="2" />
    <path d="M231 215h259M231 248h259" stroke="#93a087" strokeWidth="1" />
    {Array.from({ length: 15 }, (_, i) => <path key={i} d={`M${230 + i * 18} 258v3`} stroke="#cbbd96" strokeWidth="2" />)}
    <path className="px-sunbeam px-sunset-only" d="M287 98h33l69 104h-53zM357 98h29l45 70h-42z" fill="#ffdea0" opacity=".19" />
    <path className="px-night-only" d="M286 99h128v3H286z" fill="#b5c7b2" opacity=".24" />
    <g transform="translate(184 247)"><path d="M-3 0h37v24H-3z" fill="#6c5946" /><path d="M0 3h31v5H0zM0 17h31v4H0z" fill="#c79562" /><path d="M1 25h5v5H1zM25 25h5v5h-5z" fill="#424847" /><path d="M2-2h22v4H2z" fill="#65827a" /><path d="M5-6h23v4H5z" fill="#c19b73" /><path d="M3-10h19v4H3z" fill="#c1ba96" /><path d="M2 11h8v6H2zM13 9h5v8h-5zM21 10h7v7h-7z" fill="#ae8770" /></g>
    <g transform="translate(517 228)"><path d="M-11-14h37v54h-37z" fill="#705342" /><path d="M-13 2h41v5h-41z" fill="#edc28b" /><path d="M-7 10h28v21H-7z" fill="#a57b54" /><path d="M-3 17h20v2H-3z" fill="#d7a977" /><path d="M-6-18h20V1H-6z" fill="#3f5654" /><path d="M-3-15h14v6H-3z" fill="#9aaf91" /><path d="M2-5h6v7H2z" fill="#f3dfb1" /><path d="M18-9h6V1h-6z" fill="#d3b580" /><text x={6} y={41} className="px-tiny-sign" textAnchor="middle">COFFEE</text></g>
    <Plant x={151} y={271} flowers /><Plant x={536} y={122} scale={.8} flowers />
    <GardenBench x={175} y={326} width={92} /><GardenBench x={421} y={327} width={93} />
    <path d="M310 358h28v12h-28zM306 362h35v6h-35z" fill="#7a9a91" /><path d="M314 354h22v7h-22z" fill="#a6b6a3" />
    <g transform="translate(403 346)"><path d="M-12 0h25v5h-25zM-9 5h4v16h-4zM6 5h4v16H6z" fill="#a98559" /><path d="M-14-3h29V1h-29z" fill="#ddba81" /><path d="M-4-10h7v7h-7zM3-9h3v4H3" fill="#f7deb1" /></g>
    <g fill="#839e6a"><path d="M157 335h8v-5h7v12h-15zM389 373h9v-5h5v13h-14zM531 347h10v-6h7v14h-17z" /></g>
    <g fill="#d9a48a"><path d="M160 331h4v4h-4zM395 370h4v4h-4zM541 342h4v4h-4z" /></g>
    <Lantern x={162} y={306} /><Lantern x={542} y={303} />
    <path d="M164 267q185 55 380-3" stroke="#494f43" strokeWidth="1" fill="none" />
    {[185, 227, 271, 315, 359, 403, 447, 491, 531].map((x, i) => <g key={x} transform={`translate(${x} ${271 + Math.round(Math.sin(i / 8 * Math.PI) * 19)})`}><path d="M-1 0h3v5h-3z" fill="#807058" /><path d="M-2 5h5v5h-5z" fill="#f8d99b" /><circle className="px-string-glow" cy={7} r={9} fill="#ffd487" opacity=".09" /></g>)}
  </g>;
});

const ROOM_ART: Record<RoomMood, string> = { sunset: librarySunset, night: libraryNight, rain: libraryRain };

export const PixelRoomBackdrop = memo(function PixelRoomBackdrop({ mood }: { mood: RoomMood }) {
  const [ready, setReady] = useState<Partial<Record<RoomMood, boolean>>>({});
  return <g className="px-backdrop" data-art-ready={ready[mood] ? 'true' : 'false'}>
    {!ready[mood] && <VectorBackdrop />}
    {Object.entries(ROOM_ART).map(([variant, src]) => <image key={variant} href={src} x={0} y={0} width={640} height={400}
      preserveAspectRatio="none" className={`px-painted-background px-art-${variant}`}
      visibility={variant === mood ? 'visible' : 'hidden'}
      onLoad={() => setReady((current) => ({ ...current, [variant]: true }))}
      onError={() => setReady((current) => ({ ...current, [variant]: false }))} />)}
    {ready[mood] && <text x={334} y={25} textAnchor="middle" className="px-painted-sign">L E A R N I N G  ·  L I B R A R Y</text>}
    <g className="px-pond-ripple" fill="none" stroke="#bed9ca" strokeWidth=".6" opacity=".55"><ellipse cx={76} cy={337} rx={12} ry={3} /><ellipse cx={76} cy={337} rx={17} ry={4.5} /></g>
    <g className="px-water-flow" stroke="#c9daca" strokeWidth=".7" opacity=".5"><path d="M47 330h12m27-13h9m-38 32h8m28 4h13" /></g>
    {MEMBERS.map((m, i) => { const p = roomDestination(i, MEMBERS.length, 'library'); return <g key={m.id} className="px-chair" transform={`translate(${p.x} ${p.y})`}>
      <ellipse cy={9} rx={18} ry={6} fill="#252c29" opacity=".25" />
      <path d="M-16-15h32v27h-32z" fill="#473b2e" /><path d="M-15-16h30v2h-30zM-16-14h2v24h-2z" fill="#c99d66" />
      <path d="M-12-12h24V8h-24z" fill="#294b45" /><path d="M-11-11h22v2h-22zM-11-9h1V6h-1z" fill="#789079" />
      <path d="M-8-7h16V4H-8z" fill="#3b6053" /><path d="M-5-5h1v1h-1zM4-5h1v1H4zM-5 1h1v1h-1zM4 1h1v1H4z" fill="#a4a67b" />
      <path d="M-15 7h30v5h-30z" fill="#6b7659" /><path d="M-15 7h30v1h-30zM-17-1h3v9h-3zM14-1h3v9h-3z" fill="#ac8859" />
    </g>; })}
    <g transform="translate(324 364)"><ellipse cy={3} rx={16} ry={5} fill="#243d36" opacity=".4" /><path d="M-14-6h5v-4H8v3h6v8H-14z" fill="#3d695e" /><path d="M-10-7H7v2h4v4H-12v-4h2z" fill="#82a087" /><path d="M-7-8H6v1H-7zM-11-3h2v3h-2z" fill="#c1c4a0" /></g>
  </g>;
});

export function PixelDeskLight({ x, y, lit }: { x: number; y: number; lit: boolean }) {
  const glowId = useId();
  return <g transform={`translate(${x} ${y})`}>
    <defs><radialGradient id={glowId}><stop offset="0" stopColor="#ffe0a0" stopOpacity=".62" /><stop offset=".48" stopColor="#efb961" stopOpacity=".24" /><stop offset="1" stopColor="#efa74d" stopOpacity="0" /></radialGradient></defs>
    {lit && <ellipse className="px-desk-glow" cx={-21} cy={-12} rx={48} ry={35} fill={`url(#${glowId})`} shapeRendering="auto" />}
  </g>;
}

export function PixelDesk({ x, y, lit, kind, color }: { x: number; y: number; lit: boolean; kind: StudyPose; color: string }) {
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
}

export const PixelFrontWall = memo(function PixelFrontWall() {
  return <g>
    <path d="M133 280h190v5H133zM377 280h184v5H377z" fill="#483828" /><path d="M134 280h189v1H134zM377 280h182v1H377z" fill="#b98b55" />
    <path d="M134 282h189v1H134zM377 282h182v1H377z" fill="#725333" />
    <path d="M328 282h44v4h-44zM324 287h53v3h-53z" fill="#857451" /><path d="M328 282h44v1h-44zM324 287h53v1h-53z" fill="#c7b888" />
  </g>;
});

export const PixelRoomForeground = memo(function PixelRoomForeground() {
  return <g>
    <g className="px-cat" transform="translate(565 363)">
      <ellipse cx={4} cy={5} rx={17} ry={4} fill="#233f3f" opacity=".24" />
      <g className="px-cat-breathe"><path d="M-10-7h7v-4H7v4h7V4H-10z" fill="#b58459" /><path d="M-8-12h4v5h-4zM8-12h4v5H8z" fill="#8d6246" /><path d="M-7-10h2v3h-2zM9-10h2v3H9z" fill="#d7a081" /><path d="M-8-7H9V0H-8z" fill="#e5bf8b" /><path d="M-7-7H7v2H-7zM-9 0H8v2H-9z" fill="#f0d5a1" /><path d="M-2-7h2v3h-2zM2-7h2v3H2zM10-3h3v2h-3zM9 1h3v1H9z" fill="#9c704d" /><path d="M-5-4h3v1h-3zM4-4h3v1H4z" fill="#654631" /><path d="M0-2h2v1H0z" fill="#bd8468" /><path d="M-10-2h5m10 0h6" stroke="#dbc5a2" strokeWidth=".5" /></g>
      <path className="px-cat-tail" d="M13 0h9v-5h4v9H13z" fill="#cba27a" /><text className="px-cat-z" x={12} y={-18}>z</text>
    </g>
    <g className="px-sunset-only px-leaf-drift" fill="#d7bb77"><path d="M80 256h4v2h-2v3h-3zM579 165h4v3h-2v2h-3zM98 117h4v2h-2v3h-3z" /></g>
    <g className="px-window-motes" fill="#fbe3b0">{Array.from({ length: 12 }, (_, i) => <circle key={i} className="px-dust-mote" cx={280 + i * 41 % 144} cy={111 + i * 29 % 129} r={i % 3 ? .45 : .7} style={{ animationDelay: `${i * -1.3}s` }} />)}</g>
    <g className="px-night-only">{Array.from({ length: 18 }, (_, i) => <circle key={i} className="px-firefly" cx={(i * 83 + 35) % 640} cy={i % 3 === 0 ? 32 : 309 + i * 13 % 79} r={i % 3 === 0 ? 1 : 1.5} fill="#e8d58a" style={{ animationDelay: `${i * -.61}s` }} />)}</g>
    <g className="px-rain-only">
      <g className="px-rainfall" stroke="#d6e0d8" strokeWidth="1" opacity=".32">{Array.from({ length: 46 }, (_, i) => {
        const x = i < 16 ? 8 + i * 7 : i < 28 ? 573 + (i - 16) * 6 : 145 + (i - 28) * 24;
        const y = i < 28 ? 20 + i * 43 % 370 : 307 + i * 11 % 80;
        return <path key={i} d={`m${x} ${y}-4 11`} />;
      })}</g>
      <g className="px-rain-splashes" fill="none" stroke="#c3d5c9" opacity=".4"><path d="M181 308h9v3h-9zM388 374h11v3h-11zM541 330h9v3h-9zM45 262h8v3h-8z" /></g>
    </g>
  </g>;
});
