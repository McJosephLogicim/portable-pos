# PORTABLE POS

A mobile-first, installable register for small food and beverage businesses. The first visit opens a sample coffee counter priced in pesos. Its PIN is **1234** and its records stay in that browser. Sign in to create a separate live business with an empty menu, local currency, time zone, and owner PIN.

## Run locally

Use Node 22.12 or later and install packages with `npm ci`. Run `npm run dev` for development. Use `npm run build` followed by `npm start` to test the production PWA. The demo runs without credentials. The service worker requires HTTPS or localhost.

## Configure live registers

1. Create a Supabase project. Enable email/password sign-in, set the Auth Site URL and allowed redirect URLs to the app origin, and configure confirmation email delivery for public signups.
2. Set the variables in `.env.example` in the shell or deployment environment. Use a server-only `DATABASE_URL` for the register API and a separate, server-only `DATABASE_MIGRATION_URL` for schema changes. The migration role needs ownership of the application's schema objects and the Drizzle migration journal. Keep the `portable_pos` schema outside the Supabase Data API.
3. For a local database, run `npm run db:migrate`. For live registers, set the migration URL in the Vercel production environment. Vercel builds the app, applies pending Drizzle migrations, and releases the deployment only if both succeed. Git pushes to `main` trigger production deployments. Preview deployments without a database use the demo. If you configure live data in Preview, give it its own database and migration URL.

The migration command checks the existing journal against the checkout and runs pending SQL in one transaction. Use additive migrations that let the previous release continue serving traffic until Vercel switches over.

## At the counter

Open the shift while connected and use the same device throughout. Once the register shows **Offline register · Ready** in workspace details, the installed app can reopen offline. Checkout saves the receipt and pending record together. Reconnecting submits sales in sequence. Clearing browser storage or uninstalling before sync can erase pending receipts.

One payment method applies to each sale. A new register starts with cash, card and e-wallets (GCash and Maya for PHP), plus a Senior / PWD 20% discount for PHP. Owners can rename, add, switch off or remove methods and discounts in Settings, with the owner PIN. For anything other than cash, verify the payment in the seller's wallet or terminal before confirming. One discount applies per order. Settings saved on the till's own phone apply to the open shift at once; menu edits apply from the next shift. Reversal records the correction in the open shift. The seller returns funds separately. Opening and closing cash use the business currency and the amounts in the drawer.

## Verification

`npm test` exercises local persistence, retry behavior, and the API authentication boundary. For the integration suite, migrate a disposable PostgreSQL database and set `POS_TEST_DATABASE_URL` before running the same command. Optional `POS_TEST_AUTH_URL` and `POS_TEST_AUTH_KEY` enable the real Supabase Auth tests against an isolated instance configured to confirm test accounts automatically.

The shared TypeScript domain code calculates prices, option selections, cash change, and drawer totals. Drizzle owns persistence and migrations. IndexedDB holds the device's cart, receipts, and ordered sync queue.
