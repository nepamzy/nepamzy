import { cn } from './cn'
import { Icon, type IconName } from './icons'

export function NoImageTile({
  icon = 'bag',
  className,
  label,
}: {
  icon?: IconName
  className?: string
  label?: string
}) {
  return (
    <div
      role="img"
      aria-label={label ?? 'No photo yet'}
      className={cn(
        'grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-t-[var(--radius-card)] bg-gradient-to-br from-navy-900 to-navy-700 text-gold-400',
        className,
      )}
    >
      <Icon name={icon} size={44} />
    </div>
  )
}
