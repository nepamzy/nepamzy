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
  already_a_rider: 'This account is already a rider.',
  rider_not_approved: 'Your rider account is not approved.',
  terms_not_acknowledged: 'Please read and accept the rider terms first.',
  terms_not_approved:
    'The rider terms are still awaiting approval, so deliveries cannot start yet. Please check back later.',
  terms_version_mismatch: 'The rider terms changed. Reload the page and read the latest version.',
  not_active: 'Go Active first.',
  capacity_reached: 'You already have five active deliveries. Finish one first.',
  order_unavailable: 'That delivery is no longer available.',
  active_deliveries_in_progress:
    'You are carrying a parcel. Finish the delivery, or ask support for help, before going inactive.',
  token_not_needed: 'A handover code is only needed before the vendor hands over the parcel.',
  tracking_not_active: 'Location sharing is only on during an active shift with a delivery.',
  invalid_reason: 'Choose one of the listed reasons.',
  invalid_transition: 'That step is not possible for this delivery right now.',
  assignment_not_releasable: 'That delivery can no longer be released.',
  note_required: 'Please add a short note.',
  reason_required: 'Please give a short reason.',
  purpose_required: 'Please describe why you need this (at least 10 characters).',
  order_not_refundable: 'This order is not in a state where a refund or report can be started yet.',
  order_not_returnable: 'This order cannot be returned right now.',
  nothing_to_refund: 'There is nothing left to refund on this order.',
  refund_exceeds_received: 'That is more than the amount that can still be refunded on this order.',
  refund_invalid_item: 'One of the chosen items is not valid for this order.',
  refund_quantity_exceeds_purchased:
    'You chose more of an item than you bought (or already asked for).',
  refund_invalid_transition: 'That step is not possible for this refund any more.',
  provider_not_enabled: 'Refund execution is not available.',
  provider_reference_required: 'A provider reference is needed to record a successful refund.',
  return_invalid_item: 'One of the chosen items is not valid for this order.',
  return_quantity_exceeds_purchased:
    'You chose more of an item than you bought (or already asked to return).',
  return_invalid_transition: 'That step is not possible for this return any more.',
  return_not_permitted: 'Items from this kind of shop cannot be returned under the current rules.',
  description_required: 'Please describe what went wrong in at least 10 characters.',
  statement_required: 'Please write at least a few words.',
  case_already_open: 'You already have an open report of this type for this order.',
  case_closed: 'This report is closed.',
  case_invalid_transition: 'That step is not possible for this report any more.',
  too_many_cases: 'You have sent many reports today. Please wait before sending another.',
  too_many_statements: 'You have added the maximum number of statements to this report.',
  idempotency_conflict: 'That request key was already used for a different order.',
  'cannot decide your own request': 'You cannot decide a request you made yourself.',
  'cannot review your own request': 'You cannot review a request you made yourself.',
  'cannot decide your own case': 'You cannot decide a report you opened yourself.',
  'cannot review your own case': 'You cannot review a report you opened yourself.',
  'cannot execute your own request': 'You cannot execute a refund you requested yourself.',
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
