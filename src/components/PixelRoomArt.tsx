import { memo, type CSSProperties } from 'react';
import { MEMBERS } from '../lib/constants';
import { roomDestination, type StudyPose } from '../lib/pixelRoom';

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

export const PixelRoomBackdrop = memo(function PixelRoomBackdrop() {
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
    {MEMBERS.map((m, i) => { const p = roomDestination(i, MEMBERS.length, 'library'); return <g key={m.id} transform={`translate(${p.x} ${p.y})`}>
      <path d="M-14-15H14V9H-14z" fill="#485951" /><path d="M-11-13H11V8H-11z" fill="#7b8c72" /><path d="M-10-12H10v3H-10z" fill="#a5ad86" /><path d="M-15 9h30v5h-30z" fill="#56644f" />
    </g>; })}
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

export function PixelDesk({ x, y, lit, kind, color }: { x: number; y: number; lit: boolean; kind: StudyPose; color: string }) {
  return <g transform={`translate(${x} ${y})`}>
    {lit && <ellipse className="px-desk-glow" cx={-8} cy={-8} rx={48} ry={32} fill="#ffca79" opacity=".12" />}
    <path d="M-33 30h74v8h-74z" fill="#4d3c32" opacity=".17" />
    <path d="M-29 6h6v29h-6zM24 6h6v29h-6z" fill="#73543f" /><path d="M-28 8h2v25h-2zM25 8h2v25h-2z" fill="#b78658" />
    <path d="M-35-6h71V7h-71z" fill="#6b4736" /><path d="M-35-8h71V0h-71z" fill="#d9a56e" /><path d="M-35-8h71v2h-71z" fill="#f3cb8f" />
    <path d="M-30 7h61v9h-61z" fill="#b68150" /><path d="M-1 8h5v2h-5z" fill="#69563d" />
    <path d="M-33 1h67v2h-67z" fill="#ad774a" /><path d="M-19 11h6v3h-6z" fill={color} opacity={lit ? .8 : .25} />
    <path d="M-28-23h2v15h-2zM-33-9h12v2h-12z" fill="#526e62" />
    <path d="M-33-32h12v3h4v7h-20v-7h4z" fill={lit ? '#6f9580' : '#657c6f'} /><path d="M-35-23h16v3h-16z" fill={lit ? '#ffdea0' : '#a3aa86'} />
    {lit && <path d="M-34-20h14L-6-9h-44z" fill="#ffe3a2" opacity=".18" />}
    {kind === 'type' ? <g transform="translate(2 1) scale(.9 .65)">
      <path d="M-8-28h27v18H-8z" fill="#465654" /><path d="M-6-26h23v14H-6z" fill={lit ? '#86b5ae' : '#84948b'} />
      <path d="M-4-23H9v1H-4zM-4-20h18v1H-4zM-4-17h10v1H-4z" fill="#deeed3" opacity={lit ? .9 : .3} />
      <path d="M-10-10h31v4h-31zM-6-9h20v1H-6z" fill="#a8b3a2" /><path className={lit ? 'px-screen-cursor' : undefined} d="M8-17h2v2H8z" fill="#f4e1a3" />
    </g> : <g>
      <path d="M-11-14h12v1h11v9H0v-1h-11z" fill="#88684e" /><path d="M-11-15H0v1h2v-1h10v9H2v1H0v-1h-11z" fill="#f9e8c1" />
      <path d="M1-13v7M-8-12h6M-8-9h6M4-12h6M4-9h5" stroke="#b9a786" strokeWidth="1" />
      <g className={lit && kind === 'read' ? 'px-page' : undefined}><path d="M2-15h10v9H2z" fill="#fff1cf" opacity=".8" /></g>
      {kind === 'write' && <path d="m13-13 3 1-3 8-2-1z" fill="#55675a" />}
    </g>}
    <path d="M24-14h7v7h-7zM31-13h3v4h-3" fill="#f0d6b0" /><path d="M25-13h5v2h-5z" fill="#8d6850" />
    {lit && <path className="px-steam" d="M26-18v-4h2v-4" fill="none" stroke="#fff2ce" strokeWidth="1.5" />}
    <path d="M-29 18h9v12h-9z" fill="#778a75" /><path d="M-27 17h5v2h-5z" fill="#b1b090" />
  </g>;
}

export const PixelFrontWall = memo(function PixelFrontWall() {
  return <g>
    <path d="M128 280h195v10H128zM377 280h188v10H377z" fill="#5b493b" /><path d="M128 279h195v4H128zM377 279h188v4H377z" fill="#c79863" />
    <path d="M128 278h195v2H128zM377 278h188v2H377z" fill="#ebc58a" /><path d="M329 282h43v6h-43zM324 288h54v5h-54zM320 293h62v4h-62z" fill="#ad9370" /><path d="M325 288h52v2h-52zM321 293h60v2h-60z" fill="#dcc39a" />
    <path d="M128 267h10v23h-10zM553 267h11v23h-11z" fill="#876244" />
  </g>;
});

export const PixelRoomForeground = memo(function PixelRoomForeground() {
  return <g>
    <Tree x={23} y={434} scale={1.12} delay={-3} /><Tree x={622} y={429} scale={1.05} delay={-5} />
    <g className="px-cat" transform="translate(565 363)">
      <ellipse cx={4} cy={5} rx={17} ry={4} fill="#233f3f" opacity=".24" />
      <g className="px-cat-breathe"><path d="M-10-7h7v-4H7v4h7V4H-10z" fill="#cba27a" /><path d="M-8-12h4v5h-4zM8-12h4v5H8z" fill="#b78064" /><path d="M-8-7H9V0H-8z" fill="#ead1a3" /><path d="M-5-4h3v1h-3zM4-4h3v1H4z" fill="#705448" /></g>
      <path className="px-cat-tail" d="M13 0h9v-5h4v9H13z" fill="#cba27a" /><text className="px-cat-z" x={12} y={-18}>z</text>
    </g>
    <g className="px-sunset-only px-leaf-drift" fill="#d7bb77"><path d="M80 256h4v2h-2v3h-3zM579 165h4v3h-2v2h-3zM98 117h4v2h-2v3h-3z" /></g>
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
