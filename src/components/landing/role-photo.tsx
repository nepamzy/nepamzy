/** The AI-made picture for one of the three people AFIT Market is for. Decorative: the words beside it say everything. */
const SRC = {
  customer: '/art/role-customer.jpg',
  vendor: '/art/role-vendor.jpg',
  rider: '/art/role-rider.jpg',
} as const

export type RoleKind = keyof typeof SRC

export function RolePhoto({ kind, className = '' }: { kind: RoleKind; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SRC[kind]}
      alt=""
      width={640}
      height={640}
      loading="lazy"
      className={`aspect-square rounded-2xl object-cover ${className}`}
    />
  )
}
