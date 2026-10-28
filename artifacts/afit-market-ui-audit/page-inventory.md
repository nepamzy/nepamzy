# Page inventory (Frontend redesign: master channel 1)

Built from `artifacts/afit-market-ui-audit/{redesign-before,redesign-m1-after}/{desktop,mobile}/inventory.json`: what was actually rendered. Routes with ids are shown with `[id]`. "yes" means a screenshot file exists.

| Role | Route | State | HTTP | Desk before | Desk after | Mob before | Mob after | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| public | `/about` | about | 200 | NO | yes | NO | yes |  |
| public | `/admin` | anonymous-redirected-to-login | 200 | yes | yes | yes | yes |  redirected to /login?next=%2Fadmin |
| public | `/cart` | anonymous-cart | 200 | yes | yes | yes | yes |  redirected to /login?next=%2Fcart |
| public | `/contact` | contact | 200 | NO | yes | NO | yes |  |
| public | `/delivery` | delivery | 200 | NO | yes | NO | yes |  |
| public | `/design` | design-system-page | 200 | yes | yes | yes | yes | internal design reference page |
| public | `/faq` | faq | 200 | NO | yes | NO | yes |  |
| public | `/` | landing | 200 | yes | yes | yes | yes |  |
| public | `/` | signed-in-no-factor-home |  | yes | yes | yes | yes | a customer without a factor can browse after sign-in (K15) |
| public | `/login` | empty-form | 200 | yes | yes | yes | yes |  |
| public | `/login` | wrong-password-error |  | yes | yes | yes | yes |  |
| public | `/mfa/challenge` | challenge |  | yes | yes | yes | yes |  |
| public | `/mfa/challenge` | wrong-code-error |  | yes | yes | yes | yes |  |
| public | `/mfa/enroll` | enrol-first-factor | 200 | yes | yes | yes | yes |  |
| public | `/offline` | offline-fallback | 200 | yes | yes | yes | yes |  |
| public | `/orders` | anonymous-redirected-to-login | 200 | yes | yes | yes | yes |  redirected to /login?next=%2Forders |
| public | `/payments` | payments | 200 | NO | yes | NO | yes |  |
| public | `/privacy` | privacy | 200 | NO | yes | NO | yes |  |
| public | `/products` | items-browse | 200 | NO | yes | NO | yes |  |
| public | `/products/[id]` | product-detail | 200 | yes | yes | yes | yes |  |
| public | `/products?q=zzzz-no-such-item` | items-no-results | 200 | NO | yes | NO | yes |  |
| public | `/products?sort=price_asc&q=Fixture` | items-sorted-search | 200 | NO | yes | NO | yes |  |
| public | `/receipts/[token]` | public-receipt-check | 200 | yes | yes | yes | yes |  |
| public | `/receipts/[token]` | public-receipt-not-found | 200 | yes | yes | yes | yes |  |
| public | `/refunds` | refunds | 200 | NO | yes | NO | yes |  |
| public | `/signup` | empty-form | 200 | yes | yes | yes | yes |  |
| public | `/signup` | validation-error |  | yes | yes | yes | yes |  |
| public | `/terms` | terms | 200 | NO | yes | NO | yes |  |
| public | `/vendors` | list | 200 | yes | yes | yes | yes |  |
| public | `/vendors/no-such-shop` | not-found-404 | 404 | yes | yes | yes | yes |  |
| public | `/vendors?q=Fixture` | search-results | 200 | yes | yes | yes | yes |  |
| public | `/vendors?q=zzzz-no-such-item` | search-no-results | 200 | yes | yes | yes | yes |  |
| public | `/vendors/[shop]` | vendor-menu | 200 | yes | yes | yes | yes |  |
| customer | `/account` | account | 200 | yes | yes | yes | yes |  |
| customer | `/account/addresses` | saved-places | 200 | NO | yes | NO | yes |  |
| customer | `/account/data-requests` | data-requests | 200 | yes | yes | yes | yes |  |
| customer | `/account/profile` | profile | 200 | NO | yes | NO | yes |  |
| customer | `/account/receipts` | receipt-list | 200 | yes | yes | yes | yes |  |
| customer | `/account/security` | account-security-mfa | 200 | yes | yes | yes | yes |  |
| customer | `/account/wishlist` | wishlist | 200 | NO | yes | NO | yes |  |
| customer | `/admin` | forbidden-for-customer | 403 | yes | yes | yes | yes |  |
| customer | `/admin/settings` | forbidden-for-customer | 403 | yes | yes | yes | yes |  |
| customer | `/apply` | vendor-application-form | 200 | yes | yes | yes | yes |  |
| customer | `/cart` | cart-empty | 200 | yes | yes | yes | yes |  |
| customer | `/cart` | empty-cart | 200 | yes | yes | yes | yes |  |
| customer | `/cart` | populated-cart | 200 | yes | yes | yes | yes |  |
| customer | `/cases` | reports-empty | 200 | yes | yes | yes | yes |  |
| customer | `/cases` | reports-list | 200 | yes | yes | yes | yes |  |
| customer | `/cases/[id]` | report-detail | 200 | yes | yes | yes | yes |  |
| customer | `/checkout` | checkout-form | 200 | yes | yes | yes | yes |  |
| customer | `/notifications` | notifications-empty | 200 | yes | yes | yes | yes |  |
| customer | `/notifications` | notifications-with-unread | 200 | yes | yes | yes | yes |  |
| customer | `/orders` | order-history | 200 | yes | yes | yes | yes |  |
| customer | `/orders` | orders-empty | 200 | yes | yes | yes | yes |  |
| customer | `/orders/[id]` | completed-order-with-review-form | 200 | yes | yes | yes | yes |  |
| customer | `/orders/[id]` | delivery-en-route-no-location-yet | 200 | yes | yes | yes | yes |  |
| customer | `/orders/[id]` | order-with-delivery-fee-notice | 200 | yes | yes | yes | yes |  |
| customer | `/orders/[id]` | paid-order-waiting-for-shop | 200 | yes | yes | yes | yes |  |
| customer | `/orders/[id]` | review-published |  | yes | yes | yes | yes |  |
| customer | `/orders/[id]` | rider-arrived-confirm-receipt | 200 | yes | yes | yes | yes |  |
| customer | `/orders/[id]` | signature-capture-empty |  | yes | yes | yes | yes |  |
| customer | `/orders/[id]` | signature-missing-error |  | yes | yes | yes | yes |  |
| customer | `/orders/[id]/delivery-fee` | disputed-customer-view | 200 | yes | yes | yes | yes |  |
| customer | `/orders/[id]/delivery-fee` | pay-delivery-fee-details |  | yes | yes | yes | yes |  |
| customer | `/orders/[id]/delivery-fee` | pay-delivery-fee-start | 200 | yes | yes | yes | yes |  |
| customer | `/orders/[id]/delivery-fee` | transfer-reported-waiting |  | yes | yes | yes | yes |  |
| customer | `/orders/[id]/help` | help-refund-and-report-forms | 200 | yes | yes | yes | yes |  |
| customer | `/orders/[id]/help` | refund-requested |  | yes | yes | yes | yes |  |
| customer | `/orders/[id]/help` | report-opened |  | yes | yes | yes | yes |  |
| customer | `/products/[id]` | after-add-to-cart |  | yes | yes | yes | yes |  redirected to /cart |
| customer | `/products/[id]` | product-detail-signed-in | 200 | yes | yes | yes | yes |  |
| customer | `/rider` | forbidden-for-customer | 403 | yes | yes | yes | yes |  |
| customer | `/rider-apply` | rider-application-form | 200 | yes | yes | yes | yes |  |
| customer | `/vendor` | forbidden-for-customer | 403 | yes | yes | yes | yes |  |
| vendor | `/account` | account | 200 | yes | yes | yes | yes |  |
| vendor | `/notifications` | notifications | 200 | yes | yes | yes | yes |  |
| vendor | `/vendor` | dashboard | 200 | yes | yes | yes | yes |  |
| vendor | `/vendor` | forbidden-for-non-vendor | 403 | yes | yes | yes | yes |  |
| vendor | `/vendor/catalogue` | catalogue | 200 | yes | yes | yes | yes |  |
| vendor | `/vendor/catalogue/[id]` | edit-product | 200 | yes | yes | yes | yes |  |
| vendor | `/vendor/catalogue/new` | new-product-form | 200 | yes | yes | yes | yes |  |
| vendor | `/vendor/earnings` | earnings | 200 | yes | yes | yes | yes |  |
| vendor | `/vendor/handover` | pickup-handover | 200 | yes | yes | yes | yes |  |
| vendor | `/vendor/menu` | more-menu | 200 | yes | yes | yes | yes |  |
| vendor | `/vendor/orders` | incoming-orders | 200 | yes | yes | yes | yes |  |
| vendor | `/vendor/profile` | shop-profile-and-hours | 200 | yes | yes | yes | yes |  |
| vendor | `/vendor/returns` | returns | 200 | yes | yes | yes | yes |  |
| rider | `/notifications` | notifications | 200 | yes | yes | yes | yes |  |
| rider | `/rider` | dashboard-active-shift | 200 | yes | yes | yes | yes |  |
| rider | `/rider` | dashboard-inactive | 200 | yes | yes | yes | yes |  |
| rider | `/rider/jobs` | jobs-inactive-no-offers | 200 | yes | yes | yes | yes |  |
| rider | `/rider/jobs` | jobs-with-arrived-delivery | 200 | yes | yes | yes | yes |  |
| rider | `/rider/payments` | bank-details-saved |  | yes | yes | yes | yes |  |
| rider | `/rider/payments` | confirmed-with-receipt |  | yes | yes | yes | yes |  |
| rider | `/rider/payments` | customer-reported-awaiting-confirmation | 200 | yes | yes | yes | yes |  |
| rider | `/rider/payments` | disputed |  | yes | yes | yes | yes |  |
| rider | `/rider/payments` | no-bank-details-yet | 200 | yes | yes | yes | yes |  |
| rider | `/rider/profile` | profile | 200 | yes | yes | yes | yes |  |
| admin | `/admin` | finance-admin-overview | 200 | yes | yes | yes | yes |  |
| admin | `/admin` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin` | support-agent-overview | 200 | yes | yes | yes | yes |  |
| admin | `/admin/applications` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/audit` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/cases` | forbidden-for-finance | 403 | yes | yes | yes | yes |  |
| admin | `/admin/cases` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/cases` | support-agent-cases | 200 | yes | yes | yes | yes |  |
| admin | `/admin/cases/[id]` | case-detail | 200 | yes | yes | yes | yes |  |
| admin | `/admin/categories` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/data-requests` | data-requests | 200 | yes | yes | yes | yes |  |
| admin | `/admin/delivery-fee-payments` | dispute-awaiting-decision | 200 | yes | yes | yes | yes |  |
| admin | `/admin/delivery-fee-payments` | finance-admin-view | 200 | yes | yes | yes | yes |  |
| admin | `/admin/delivery-points` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/jobs` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/menu` | more-menu | 200 | yes | yes | yes | yes |  |
| admin | `/admin/messages` | platform-admin | 200 | NO | yes | NO | yes |  |
| admin | `/admin/orders` | platform-admin | 200 | NO | yes | NO | yes |  |
| admin | `/admin/orders/[id]` | order-detail | 200 | NO | yes | NO | yes |  |
| admin | `/admin/payments` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/products` | platform-admin | 200 | NO | yes | NO | yes |  |
| admin | `/admin/refunds` | finance-admin-refunds | 200 | yes | yes | yes | yes |  |
| admin | `/admin/refunds` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/refunds?status=requested&q=AFM` | refunds-filtered | 200 | yes | yes | yes | yes |  |
| admin | `/admin/reports` | platform-admin | 200 | NO | yes | NO | yes |  |
| admin | `/admin/returns` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/reviews` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/rider-issues` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/riders` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/roles` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/settings` | forbidden-for-support | 403 | yes | yes | yes | yes |  |
| admin | `/admin/settings` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/admin/settlements` | settlements | 200 | yes | yes | yes | yes |  |
| admin | `/admin/users` | platform-admin | 200 | NO | yes | NO | yes |  |
| admin | `/admin/users/[id]` | user-detail | 200 | NO | yes | NO | yes |  |
| admin | `/admin/users?q=au-` | users-filtered | 200 | NO | yes | NO | yes |  |
| admin | `/admin/vendors` | platform-admin | 200 | yes | yes | yes | yes |  |
| admin | `/notifications` | notifications | 200 | yes | yes | yes | yes |  |

Total pages/states: 136. Missing in at least one of the four captures: 22 (public/about__about.png, public/contact__contact.png, public/delivery__delivery.png, public/faq__faq.png, public/payments__payments.png, public/privacy__privacy.png, public/products__items-browse.png, public/products-q-zzzz-no-such-item__items-no-results.png, public/products-sort-price-asc-q-Fixture__items-sorted-search.png, public/refunds__refunds.png, public/terms__terms.png, customer/account-addresses__saved-places.png, customer/account-profile__profile.png, customer/account-wishlist__wishlist.png, admin/admin-messages__platform-admin.png, admin/admin-orders__platform-admin.png, admin/admin-orders-ID__order-detail.png, admin/admin-products__platform-admin.png, admin/admin-reports__platform-admin.png, admin/admin-users__platform-admin.png, admin/admin-users-ID__user-detail.png, admin/admin-users-q-au__users-filtered.png).

Screenshot counts, before (redesign-before): desktop: 114, mobile: 114. After (redesign-m1-after): desktop: 136, mobile: 136.

By role (both viewports): before/public=44, before/customer=76, before/vendor=26, before/rider=22, before/admin=60, after/public=66, after/customer=82, after/vendor=26, after/rider=22, after/admin=76.
