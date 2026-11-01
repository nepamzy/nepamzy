import 'server-only'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { decryptField, encryptField } from '@/server/security/field-crypto'
import { parseSignature } from '@/server/modules/orders-and-state-machine/signature'
import { signaturesMatch } from './signature-match'

/**
 * What people tell us about themselves when they sign up: the signature they sign deliveries with, the kind of customer
 * they are and, for students, the student ID number and a photo of the ID card. None of it is checked automatically.
 * These tables are closed to every API role, so everything here goes through the server's service client.
 */
export type PersonType = 'student' | 'military' | 'lecturer' | 'other'
export const PERSON_TYPES: PersonType[] = ['student', 'military', 'lecturer', 'other']

const ID_CARD_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/
const MAX_ID_CARD_BYTES = 700_000
const STUDENT_ID = /^[A-Za-z0-9][A-Za-z0-9 /._-]{2,39}$/

export const toHex = (b: Buffer) => '\\x' + b.toString('hex')
const fromHex = (v: unknown): Buffer | null =>
  typeof v === 'string' && v.startsWith('\\x') ? Buffer.from(v.slice(2), 'hex') : null

export type IdCardCheck = { ok: true; jpeg: Buffer } | { ok: false }
export function parseIdCard(dataUrl: string): IdCardCheck {
  if (!dataUrl || dataUrl.length > Math.ceil((MAX_ID_CARD_BYTES * 4) / 3) + 64) return { ok: false }
  const m = ID_CARD_URL.exec(dataUrl)
  if (!m) return { ok: false }
  const jpeg = Buffer.from(m[1]!, 'base64')
  // JPEG files start FF D8 FF
  if (jpeg.length < 2000 || jpeg.length > MAX_ID_CARD_BYTES) return { ok: false }
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) return { ok: false }
  return { ok: true, jpeg }
}

export const validStudentId = (v: string) => STUDENT_ID.test(v.trim())

/** Saves the signature chosen at sign-up. Once saved it is not replaced here (support can reset it). */
export async function saveSignature(userId: string, dataUrl: string): Promise<boolean> {
  const sig = parseSignature(dataUrl)
  if (!sig.ok) return false
  const { error } = await createSupabaseServiceClient()
    .from('user_signatures')
    .upsert({ user_id: userId, png: sig.hex }, { onConflict: 'user_id', ignoreDuplicates: true })
  return !error
}

export async function savedSignature(userId: string): Promise<Buffer | null> {
  const { data } = await createSupabaseServiceClient()
    .from('user_signatures')
    .select('png')
    .eq('user_id', userId)
    .maybeSingle()
  return fromHex(data?.png)
}

export async function hasSignature(userId: string): Promise<boolean> {
  const { count } = await createSupabaseServiceClient()
    .from('user_signatures')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId)
  return (count ?? 0) > 0
}

export async function saveIdentity(
  userId: string,
  a: { personType: PersonType; studentId?: string; idCard?: Buffer },
): Promise<boolean> {
  const row: Record<string, string | null> = {
    user_id: userId,
    person_type: a.personType,
    student_id_cipher: null,
    id_card_jpeg: null,
  }
  if (a.personType === 'student') {
    row.student_id_cipher = encryptField(a.studentId!.trim().toUpperCase())
    row.id_card_jpeg = toHex(a.idCard!)
  }
  const { error } = await createSupabaseServiceClient()
    .from('account_identity')
    .upsert(row, { onConflict: 'user_id' })
  return !error
}

/** What an administrator may see about a person. The ID number is decrypted only here, for this call. */
export async function identityForAdmin(userId: string) {
  const { data } = await createSupabaseServiceClient()
    .from('account_identity')
    .select('person_type, student_id_cipher, created_at, id_card_jpeg')
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return null
  let studentId: string | null = null
  try {
    studentId = data.student_id_cipher ? decryptField(data.student_id_cipher) : null
  } catch {
    studentId = null
  }
  return {
    personType: data.person_type as PersonType,
    studentId,
    hasIdCard: Boolean(data.id_card_jpeg),
    createdAt: data.created_at as string,
  }
}

export async function idCardForAdmin(userId: string): Promise<Buffer | null> {
  const { data } = await createSupabaseServiceClient()
    .from('account_identity')
    .select('id_card_jpeg')
    .eq('user_id', userId)
    .maybeSingle()
  return fromHex(data?.id_card_jpeg)
}

export const SIGNATURE_MISMATCH =
  'This signature does not look like the one you saved when you made your account. Please sign again, the way you normally do.'

/**
 * Compares a signature drawn now with the one the person saved at sign-up. Accounts without a saved signature (made
 * before this existed) are not blocked; they are asked to save one the next time they sign in.
 * Returns an error message, or null when the signature may go ahead.
 */
export async function signatureProblem(userId: string, nowPng: Buffer): Promise<string | null> {
  const saved = await savedSignature(userId)
  if (!saved) return null
  const r = signaturesMatch(saved, nowPng)
  if (r.ok) return null
  return r.reason === 'unreadable'
    ? 'The signature looks empty. Please sign again.'
    : SIGNATURE_MISMATCH
}
