import { memo, useId, type CSSProperties } from 'react';
import { MEMBERS } from '../lib/constants';
import { roomDestination } from '../lib/pixelRoom';

// The environment uses the same small, hard-edged pixels and warm outlines as the sprites.
function Tree({ x, y, size = 1, seed = 0 }: { x: number; y: number; size?: number; seed?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`}>
    <path d="M-32-5h62v9h-62zM-21 4h45v4h-45z" fill="var(--px-deep)" opacity=".25" />
    <path d="M-6-63H7V2H-6zM-10-3h20v6h-20z" fill="#534738" />
    <path d="M-5-55h3V0h-3zM0-25h3v5H0zM-12-35h9v4h-9z" fill="#997451" />
    <g className="px-canopy" style={{ '--px-delay': `${seed * -.7}s` } as CSSProperties}>
      <path d="M-17-111h31v7h14v9h13v15h9v26H38v14H20v8H-9v-5h-23v-10h-13v-16h-6v-19h11v-16h15v-8h8z" fill="var(--px-leaf-dark)" />
      <path d="M-17-108h28v8h14v12h14v22H27v13H7v5h-26v-10h-18v-19h-5v-10h13v-14h12z" fill="var(--px-leaf)" />
      <path d="M-16-103H5v7h10v10H-5v9h-24v-14h13zM10-76h20v11H10zM-24-62h13v7h-13z" fill="var(--px-leaf-light)" />
      {Array.from({ length: 35 }, (_, i) => <path key={i} d={`M${-33 + (i * 17 + seed * 7) % 62} ${-92 + i * 13 % 48}h${3 + i % 3}v2h-2v2h-3z`} fill={i % 3 ? 'var(--px-leaf-light)' : 'var(--px-leaf-glint)'} opacity={i % 2 ? '.6' : '.4'} />)}
      <path d="M-13-100h7v3h-7zM-28-85h5v2h-5zM9-72h5v2H9zM28-52h4v2h-4z" fill="var(--px-leaf-glint)" />
    </g>
  </g>;
}

function Plant({ x, y, flower = false }: { x: number; y: number; flower?: boolean }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M-10 10h22v4h-22z" fill="#293d34" opacity=".2" />
    <path d="M-7 0H7v8H5v5H-5V8H-7z" fill="#a7684f" /><path d="M-8-1H8v4H-8zM-5 4h2v7h-2z" fill="#dfab79" />
    <path d="M-1-20h2V1h-2zM-10-13h6v3h5v5h-7v-3h-4zM1-20h6v3h5v5H6v5H1z" fill="#4f7356" />
    <path d="M-9-13h5v2h-5zM3-19h4v3H3zM2-8h4v2H2z" fill="#9caa70" />
    {flower && <path d="M-10-16h4v4h-4zM4-22h4v4H4zM9-14h3v3H9z" fill="#eda89a" />}
  </g>;
}

function Bookshelf({ x, y, width = 112, rows = 2 }: { x: number; y: number; width?: number; rows?: number }) {
  const colors = ['#7d9e91', '#c9a06b', '#a4645a', '#b0b283', '#597d81', '#a78792'];
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M-3-3h${width + 6}v${rows * 22 + 8}H-3z`} fill="#4d3e31" />
    <path d={`M0 0h${width}v${rows * 22 + 2}H0z`} fill="#735438" />
    {Array.from({ length: rows }, (_, row) => <g key={row} transform={`translate(0 ${row * 22})`}>
      {Array.from({ length: Math.floor((width - 8) / 6) }, (_, i) => <g key={i}>
        <path d={`M${4 + i * 6} ${3 + (i + row) % 4}h4v${16 - (i + row) % 4}h-4z`} fill={colors[(i * 3 + row) % colors.length]} />
        <path d={`M${5 + i * 6} ${5 + (i + row) % 4}h1v10h-1zM${5 + i * 6} 16h2v1h-2z`} fill="#f4d6a6" opacity=".65" />
      </g>)}
      <path d={`M0 19h${width}v3H0z`} fill="#b88c58" /><path d={`M0 22h${width}v1H0z`} fill="#372f28" />
    </g>)}
    <path d={`M-3-4h${width + 6}v2H-3zM-2-2h2v${rows * 22 + 4}h-2z`} fill="#d0a46c" />
  </g>;
}

function Window({ x, y = 69, moon = false }: { x: number; y?: number; moon?: boolean }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M-4-4h78v48H-4z" fill="#624b37" /><path d="M0 0h70v39H0z" fill="var(--px-window)" />
    <path d="M0 25h11v-6h13v8h15v-5h15v-7h16v24H0z" fill="var(--px-horizon)" />
    <path d="M0 34h18v-6h12v7h15v-5h25v9H0z" fill="var(--px-leaf-dark)" />
    <path className="px-sunset-only" d="M5 9h23v2H5zM11 12h18v2H11zM45 5h12v2h2v8h-2v2H45v-2h-2V7h2z" fill="#ffd39b" />
    <g className="px-night-only" fill="#f7e4b3"><path d="M10 8h2v2h-2zM27 19h2v2h-2zM60 23h1v2h-1z" />{moon && <path d="M48 4h8v3h-6v8h6v3h-8v-3h-3V7h3z" />}</g>
    <path className="px-rain-only px-window-rain" d="m14 4-3 10m18-6-3 12m32-17-3 11m-8 5-3 11" stroke="#c4ded9" opacity=".6" />
    <path d="M33 0h4v39h-4zM0 21h70v3H0z" fill="#a77c51" /><path d="M33 0h1v39h-1zM0 21h70v1H0z" fill="#efc78c" />
    <path d="M-7 39h84v5H-7z" fill="#b08757" /><path d="M-7 39h84v2H-7z" fill="#f0cd94" />
    <path d="M-7-4H3v34H0v4h-7zM67-4h11v38h-7v-4h-4z" fill="#7f8b6a" /><path d="M-5-1h2v30h-2zM73-1h2v30h-2z" fill="#b0b488" />
  </g>;
}

function Bench({ x, y, width = 60 }: { x: number; y: number; width?: number }) {
  return <g transform={`translate(${x - width / 2} ${y - 19})`}>
    <path d={`M-3 24h${width + 9}v5H-3z`} fill="var(--px-deep)" opacity=".2" />
    <path d={`M0 0h${width}v12H0zM-3 15h${width + 6}v6H-3z`} fill="#79583e" />
    <path d={`M1 1h${width - 2}v3H1zM1 7h${width - 2}v3H1zM-3 15h${width + 6}v2H-3z`} fill="#c59b69" />
    <path d={`M4 21h4v8H4zM${width - 8} 21h4v8h-4zM0 10h2v8H0zM${width - 2} 10h2v8h-2z`} fill="#414d40" />
    <path d={`M10 2h16v1H10zM${width - 21} 8h12v1h-12z`} fill="#edd0a0" opacity=".6" />
  </g>;
}

function Lantern({ x, y }: { x: number; y: number }) {
  const glow = useId();
  return <g transform={`translate(${x} ${y})`}>
    <defs><radialGradient id={glow}><stop stopColor="#ffdb91" /><stop offset=".4" stopColor="#faca87" stopOpacity=".45" /><stop offset="1" stopColor="#faca87" stopOpacity="0" /></radialGradient></defs>
    <ellipse className="px-lantern-glow" cy={-30} rx={33} ry={38} fill={`url(#${glow})`} opacity=".08" shapeRendering="auto" />
    <path d="M-2-40h4V0h-4zM-5 0H5v3H-5zM-8-45H8v3H-8z" fill="#344b43" />
    <path d="M-6-42H6v16H-6z" fill="#617263" /><path d="M-4-39H4v10H-4z" fill="#ffe2a5" /><path d="M-7-27H7v3H-7zM-5-47H5v2H-5z" fill="#344b43" />
  </g>;
}

function Sign({ x, y, text, small = false }: { x: number; y: number; text: string; small?: boolean }) {
  const w = small ? 80 : 124;
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M${-w / 2 - 2}-2h${w + 4}v21h-${w + 4}z`} fill="#4b4833" />
    <path d={`M${-w / 2} 0h${w}v16h-${w}z`} fill="#667354" /><path d={`M${-w / 2} 0h${w}v1h-${w}z`} fill="#c1b77c" />
    <text className="px-place-sign" textAnchor="middle" y={11}>{text}</text>
  </g>;
}

export const PixelRoomBackdrop = memo(function PixelRoomBackdrop() {
  const id = useId();
  const pattern = (name: string) => `url(#${id}-${name})`;
  return <g>
    <defs>
      <radialGradient id={`${id}-bulb-glow`}><stop stopColor="#ffdc9a" /><stop offset=".35" stopColor="#ffcf8d" stopOpacity=".5" /><stop offset="1" stopColor="#ffcf8d" stopOpacity="0" /></radialGradient>
      <pattern id={`${id}-grass`} width="48" height="40" patternUnits="userSpaceOnUse">
        <rect width="48" height="40" fill="var(--px-grass)" />
        <path d="M5 8h5v2H5zM27 24h7v2h-7zM39 3h3v2h-3zM12 33h4v2h-4z" fill="var(--px-grass-light)" opacity=".4" />
        <path d="M18 16h2v-3h1v4h-3zM41 34h3v-2h2v4h-5z" fill="var(--px-ground)" opacity=".5" />
      </pattern>
      <pattern id={`${id}-floor`} width="64" height="24" patternUnits="userSpaceOnUse">
        <rect width="64" height="24" fill="var(--px-floor)" />
        <path d="M0 0h64v1H0zM0 12h64v1H0zM17 0h1v12h-1zM49 12h1v12h-1z" fill="var(--px-floor-line)" />
        <path d="M0 1h64v1H0zM0 13h64v1H0zM6 7h17v1H6zM37 20h17v1H37z" fill="#f0ce95" opacity=".3" />
        <path d="M32 4h13v1H32zM9 18h18v1H9zM54 8h7v1h-7z" fill="#956b48" opacity=".18" />
      </pattern>
      <pattern id={`${id}-pavers`} width="32" height="24" patternUnits="userSpaceOnUse">
        <rect width="32" height="24" fill="var(--px-path-shadow)" />
        <path d="M1 1h29v9H1zM-14 13h28v9h-28zM17 13h29v9H17z" fill="var(--px-path)" />
        <path d="M2 2h26v1H2zM18 14h13v1H18zM1 14h11v1H1z" fill="var(--px-stone)" opacity=".65" />
        <path d="M22 7h3v1h-3zM8 19h4v1H8z" fill="var(--px-path-shadow)" opacity=".6" />
      </pattern>
      <pattern id={`${id}-cafe`} width="24" height="24" patternUnits="userSpaceOnUse">
        <rect width="24" height="24" fill="#b5ad89" /><path d="M0 0h12v12H0zM12 12h12v12H12z" fill="#d8c8a1" /><path d="M0 0h24M0 12h24M0 0v24M12 0v24" stroke="#978f70" strokeWidth=".5" />
      </pattern>
    </defs>
    <rect width="1024" height="640" fill={pattern('grass')} />
    <path d="M0 0h1024v61H0zM0 70h57v301H0zM974 70h50v296h-50z" fill="var(--px-ground)" />
    {Array.from({ length: 17 }, (_, i) => <Tree key={i} x={i * 66 - 14} y={78 + i % 3 * 13} size={.8 + i % 3 * .12} seed={i} />)}
    <Tree x={21} y={221} size={1.05} /><Tree x={992} y={219} size={1.12} seed={7} />
    <Tree x={16} y={348} size={1.16} seed={3} /><Tree x={1004} y={357} size={1.15} seed={1} />

    {/* Paved routes have the same geometry as the walkable graph. */}
    <g fill="none" stroke={pattern('pavers')} strokeWidth="28" strokeLinejoin="miter">
      <path d="M0 398h1024M352 354v44M816 346v52M260 398v192h686V398M260 452h686M384 398v192M646 398v192M704 452v138M704 492h112v-40M482 452v84M76 398v34" />
      <path d="M758 452v-22M316 590v-26M808 590v-48M430 590v6" strokeWidth="20" />
    </g>
    <path d="M0 380h326M379 380h409M846 380h178M0 417h239M969 417h55" stroke="var(--px-grass-light)" strokeWidth="2" opacity=".65" />

    {/* Library: warm cutaway walls, readable aisles and a private desk for each member. */}
    <path d="M77 69h566v300H77z" fill="var(--px-deep)" opacity=".24" />
    <path d="M70 52h564v305H70z" fill="#514837" />
    <path d="M78 111h548v243H78z" fill={pattern('floor')} />
    <path d="M78 59h548v61H78z" fill="var(--px-wall)" />
    <path d="M78 59h548v5H78zM78 115h548v5H78z" fill="#a07c52" />
    <path d="M80 65h543v2H80zM79 113h546v2H79z" fill="#f7daa8" />
    <path d="M71 53h562v5H71zM72 59h5v289h-5zM627 59h5v289h-5z" fill="#c49864" />
    <path d="M72 53h560v1H72zM72 60h1v288h-1z" fill="#f5d39b" />
    <Bookshelf x={92} y={70} width={87} rows={2} />
    <Window x={218} /><Window x={367} moon /><Window x={517} />
    <Bookshelf x={88} y={128} width={30} rows={3} /><Bookshelf x={609} y={128} width={17} rows={3} />
    <Bookshelf x={91} y={253} width={29} rows={3} /><Bookshelf x={609} y={253} width={17} rows={3} />
    <path d="M180 144h386v88H180zM228 249h280v80H228z" fill="#716c4e" opacity=".1" />
    <path d="M178 231h390M226 329h284" stroke="#f1d6a3" strokeWidth="1" opacity=".4" />
    <Sign x={352} y={39} text="LITTLE FOREST LIBRARY" />
    <Plant x={185} y={110} /><Plant x={466} y={109} />
    <Plant x={101} y={224} flower /><Plant x={608} y={225} />
    <path d="M307 348h91v4h-91z" fill="#a38f61" /><path d="M310 349h86v1h-86z" fill="#d8c899" />
    {MEMBERS.map((m, i) => { const p = roomDestination(i, MEMBERS.length, 'library'); return <g key={m.id} className="px-chair" transform={`translate(${p.x} ${p.y})`}>
      <path d="M-15-15h30v27h-30z" fill="#4c422f" /><path d="M-14-16h28v2h-28zM-15-14h2v24h-2z" fill="#bc935f" />
      <path d="M-11-12h22V8h-22z" fill="#3b6053" /><path d="M-10-11h20v2h-20zM-10-9h1V6h-1z" fill="#879775" />
      <path d="M-5-5h1v1h-1zM4-5h1v1H4zM-5 1h1v1h-1zM4 1h1v1H4z" fill="#bdba87" />
      <path d="M-14 7h28v5h-28z" fill="#6b7659" /><path d="M-14 7h28v1h-28zM-16-1h3v9h-3zM13-1h3v9h-3z" fill="#ae8b5b" />
    </g>; })}

    {/* Café counter and two window seats. */}
    <path d="M690 104h278v252H690z" fill="var(--px-deep)" opacity=".25" />
    <path d="M682 92h282v257H682z" fill="#514837" /><path d="M690 143h266v202H690z" fill={pattern('cafe')} />
    <path d="M690 99h266v46H690z" fill="var(--px-wall)" /><path d="M684 94h278v5H684zM684 100h5v243h-5zM957 100h5v243h-5z" fill="#c39663" />
    <Window x={713} y={105} /><Bookshelf x={812} y={106} width={56} rows={1} />
    <path d="M883 123h64v24h-64z" fill="#714d35" /><path d="M880 121h70v5h-70zM886 129h57v2h-57z" fill="#c49b69" />
    <path d="M887 130h22v13h-22zM915 130h27v13h-27z" fill="#956a44" /><path d="M903 134h3v2h-3zM917 134h3v2h-3z" fill="#dbc591" />
    <path d="M887 98h29v24h-29z" fill="#354e49" /><path d="M889 100h25v7h-25zM889 118h25v3h-25z" fill="#a4afa0" />
    <path d="M892 102h4v2h-4zM903 102h3v2h-3z" fill="#eace87" /><path d="M895 109h14v2h-14zM899 111h2v4h-2zM896 114h8v5h-8z" fill="#f0dfb6" />
    <path className="px-steam" d="M901 96v-3h2v-4" fill="none" stroke="#f6e3b4" opacity=".6" />
    <path d="M929 110h10v11h-10zM932 106h4v4h-4z" fill="#795b43" /><path d="M930 110h2v8h-2z" fill="#c89a66" />
    <Sign x={817} y={80} text="MOSS & MUG" small />
    <Plant x={705} y={166} /><Plant x={940} y={174} flower />
    <Bench x={748} y={276} width={42} /><Bench x={884} y={278} width={42} />
    {[780, 916].map((x) => <g key={x} transform={`translate(${x} 263)`}>
      <path d="M-2-1h4v13h-4zM-8 12H8v2H-8z" fill="#61513c" /><path d="M-14-8h28V0h-28z" fill="#8b6543" /><path d="M-13-8h26v2h-26z" fill="#d1af79" />
      <path d="M-4-14h7v6h-7zM3-13h3v4H3z" fill="#f0dfb6" /><path d="M-3-14h5v1h-5z" fill="#876448" />
    </g>)}
    <path d="M793 332h46v12h-46z" fill="#788468" /><path d="M796 334h40M796 339h40" stroke="#bac295" />
    <Plant x={706} y={324} /><Plant x={940} y={324} />

    {/* Pond, kitchen garden, reading corner and a meeting bay. */}
    <path d="M98 478h100v8h24v16h13v61h-14v22h-25v12H99v-8H77v-18H65v-61h12v-21h21z" fill="var(--px-pond-edge)" />
    <path d="M101 484h94v9h21v16h12v51h-14v20h-24v10h-84v-8H83v-19H72v-48h13v-20h16z" fill="var(--px-stone)" />
    <path d="M107 491h81v10h20v14h12v40h-14v19h-24v9h-71v-9H91v-19H80v-34h13v-20h14z" fill="var(--px-water)" />
    <path d="M107 491h81v5h-79v9H97v18H84v29h-4v-31h13v-20h14z" fill="var(--px-deep)" opacity=".3" />
    <path className="px-water-flow" d="M111 512h19v2h-19zM174 527h22v2h-22zM96 549h15v2H96zM143 570h28v2h-28z" fill="var(--px-water-light)" />
    <g className="px-pond-ripple" stroke="var(--px-water-light)" fill="none" opacity=".6"><path d="M143 532h26v6h-26zM138 529h36v12h-36z" /></g>
    <g className="px-fish"><path d="M118 541h10v2h4v3h-4v2h-10zM114 542h4v5h-4z" fill="#ecc492" /><path d="M123 541h4v7h-4z" fill="#bd835d" /></g>
    <path d="M178 555h17v7h-17zM172 558h24v3h-24zM184 555h3v4h-3z" fill="#5d876c" /><path d="M182 552h5v5h-5z" fill="#e5b6a4" />
    <Plant x={69} y={490} /><Plant x={225} y={585} />
    <Bench x={298} y={452} /><Bench x={758} y={430} /><Bench x={316} y={564} />
    <Bench x={808} y={542} /><Bench x={904} y={452} /><Bench x={430} y={596} width={54} />
    <path d="M500 508h110v46H500z" fill="#6a5d42" /><path d="M501 509h108v2H501zM501 551h108v2H501z" fill="#ccac77" />
    <path d="M505 514h100v32H505z" fill="#594f39" />
    {Array.from({ length: 20 }, (_, i) => <g key={i} transform={`translate(${511 + i % 10 * 10} ${520 + Math.floor(i / 10) * 17})`}>
      <path d="M0-6h1v12H0zM-4 0h4v2h-4zM1 3h4v2H1z" fill="#809961" />
      <path d="M-2-9h5v5h-5zM-4-7h9v2h-9z" fill={['#e8ba8e', '#bf8691', '#e3d095', '#d69f84'][i % 4]} /><path d="M0-7h2v2H0z" fill="#f6dfad" />
    </g>)}
    <Plant x={580} y={568} /><Sign x={554} y={480} text="LITTLE GARDEN" small />
    <path d="M721 470h80v40h-80z" fill="var(--px-path)" /><path d="M722 471h78v1h-78zM722 508h78v1h-78z" fill="var(--px-stone)" />
    <path d="M686 441v-58M846 441v-58" stroke="#66573c" strokeWidth="4" />
    <path d="M686 383q80 36 160 0" fill="none" stroke="#655d43" strokeWidth="1" shapeRendering="auto" />
    {[700, 722, 744, 766, 788, 810, 832].map((x, i) => <g key={x}>
      <ellipse className="px-string-glow" cx={x} cy={389 + (3 - Math.abs(3 - i)) * 4} rx={10} ry={12} fill={pattern('bulb-glow')} opacity=".1" shapeRendering="auto" />
      <path d={`M${x - 1} ${385 + (3 - Math.abs(3 - i)) * 4}h3v7h-3z`} fill="#f8da99" />
    </g>)}
    <Lantern x={315} y={387} /><Lantern x={670} y={441} /><Lantern x={922} y={576} /><Lantern x={247} y={481} />
    <Tree x={42} y={474} size={.83} seed={8} /><Tree x={74} y={640} size={.68} seed={5} />
    <Tree x={984} y={566} size={.85} seed={3} /><Tree x={998} y={668} size={.94} seed={6} />
    <Tree x={572} y={653} size={.68} seed={4} /><Tree x={900} y={665} size={.61} seed={9} />
    <path d="M970 364h4v22h-4zM956 362h34v12h-34z" fill="#7b6547" /><path d="M957 362h32v1h-32z" fill="#d6b584" /><text x={973} y={371} className="px-exit-sign" textAnchor="middle">CAMPUS →</text>
    {Array.from({ length: 24 }, (_, i) => <path key={i} d={`M${24 + i * 43 % 975} ${610 + i * 7 % 28}h3v2h-3z`} fill={i % 2 ? '#e1c798' : 'var(--px-grass-light)'} opacity=".65" />)}
  </g>;
});

export const PixelFrontWall = memo(function PixelFrontWall() {
  return <g>
    <path d="M70 349h255v9H70zM380 349h254v9H380zM682 341h106v9H682zM844 341h120v9H844z" fill="#5d4b33" />
    <path d="M71 349h254v2H71zM380 349h253v2H380zM683 341h105v2H683zM844 341h119v2H844z" fill="#d0a66f" />
    <path d="M328 352h49v5h-49zM322 359h61v4h-61zM791 345h50v5h-50zM788 352h56v4h-56z" fill="#a2916b" />
    <path d="M328 352h49v1h-49zM322 359h61v1h-61zM791 345h50v1h-50zM788 352h56v1h-56z" fill="#e2cfa1" />
  </g>;
});

export const PixelRoomForeground = memo(function PixelRoomForeground() {
  return <g>
    <g className="px-cat" transform="translate(863 556)">
      <ellipse cx={4} cy={5} rx={17} ry={4} fill="#233f36" opacity=".24" />
      <g className="px-cat-breathe"><path d="M-10-7h7v-4H7v4h7V4H-10z" fill="#b58459" /><path d="M-8-12h4v5h-4zM8-12h4v5H8z" fill="#8d6246" /><path d="M-8-7H9V0H-8z" fill="#e5bf8b" /><path d="M-7-7H7v2H-7zM-9 0H8v2H-9z" fill="#f0d5a1" /><path d="M-2-7h2v3h-2zM2-7h2v3H2zM10-3h3v2h-3z" fill="#9c704d" /><path d="M-5-4h3v1h-3zM4-4h3v1H4z" fill="#654631" /><path d="M0-2h2v1H0z" fill="#bd8468" /></g>
      <path className="px-cat-tail" d="M13 0h9v-5h4v9H13z" fill="#cba27a" /><text className="px-cat-z" x={12} y={-18}>z</text>
    </g>
    <g className="px-sunset-only px-leaf-drift" fill="#d7bb77"><path d="M44 316h4v2h-2v3h-3zM672 222h4v3h-2v2h-3zM78 461h4v2h-2v3h-3zM933 524h3v2h-3z" /></g>
    <g className="px-window-motes" fill="#fbe3b0">{Array.from({ length: 12 }, (_, i) => <rect key={i} className="px-dust-mote" x={200 + i * 41 % 370} y={123 + i * 29 % 209} width="1" height="1" style={{ animationDelay: `${i * -1.3}s` }} />)}</g>
    <g className="px-night-only">{Array.from({ length: 28 }, (_, i) => <rect key={i} className="px-firefly" x={(i * 83 + 35) % 1024} y={419 + i * 13 % 210} width={i % 3 ? 2 : 1} height={i % 3 ? 2 : 1} fill="#e8d58a" style={{ animationDelay: `${i * -.61}s` }} />)}</g>
    <g className="px-rain-only">
      <g className="px-rainfall" stroke="#d6e0d8" strokeWidth="1" opacity=".35">{Array.from({ length: 74 }, (_, i) => {
        const x = i < 12 ? 7 + i * 4 : i < 24 ? 976 + (i - 12) * 4 : (i * 43 + 12) % 1024;
        const y = i < 24 ? 15 + i * 43 % 355 : 378 + i * 31 % 250;
        return <path key={i} d={`m${x} ${y}-4 11`} />;
      })}</g>
      <path className="px-rain-splashes" d="M181 398h9v3h-9zM390 587h11v3h-11zM541 452h9v3h-9zM909 397h8v3h-8z" fill="none" stroke="#c3d5c9" opacity=".4" />
    </g>
  </g>;
});
