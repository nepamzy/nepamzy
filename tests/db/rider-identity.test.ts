import { afterAll, describe, expect, it } from 'vitest'
import { createUser, pool } from './helpers'
import { isoTx } from './rider-helpers'

afterAll(async () => {
  await pool.end()
})

describe('rider sign-up ID details', () => {
  it('are closed to every API role, and a record without the QR check is refused', async () => {
    await isoTx(async (c) => {
      const u = await createUser(c, 'riderid')
      for (const role of ['authenticated', 'anon'])
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          const r = await c.query(
            `select has_table_privilege($1, 'public.rider_identity', $2) as ok`,
            [role, priv],
          )
          expect(r.rows[0].ok, `${role} ${priv}`).toBe(false)
        }
      const bytes = `decode(repeat('ab', 3000), 'hex')`
      // a complete record with the QR check passed is accepted ...
      await c.query(
        `insert into public.rider_identity (user_id, matric_cipher, phone_cipher, id_front_jpeg, id_back_jpeg, qr_found)
         values ($1, 'x', 'y', ${bytes}, ${bytes}, true)`,
        [u],
      )
      // ... but one where no QR code was found is not
      const u2 = await createUser(c, 'riderid2')
      await expect(
        c.query(
          `insert into public.rider_identity (user_id, matric_cipher, phone_cipher, id_front_jpeg, id_back_jpeg, qr_found)
           values ($1, 'x', 'y', ${bytes}, ${bytes}, false)`,
          [u2],
        ),
      ).rejects.toThrow()
    })
  })
})
