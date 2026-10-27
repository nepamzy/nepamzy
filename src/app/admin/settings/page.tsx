import type { Metadata } from 'next'
import { SettingForm } from '@/components/domain/engagement-forms'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EDITABLE_SETTINGS, listSettings } from '@/server/modules/engagement/queries'

export const metadata: Metadata = { title: 'Settings' }

export default async function Settings() {
  const rows = await listSettings()
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Settings' }]}
        title="Settings"
        subtitle="Fees, limits and policies. The vendor commission rates are owner-approved; other values (for example the delivery fee and refund limits) are still development placeholders awaiting owner decisions. The old customer platform fee is retired and fixed at 0. Every change is validated by the database and written to the audit trail."
      />
      <Alert tone="warning" title="Handle with care" className="mb-4">
        Settings change how the whole marketplace behaves. Each change is validated by the database
        and written to the audit log with your account.
      </Alert>
      <div className="space-y-3">
        {rows.map((r) => {
          const editable = (EDITABLE_SETTINGS as readonly string[]).includes(r.key)
          const shown = JSON.stringify(r.value)
          return (
            <Card key={r.key} className="space-y-2" role="group" aria-label={`Setting ${r.key}`}>
              <p className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono font-bold">{r.key}</span>
                <span className="break-all font-mono">{shown}</span>
                {!editable && <Badge>Not editable here</Badge>}
              </p>
              {r.note && <p className="text-sm text-muted">{r.note}</p>}
              {editable && <SettingForm settingKey={r.key} value={shown} />}
            </Card>
          )
        })}
      </div>
    </>
  )
}
