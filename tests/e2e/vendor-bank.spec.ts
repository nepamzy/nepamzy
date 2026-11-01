import { expect, test } from '@playwright/test'
import { makeShopWithPoint, openSession, tag } from './helpers'
import { sql } from './channel1-helpers'

test('a shop owner verifies a payout account: the bank gives the name in capitals, then it is locked until customer service unlocks it', async ({
  browser,
}, info) => {
  const owner = await openSession(browser, info, 'vb-owner', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.user.id, `Plate ${tag()}`)
  const p = owner.page
  await p.goto('/vendor/earnings')
  const card = p.getByTestId('payout-account')
  await expect(card).toContainText('Add the bank account')
  await card.getByLabel('Bank').selectOption({ label: 'Access Bank' })
  // an unknown account is refused with a clear message and no Verify button
  await card.getByLabel('Account number').fill('1234560000')
  await expect(card).toContainText('We could not find that account')
  await expect(card.getByRole('button', { name: 'Verify' })).toHaveCount(0)
  await card.getByLabel('Account number').fill('0123456789')
  await expect(p.getByTestId('resolved-name')).toContainText('ADA OBI TEST KITCHEN')
  await expect(card).toContainText('cannot be changed unless you contact customer service')
  await card.getByRole('button', { name: 'Verify' }).click()
  await expect(card.getByText('Verified', { exact: true })).toBeVisible()
  await expect(card).toContainText('******6789')
  await expect(card).not.toContainText('0123456789')

  // the number is encrypted at rest, and the owner cannot overwrite a verified account
  const rows = await sql(
    `select account_cipher, account_last4, account_name from public.vendor_bank_accounts where vendor_id = $1`,
    [shop.vendorId],
  )
  expect(rows.length).toBe(1)
  expect(String(rows[0]!.account_cipher)).toMatch(/^v1\./)
  expect(String(rows[0]!.account_cipher)).not.toContain('0123456789')
  expect(rows[0]!.account_name).toBe('ADA OBI TEST KITCHEN')

  // customer service unlock (administrator) puts the form back
  const adm = await openSession(browser, info, 'vb-admin', ['platform_admin'])
  await adm.page.goto('/admin/vendors')
  const row = adm.page.getByTestId('vendor-row').filter({ hasText: shop.slug })
  await row.locator('summary').click()
  await row.getByLabel('Reason (required)').last().fill('Owner changed bank')
  await row.getByRole('button', { name: 'Unlock payout account' }).click()
  await expect(row.getByText(/Unlocked/)).toBeVisible()
  await p.goto('/vendor/earnings')
  await expect(p.getByTestId('payout-account')).toContainText('Add the bank account')
  await owner.context.close()
  await adm.context.close()
})
