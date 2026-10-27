'use client'
import { ActionForm } from '@/components/forms/action-form'
import { Input, Textarea } from '@/components/ui/fields'
import { submitContactAction } from '@/server/modules/engagement/actions'

export function ContactForm() {
  return (
    <ActionForm action={submitContactAction} submitLabel="Send message" pendingLabel="Sending…">
      <Input label="Your name" name="name" autoComplete="name" required maxLength={80} />
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        hint="We reply to this address."
      />
      <Input label="Subject" name="subject" required maxLength={100} />
      <Textarea label="Message" name="message" required minLength={10} maxLength={2000} />
      {/* honeypot: hidden from people and screen readers; bots fill it */}
      <div aria-hidden="true" className="hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
    </ActionForm>
  )
}
