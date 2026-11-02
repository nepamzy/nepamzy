/**
 * Flat illustrations of the three people AFIT Market is for: a customer, a shop owner and a rider.
 * Pure SVG, decorative only (the text beside them says everything). Colours come from the theme except skin and hair tones.
 */
const SKIN = ['rgb(141 85 36)', 'rgb(198 134 66)', 'rgb(233 190 150)']
const HAIR = 'rgb(34 28 24)'

type P = { className?: string }

export function CustomerArt({ className }: P) {
  return (
    <svg viewBox="0 0 240 280" className={className} aria-hidden="true" focusable="false">
      <circle cx="120" cy="150" r="104" className="fill-brand-50" />
      {/* legs and shoes */}
      <rect x="92" y="196" width="22" height="64" rx="10" className="fill-navy-800" />
      <rect x="126" y="196" width="22" height="64" rx="10" className="fill-navy-800" />
      <rect x="86" y="252" width="32" height="14" rx="7" className="fill-gold-400" />
      <rect x="122" y="252" width="32" height="14" rx="7" className="fill-gold-400" />
      {/* body */}
      <rect x="82" y="116" width="76" height="96" rx="26" className="fill-navy-900" />
      <rect x="82" y="150" width="76" height="14" className="fill-gold-400" />
      {/* arm holding the phone */}
      <path
        d="M154 134c24 6 34 24 24 44"
        stroke={SKIN[1]}
        strokeWidth="16"
        strokeLinecap="round"
        fill="none"
      />
      <rect
        x="164"
        y="148"
        width="36"
        height="62"
        rx="8"
        className="fill-navy-950"
        transform="rotate(12 182 179)"
      />
      <rect
        x="168"
        y="154"
        width="28"
        height="48"
        rx="5"
        className="fill-white"
        transform="rotate(12 182 179)"
      />
      <g transform="rotate(12 182 179)">
        <path d="M174 170h20l-3 14h-14z" className="fill-gold-400" />
        <circle cx="178" cy="190" r="2.4" className="fill-navy-900" />
        <circle cx="189" cy="190" r="2.4" className="fill-navy-900" />
        <path
          d="M172 164h4l3 6"
          className="stroke-navy-900"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </g>
      <path
        d="M86 134c-16 8-22 26-14 44"
        stroke={SKIN[1]}
        strokeWidth="16"
        strokeLinecap="round"
        fill="none"
      />
      {/* head */}
      <rect x="110" y="98" width="20" height="24" rx="8" fill={SKIN[1]} />
      <circle cx="120" cy="84" r="30" fill={SKIN[1]} />
      <path
        d="M90 80c0-22 14-34 32-34s30 12 28 34c-8-12-20-16-32-14-12 2-20 6-28 14Z"
        fill={HAIR}
      />
      <circle cx="109" cy="88" r="3" fill={HAIR} />
      <circle cx="131" cy="88" r="3" fill={HAIR} />
      <path
        d="M110 101q10 8 20 0"
        stroke={HAIR}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      {/* backpack strap */}
      <path
        d="M96 120c-4 20-4 44 2 70"
        stroke="rgb(255 255 255 / .25)"
        strokeWidth="8"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function VendorArt({ className }: P) {
  return (
    <svg viewBox="0 0 280 280" className={className} aria-hidden="true" focusable="false">
      <circle cx="140" cy="150" r="108" className="fill-warning-50" />
      {/* stall awning */}
      <path d="M30 70h220l-14 46H44z" className="fill-gold-400" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path
          key={i}
          d={`M${30 + i * 36.7} 70h18.3l-6.4 46H${44 + i * 32.2}z`}
          className="fill-navy-900"
          opacity={i % 2 === 0 ? 1 : 0}
        />
      ))}
      <path
        d="M44 116q9 14 18 0q9 14 18 0q9 14 18 0q9 14 18 0q9 14 18 0q9 14 18 0q9 14 18 0q9 14 18 0q9 14 18 0q9 14 18 0q9 14 18 0q9 14 18 0z"
        className="fill-gold-400"
      />
      <rect x="40" y="70" width="6" height="190" className="fill-navy-800" />
      <rect x="234" y="70" width="6" height="190" className="fill-navy-800" />
      {/* person */}
      <rect x="112" y="150" width="56" height="70" rx="22" className="fill-white" />
      <path d="M118 156h44v64h-44z" className="fill-gold-400" opacity=".9" />
      <rect x="130" y="130" width="20" height="24" rx="8" fill={SKIN[0]} />
      <circle cx="140" cy="120" r="26" fill={SKIN[0]} />
      <path
        d="M116 116c0-18 10-28 24-28s26 10 24 28c-6-8-14-12-24-11-10 0-18 4-24 11Z"
        fill={HAIR}
      />
      <circle cx="131" cy="123" r="2.6" fill={HAIR} />
      <circle cx="149" cy="123" r="2.6" fill={HAIR} />
      <path d="M131 134q9 7 18 0" stroke={HAIR} strokeWidth="3" fill="none" strokeLinecap="round" />
      <path
        d="M112 164c-18 6-24 18-18 30M168 164c18 6 24 18 18 30"
        stroke={SKIN[0]}
        strokeWidth="14"
        strokeLinecap="round"
        fill="none"
      />
      {/* counter and goods */}
      <rect x="40" y="206" width="200" height="54" rx="8" className="fill-navy-900" />
      <rect x="40" y="206" width="200" height="12" rx="6" className="fill-navy-700" />
      <ellipse cx="82" cy="200" rx="26" ry="8" className="fill-white" />
      <path d="M62 198a20 16 0 0 1 40 0z" className="fill-gold-400" />
      <rect x="198" y="168" width="30" height="38" rx="5" className="fill-white" />
      <rect x="198" y="168" width="30" height="10" rx="4" className="fill-brand-600" />
      <path
        d="M205 184h16M205 192h16"
        className="stroke-muted"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M170 206l12-22h16l-4 22z" className="fill-white" />
      <circle cx="176" cy="196" r="3" className="fill-gold-400" />
    </svg>
  )
}

export function RiderArt({ className }: P) {
  return (
    <svg viewBox="0 0 320 260" className={className} aria-hidden="true" focusable="false">
      <circle cx="170" cy="130" r="106" className="fill-vendor-50" />
      {/* speed lines */}
      <path
        d="M16 120h54M4 146h60M24 172h46"
        className="stroke-gold-400"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* delivery box */}
      <rect x="62" y="96" width="62" height="56" rx="8" className="fill-gold-400" />
      <path d="M62 116h62" className="stroke-navy-900" strokeWidth="4" />
      <path d="M84 96v20h18V96" className="fill-navy-900" />
      {/* scooter */}
      <path d="M120 176h112l18-46h-22l-12 30h-96z" className="fill-navy-900" />
      <path
        d="M236 126l22-30h18"
        className="stroke-navy-900"
        strokeWidth="9"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="132" y="150" width="76" height="14" rx="7" className="fill-navy-700" />
      <circle cx="104" cy="196" r="28" className="fill-navy-950" />
      <circle cx="104" cy="196" r="12" className="fill-white" />
      <circle cx="252" cy="196" r="28" className="fill-navy-950" />
      <circle cx="252" cy="196" r="12" className="fill-white" />
      <circle cx="104" cy="196" r="4" className="fill-navy-900" />
      <circle cx="252" cy="196" r="4" className="fill-navy-900" />
      {/* rider */}
      <path d="M154 150l30-62 30 14-14 44z" className="fill-vendor-700" />
      <path d="M190 108l52-8" stroke={SKIN[0]} strokeWidth="13" strokeLinecap="round" fill="none" />
      <path
        d="M162 150l12 40h22"
        className="stroke-navy-950"
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <rect x="170" y="70" width="18" height="22" rx="8" fill={SKIN[0]} />
      <circle cx="182" cy="62" r="22" fill={SKIN[0]} />
      <path d="M158 62a24 24 0 0 1 48 0v6h-48z" className="fill-gold-400" />
      <path d="M190 66h22v10h-22z" className="fill-navy-900" />
      <circle cx="176" cy="74" r="2.4" fill={HAIR} />
    </svg>
  )
}

/** The hero picture: a shop, a rider crossing campus along a dotted route, and a customer waiting. */
export function HeroScene({ className }: P) {
  return (
    <svg viewBox="0 0 640 400" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="afit-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(23 74 156)" />
          <stop offset="1" stopColor="rgb(11 42 92)" />
        </linearGradient>
      </defs>
      <rect width="640" height="400" rx="28" fill="url(#afit-sky)" />
      <circle cx="540" cy="70" r="34" className="fill-gold-400 afit-float-slow" />
      {/* skyline */}
      <g className="fill-navy-800" opacity=".7">
        <rect x="20" y="170" width="54" height="130" rx="4" />
        <rect x="84" y="130" width="46" height="170" rx="4" />
        <rect x="140" y="190" width="60" height="110" rx="4" />
        <rect x="420" y="150" width="50" height="150" rx="4" />
        <rect x="480" y="190" width="60" height="110" rx="4" />
        <rect x="550" y="140" width="64" height="160" rx="4" />
      </g>
      <g className="fill-gold-400" opacity=".55">
        {[0, 1, 2].map((i) => (
          <rect key={i} x={96} y={146 + i * 30} width="8" height="12" rx="2" />
        ))}
        {[0, 1, 2].map((i) => (
          <rect key={i} x={566} y={158 + i * 30} width="8" height="12" rx="2" />
        ))}
      </g>
      {/* ground and road */}
      <rect y="300" width="640" height="100" className="fill-navy-950" />
      <rect y="320" width="640" height="46" className="fill-navy-900" />
      <path
        d="M0 343h640"
        stroke="rgb(255 255 255 / .35)"
        strokeWidth="3"
        strokeDasharray="22 18"
      />
      {/* route */}
      <path
        d="M178 268C250 190 330 190 440 262"
        stroke="rgb(255 201 40)"
        strokeWidth="4"
        strokeDasharray="2 12"
        strokeLinecap="round"
        fill="none"
        className="afit-route"
      />
      <circle cx="178" cy="268" r="8" className="fill-gold-400" />
      <circle cx="440" cy="262" r="8" className="fill-white" />
      {/* the people */}
      <svg x="6" y="190" width="180" height="180" viewBox="0 0 280 280">
        <VendorArt />
      </svg>
      <svg x="430" y="130" width="170" height="200" viewBox="0 0 240 280">
        <CustomerArt />
      </svg>
      <g className="afit-ride">
        <svg x="230" y="262" width="150" height="122" viewBox="0 0 320 260">
          <RiderArt />
        </svg>
      </g>
      {/* map pin above the customer */}
      <g className="afit-bob">
        <path
          d="M520 78c-14 0-24 10-24 24 0 18 24 40 24 40s24-22 24-40c0-14-10-24-24-24z"
          className="fill-gold-400"
        />
        <circle cx="520" cy="102" r="9" className="fill-navy-900" />
      </g>
    </svg>
  )
}
