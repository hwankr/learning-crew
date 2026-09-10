import { memo } from 'react';
import { MEMBERS } from '../lib/constants';
import { roomDestination } from '../lib/pixelRoom';

function Plant({ x, y, small = false }: { x: number; y: number; small?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${small ? 0.7 : 1})`}>
      <path d="M-7 0H7v10H5v4H-5v-4H-7z" fill="#b67553" />
      <path d="M-8 0H8v3H-8z" fill="#dc9b6a" />
      <path d="M-1-22h3V0h-3z" fill="#567247" />
      <path d="M-13-17h8v4h6v7h-8v-4h-6zM2-24h8v4h5v7H7v5H2z" fill="#718d56" />
      <path d="M-10-15h6v3h-6zM5-22h5v4H5z" fill="#a6b971" />
    </g>
  );
}

function Bookshelf({ x }: { x: number }) {
  const colors = ['#8e9e77', '#d49d6c', '#a7b8ad', '#bd7764', '#dec086', '#7c9990', '#a58d8a'];
  return (
    <g transform={`translate(${x} 65)`}>
      <path d="M-3-3h104v49H-3z" fill="#8c694e" />
      <path d="M0 0h98v43H0z" fill="#ae865f" />
      {[0, 1].map((row) => (
        <g key={row} transform={`translate(0 ${row * 22})`}>
          {Array.from({ length: 12 }, (_, i) => (
            <g key={i}>
              <rect x={4 + i * 7.5} y={3 + i % 3} width={5} height={16 - i % 3} fill={colors[(i + row * 3) % colors.length]} />
              <rect x={5 + i * 7.5} y={6 + i % 3} width={3} height={1} fill="#fff2d8" opacity=".7" />
            </g>
          ))}
          <path d="M0 19h98v3H0z" fill="#d7b48a" />
        </g>
      ))}
    </g>
  );
}

/** Scenery is static; status and minute ticks only redraw the characters and desk lamps. */
export const PixelRoomBackdrop = memo(function PixelRoomBackdrop() {
  return (
    <g>
      <path d="M0 0h480v352H0z" fill="#e8eedc" />
      <path d="M0 236h480v116H0z" fill="#cedcb6" />
      <path d="M0 256h480v20H0zM220 234h40v118h-40z" fill="#e9dfc4" />
      <path d="M0 274h220v2H0zM260 274h220v2H260z" fill="#bcc89f" />
      {Array.from({ length: 36 }, (_, i) => (
        <path key={i} d={`M${(i * 67 + 7) % 480} ${282 + (i * 19) % 68}h3v-3h2v5h-5z`} fill={i % 2 ? '#b7c999' : '#a9bf8e'} />
      ))}
      <path d="M32 52h432v186H32z" fill="#b3bf9e" />
      <path d="M22 42h436v192H22z" fill="#86684f" />
      <path d="M28 48h424v68H28z" fill="#f2e2bd" />
      <path d="M28 114h424v114H28z" fill="#ddc296" />
      {Array.from({ length: 7 }, (_, i) => (
        <g key={i} stroke="#c8aa7f" strokeWidth="1">
          <path d={`M28 ${119 + i * 16}h424`} />
          {Array.from({ length: 6 }, (_, j) => <path key={j} d={`M${36 + j * 76 + (i % 2) * 30} ${119 + i * 16}v16`} />)}
        </g>
      ))}
      <path d="M28 109h424v5H28z" fill="#b89064" />
      <path d="M22 42h436v6H22z" fill="#d4b589" />
      <path d="M18 35h444v7H18z" fill="#8b735a" />
      <path d="M22 32h436v3H22z" fill="#b8a17d" />
      <Bookshelf x={46} /><Bookshelf x={336} />
      <path d="M197 52h86v54h-86z" fill="#b08b62" />
      <path d="M202 57h76v44h-76z" fill="#c6ddd4" />
      <path d="M204 79h18v-7h13v12h17v-8h14v7h10v16h-72z" fill="#a0b795" />
      <path d="M204 90h13v-6h13v8h20v-4h25v12h-71z" fill="#809d7b" />
      <path d="M207 60h21v3h-21zM213 63h22v3h-22z" fill="#f7f7e4" />
      <path d="M237 55h5v48h-5zM199 76h80v4h-80z" fill="#e6cda4" />
      <path d="M193 103h94v5h-94z" fill="#c8a275" />
      <path d="M246 114h31l37 42h-36z" fill="#ffefd0" opacity=".3" />
      <path d="M166 61h18v18h-18z" fill="#a78461" />
      <path d="M168 63h14v14h-14z" fill="#fcf0d6" />
      <path d="M175 66v5h4" fill="none" stroke="#7a705c" strokeWidth="2" />
      <path d="M302 67h18v24h-18z" fill="#d3b087" />
      <path d="M304 69h14v19h-14z" fill="#eee8c9" />
      <path d="M309 82v-8h3v8zM306 80h9v5h-9z" fill="#91a27b" />
      <Plant x={44} y={143} small /><Plant x={436} y={143} small />
      <g fill="#677854">
        <path d="M5 5h26v8h11v19H0V13h5zM449 0h23v10h8v26h-42V13h11z" />
      </g>
      <g fill="#8d9f70"><path d="M0 6h22v8H0zM447 5h25v8h-25z" /></g>
      <path d="M181 16h118v19H181z" fill="#795e48" />
      <path d="M183 17h114v15H183z" fill="#fcf2d9" />
      <text x="240" y="28" textAnchor="middle" className="px-sign">CREW LIBRARY</text>
      {MEMBERS.map((m, i) => {
        const { x } = roomDestination(i, MEMBERS.length, 'rest');
        return (
          <g key={m.id}>
            <path d={`M${x - 22} 303h47v7h-47z`} fill="#b5c598" />
            <path d={`M${x - 17} 288h34v11h-34z`} fill="#ad8b63" />
            <path d={`M${x - 19} 295h38v5h-38z`} fill="#d1b187" />
            <path d={`M${x - 16} 300h4v9h-4zM${x + 12} 300h4v9h-4z`} fill="#8a745a" />
            <path d={`M${x - 14} 289h28v2h-28z`} fill="#cdb083" />
          </g>
        );
      })}
      <text x="240" y="337" textAnchor="middle" className="px-garden-sign">잠깐 쉬어가도 괜찮아</text>
    </g>
  );
});

export function PixelDesk({ x, lit }: { x: number; lit: boolean }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <path d="M-28 192h60v7h-60z" fill="#c6a878" />
      <path d="M-25 172h5v23h-5zM20 172h5v23h-5z" fill="#95704f" />
      <path d="M-29 164h58v10h-58z" fill="#a87b50" />
      <path d="M-29 163h58v5h-58z" fill="#ebcd96" />
      <path d="M-25 174h50v7h-50z" fill="#c69a66" />
      <path d="M-2 174h4v2h-4z" fill="#916f4e" />
      <path d="M-23 151h2v11h-2zM-27 161h10v2h-10z" fill="#667257" />
      <path d="M-27 142h10v3h3v6h-16v-6h3z" fill={lit ? '#90a06b' : '#82917b'} />
      <path d="M-28 150h12v2h-12z" fill={lit ? '#fff2ac' : '#b7bea0'} />
      {lit && <path d="M-27 152h10l7 11h-24z" fill="#fff0ac" opacity=".38" />}
      <path d="M-8 158h8v1h8v7H0v-1h-8z" fill="#907d61" />
      <path d="M-8 157h7v1h2v-1h7v7H1v1h-2v-1h-7z" fill="#fff3d4" />
      <path d="M0 159v5M-6 159h4M-6 161h4M3 159h3M3 161h3" stroke="#c6b394" strokeWidth="1" />
      <g className={lit ? 'px-page' : undefined}><path d="M1 157h7v7H1z" fill="#fff8e5" opacity=".7" /></g>
      <path d="M17 157h6v6h-6zM23 158h2v3h-2" fill="#f8edd3" />
      <path d="M18 158h4v1h-4z" fill="#a48c72" />
      {lit && <path className="px-steam" d="M19 154v-4h2v-3" fill="none" stroke="#fff9e9" strokeWidth="1.5" />}
    </g>
  );
}

export const PixelRoomForeground = memo(function PixelRoomForeground() {
  return (
    <g>
      <path d="M22 225h188v9H22zM270 225h188v9H270z" fill="#957855" />
      <path d="M22 224h188v3H22zM270 224h188v3H270z" fill="#dec59b" />
      <path d="M212 233h56v6h-56zM208 239h64v5h-64z" fill="#ccb792" />
      <path d="M208 239h64v2h-64z" fill="#eee1c2" />
      <Plant x={47} y={216} /><Plant x={433} y={216} />
      <path d="M0 310h20v8h13v34H0zM463 310h17v42h-31v-32h14z" fill="#7f9867" />
      <path d="M0 310h17v8H0zM456 322h24v8h-24zM6 330h20v8H6z" fill="#a1b77b" />
      <path d="M16 325h3v3h-3zM465 340h3v3h-3z" fill="#f8e5ae" />
      <g className="px-butterfly" fill="#e0b777"><path d="M30 270h4v4h-4zM36 268h4v4h-4z" /></g>
    </g>
  );
});
