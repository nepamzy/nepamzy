import type { Metadata } from 'next'
import { PublicHeader } from '@/components/shells/public-header'
import { ORDER_STATES, OrderStatusPill } from '@/components/domain/order-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/fields'
import { Money } from '@/components/ui/money'
import { EmptyState, LoadingState } from '@/components/ui/states'
import { Tabs } from '@/components/ui/tabs'
import { Timeline } from '@/components/ui/timeline'

export const metadata: Metadata = { title: 'Design system' }

export default function DesignPage() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        <PageHeader title="Design system" subtitle="Reference page for reviewers. Not part of the product." />
        <section className="space-y-3"><h2 className="text-xl font-bold">Buttons and badges</h2>
          <div className="flex flex-wrap gap-2"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="danger">Danger</Button><Button variant="ghost">Ghost</Button><Button disabled>Disabled</Button></div>
          <div className="flex flex-wrap gap-2">{(['neutral', 'info', 'success', 'warning', 'danger', 'brand'] as const).map((t) => <Badge key={t} tone={t}>{t}</Badge>)}</div>
        </section>
        <section className="space-y-3"><h2 className="text-xl font-bold">Form controls</h2>
          <Card className="grid gap-4 sm:grid-cols-2">
            <Input label="Text" placeholder="Type here" hint="A helpful hint." />
            <Input label="With an error" error="This field is required." defaultValue="" />
            <Select label="Select"><option>One</option><option>Two</option></Select>
            <Textarea label="Message" />
            <Checkbox label="A checkbox" />
          </Card>
        </section>
        <section className="space-y-3"><h2 className="text-xl font-bold">Money</h2>
          <p><Money kobo={250000} /> · <Money kobo={5050} /> · <Money kobo={123456789} /></p></section>
        <section className="space-y-3"><h2 className="text-xl font-bold">Tabs and timeline</h2>
          <Tabs tabs={[{ id: 'a', label: 'Details', content: <p>First panel</p> }, { id: 'b', label: 'History', content: <p>Second panel</p> }]} />
          <Card><Timeline steps={[{ label: 'Order placed', state: 'done' }, { label: 'Being prepared', state: 'current', detail: 'About 15 minutes' }, { label: 'On the way', state: 'upcoming' }]} /></Card>
        </section>
        <section className="space-y-3"><h2 className="text-xl font-bold">States</h2>
          <LoadingState /><EmptyState title="Nothing here yet">Empty states explain what will appear.</EmptyState></section>
        <section className="space-y-3"><h2 className="text-xl font-bold">Order status vocabulary</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {ORDER_STATES.map((s) => (
              <li key={s.code}><Card className="p-3 sm:p-3"><div className="flex items-center justify-between gap-2"><OrderStatusPill code={s.code} /><span className="text-xs text-muted">{s.applies}</span></div><p className="mt-1 text-sm">{s.meaning}</p></Card></li>
            ))}
          </ul>
        </section>
      </main>
    </>
  )
}
