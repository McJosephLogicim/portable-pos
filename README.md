# PORTABLE POS

A mobile-first, installable register for small food and beverage businesses. The first visit opens a sample coffee counter. Its PIN is **1234** and its records stay in that browser. Sign in to create a separate live business with an empty menu, local currency, time zone, and owner PIN.

## Run locally

Use Node 22.12 or later and install packages with `npm ci`. Run `npm run dev` for development. Use `npm run build` followed by `npm start` to test the production PWA. The demo runs without credentials. The service worker requires HTTPS or localhost.

## Configure live registers

1. Create a Supabase project. Enable email/password sign-in, set the Auth Site URL and allowed redirect URLs to the app origin, and configure confirmation email delivery for public signups.
2. Set the variables in `.env.example` in the shell or deployment environment. The client uses the project URL and publishable key. The Node.js API uses `DATABASE_URL` with the Supabase transaction pooler. Keep it server-only. For migrations, `DATABASE_MIGRATION_URL` can point to a direct or session connection.
3. Apply the checked-in Drizzle migration with `npm run db:migrate` using an exported migration connection. Use a server role that can access the private `portable_pos` schema. Keep that schema outside the Supabase Data API.
4. Set the same production variables in Vercel and redeploy. Next.js embeds public client configuration at build time. Open the production URL, create an account, add an item, and open a shift.

## At the counter

Open the shift while connected and use the same device throughout. Once the register shows **Offline register · Ready** in workspace details, the installed app can reopen offline. Checkout saves the receipt and pending record together. Reconnecting submits sales in sequence. Clearing browser storage or uninstalling before sync can erase pending receipts.

One tender applies to each sale. For QR or card, verify payment on the seller's existing wallet or terminal. Reversal records the correction in the open shift. The seller returns funds separately. Opening and closing cash use the business currency and the amounts in the drawer.

## Verification

`npm test` exercises local persistence, retry behavior, and the API authentication boundary. For the integration suite, migrate a disposable PostgreSQL database and set `POS_TEST_DATABASE_URL` before running the same command. Optional `POS_TEST_AUTH_URL` and `POS_TEST_AUTH_KEY` enable the real Supabase Auth tests against an isolated instance configured to confirm test accounts automatically.

The shared TypeScript domain code calculates prices, option selections, cash change, and drawer totals. Drizzle owns persistence and migrations. IndexedDB holds the device's cart, receipts, and ordered sync queue.
