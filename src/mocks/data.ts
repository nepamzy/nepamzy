// SAMPLE DATA for design review only. All names, prices and codes are fictional placeholders.
export const MOCK_VENDORS = [
  { id: 'v1', name: 'Sample Kitchen', category: 'Food', open: true, eta: '15-25 min', rating: 4.6,
    products: [
      { id: 'p1', name: 'Jollof rice and chicken', priceKobo: 250000, available: true },
      { id: 'p2', name: 'Fried plantain', priceKobo: 80000, available: true },
      { id: 'p3', name: 'Bottled water', priceKobo: 30000, available: false },
    ] },
  { id: 'v2', name: 'Sample Print Shop', category: 'Printing', open: true, eta: '30-45 min', rating: 4.3,
    products: [
      { id: 'p4', name: 'Print A4 (per page)', priceKobo: 5000, available: true },
      { id: 'p5', name: 'Spiral binding', priceKobo: 100000, available: true },
    ] },
  { id: 'v3', name: 'Sample Souvenirs', category: 'Souvenirs', open: false, eta: 'Closed', rating: 4.8,
    products: [{ id: 'p6', name: 'Branded notebook', priceKobo: 180000, available: true }] },
]
export const MOCK_ORDERS = [
  { id: 'AFM-1001', vendor: 'Sample Kitchen', status: 'EN_ROUTE', totalKobo: 330000, mode: 'Delivery' },
  { id: 'AFM-0998', vendor: 'Sample Print Shop', status: 'PICKUP_AWAITING_HANDOVER', totalKobo: 105000, mode: 'Pickup' },
  { id: 'AFM-0990', vendor: 'Sample Kitchen', status: 'COMPLETED', totalKobo: 250000, mode: 'Delivery' },
]
export const MOCK_APPLICATIONS = [
  { id: 'app1', name: 'Sample Bakery', type: 'Vendor', submitted: 'Sample date 1', status: 'Pending review' },
  { id: 'app2', name: 'Sample Rider A', type: 'Rider', submitted: 'Sample date 2', status: 'Pending review' },
]
export const MOCK_AUDIT = [
  { at: 'Sample time 1', who: 'sample-admin', action: 'role.granted', entity: 'sample-user' },
  { at: 'Sample time 2', who: 'system', action: 'account.created', entity: 'sample-user' },
]
