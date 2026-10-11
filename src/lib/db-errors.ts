/** Maps database function errors to short, plain-language messages. Never leaks SQL text. */
export type DbError =
  { message?: string; details?: string | null; code?: string } | null | undefined

const MESSAGES: Record<string, string> = {
  'authentication required': 'Please sign in to continue.',
  'MFA (aal2) required': 'Please confirm your authenticator code to continue.',
  forbidden: 'You are not allowed to do this.',
  'vendor is not active': 'This vendor account is not active.',
  invalid_quantity: 'Choose a quantity between 1 and the allowed maximum.',
  product_unavailable: 'That item is not available right now.',
  invalid_option: 'One of the choices is not valid for this item.',
  option_unavailable: 'One of the choices is sold out.',
  option_selection_invalid: 'Please choose the required options for this item.',
  cart_full: 'Your cart is full. Remove something first.',
  cart_empty: 'Your cart is empty.',
  invalid_fulfilment: 'Choose pickup or delivery.',
  order_not_payable: 'This order can no longer be paid.',
  order_not_cancellable: 'This order can no longer be cancelled.',
  mock_payments_disabled: 'Test payments are switched off.',
  application_pending: 'You already have an application waiting for review.',
  already_a_vendor: 'This account already belongs to a vendor.',
  terms_not_accepted: 'Please accept the vendor terms to continue.',
  unknown_category: 'Choose a category.',
  'a reason is required': 'Please give a short reason (at least 5 characters).',
  'overlapping intervals': 'Opening times overlap. Check each day.',
  'invalid interval': 'Opening times are not valid. Closing must be after opening.',
  'too many intervals': 'Too many opening time ranges.',
  'already decided': 'This application has already been decided.',
  'cannot decide your own application': 'You cannot decide your own application.',
}

const CHECKOUT_PROBLEMS: Record<string, string> = {
  vendor_unavailable: 'This vendor is not taking orders.',
  vendor_closed: 'This vendor is closed right now.',
  unavailable: 'An item in your cart is no longer available.',
  out_of_stock: 'An item in your cart has run out of stock.',
  invalid_quantity: 'A quantity in your cart is not allowed.',
  invalid_option: 'A choice in your cart is no longer valid.',
  option_unavailable: 'A choice in your cart is sold out.',
  option_selection_invalid: 'An item in your cart needs its required options.',
  delivery_point_invalid: 'Choose a delivery point.',
  vendor_mismatch: 'Your cart mixes vendors. Remove items from one of them.',
}

export function friendlyDbError(
  error: DbError,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (!error) return fallback
  const msg = (error.message ?? '').trim()
  if (msg === 'checkout_blocked')
    return describeProblems(parseProblems(error.details))[0] ?? fallback
  for (const [k, v] of Object.entries(MESSAGES)) if (msg === k || msg.startsWith(k)) return v
  if (error.code === '23514') return 'Some details are not valid. Please check the form.'
  if (error.code === '23505') return 'That already exists.'
  return fallback
}

export type CheckoutProblem = { code: string; item_id?: string; product_id?: string }
export function parseProblems(details: string | null | undefined): CheckoutProblem[] {
  if (!details) return []
  try {
    const v = JSON.parse(details)
    return Array.isArray(v)
      ? v.filter((p): p is CheckoutProblem => typeof p?.code === 'string')
      : []
  } catch {
    return []
  }
}
export function describeProblems(problems: CheckoutProblem[]): string[] {
  return [
    ...new Set(
      problems.map((p) => CHECKOUT_PROBLEMS[p.code] ?? 'Something in your order needs attention.'),
    ),
  ]
}
