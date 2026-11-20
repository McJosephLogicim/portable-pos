# PORTABLE POS

A mobile-first, installable register for small food and beverage businesses. Sign in to open your register or create a business. **Try the demo** opens a sample coffee counter priced in pesos. Its PIN is **1234** and its records stay in that browser.

## Run locally

Use Node 22.12 or later and install packages with `npm ci`. Run `npm run dev` for development. Use `npm run build` followed by `npm start` to test the production PWA. The demo runs without credentials. The service worker requires HTTPS or localhost.

## Configure live registers

1. Create a Supabase project. Enable email/password sign-in, set the Auth Site URL and allowed redirect URLs to the app origin, and configure confirmation email delivery for public signups.
2. Set the variables in `.env.example` in the shell or deployment environment. Use a server-only `DATABASE_URL` for the register API and a separate, server-only `DATABASE_MIGRATION_URL` for schema changes. The migration role needs ownership of the application's schema objects and the Drizzle migration journal. Keep the `portable_pos` schema outside the Supabase Data API.
3. For a local database, run `npm run db:migrate`. For live registers, set the migration URL in the Vercel production environment. Vercel builds the app, applies pending Drizzle migrations, and releases the deployment only if both succeed. Git pushes to `main` trigger production deployments. Preview deployments without a database use the demo. If you configure live data in Preview, give it its own database and migration URL.
4. For team invitation emails, set the server-only `RESEND_API_KEY`, `POS_INVITE_FROM` to an address on a verified [Resend sending domain](https://resend.com/docs/dashboard/domains/introduction), and `POS_APP_URL` to the public HTTPS app origin. Owners can share a pending invitation link in Settings › Team if email delivery is unavailable.

The migration command checks the existing journal against the checkout and runs pending SQL in one transaction. Use additive migrations that let the previous release continue serving traffic until Vercel switches over.

## At the counter

Open the shift while connected and use the same device throughout. Once the register shows **Offline register · Ready** in workspace details, the installed app can reopen offline. Checkout saves the receipt and pending record together. Reconnecting submits sales in sequence. Clearing browser storage or uninstalling before sync can erase pending receipts.

One payment method applies to each sale. A new register starts with cash, card and e-wallets (GCash and Maya for PHP), plus a Senior / PWD 20% discount for PHP. Owners can rename, add, switch off or remove methods and discounts in Settings, with the owner PIN. For anything other than cash, verify the payment in the seller's wallet or terminal before confirming. One discount applies per order. Checkout settings saved on the till's own phone apply to the open shift at once. Reversal records the correction in the open shift. The seller returns funds separately. Opening and closing cash use the business currency and the amounts in the drawer.

The owner turns **Advanced mode** on or off in Settings › Register setup. Before it changes, a sheet lists what appears or goes out of sight. Simple keeps checkout, receipts, menu items and choices, till operations, shift scheduling, checklists, organizers, branding and sales charts. Advanced adds ingredient and prep setup and recipe costing. Switching modes preserves the menu, costing, schedules and sales history. Registers without a saved mode use Advanced.

## Opening, running and closing a shift

In both modes, select a scheduled shift before opening the till. You can open up to 30 minutes before the scheduled start. The top of Sell and Till shows which shift the till is selling for.

Opening asks for the cash float, counted by coin and bill (for example ₱5 × 15) or typed as a total, a count of every stock item, and the opening checklist. During the shift, anyone on the till logs expenses from the Till page: paid with cash from the till, which lowers the cash expected in the drawer, or out of their own pocket, which the report lists as owed back to them. Closing asks for the cash on hand, again by coin and bill or as a total, and what is left of each stock item. The server checks that coin counts add up to the amount sent.

After closing, the shift report opens: sales by payment method, what sold, stock with start, used, left and the gap from expected, expenses, the cash reconciliation, and who to pay back. **Share** shares a PNG made on the phone. If file sharing is unavailable, use **Save**. **Copy** copies a plain version for a group chat. Past shifts on the Till page open the same report, and **Report so far** shows it before closing.

The Shifts page's share button previews the schedule grouped by place and event. Each line shows the date, who works the shift, and a link to that shift. Use **Copy** to paste the preview into a chat. A shared schedule or shift opens after sign-in or email confirmation for teammates with access. Before sign-in, a shift link shows the business's name and branding, the date, hours, place, event and open seats (from `/api/links/shift/<code>`). It never shows pay, rent, quotas or who is on the shift. Team-only links are short enough to guess, so they show no preview. To invite someone new to the team, send them a business invitation from Settings › Team.

## Menu and stock

The owner adds items from the **Add** tile at the end of the Sell grid, or in Recipes › Menu items. New items and edits to names, prices and options appear on the open till and on other phones when they sync. Finish or clear a current order before changing its prices or selections on the same phone. Receipts made before the update sync with the menu version they used. Item removals and stock use changes take effect from the next shift.

Recipes › Stock items lists what is counted at opening and closing, like a strawberry pack, a kilo of ice or a litre of milk, each with a unit (piece, pack, box, bottle, cup, tray, kg, g, L or mL). A menu item's **Uses stock** section picks the stock items one sale uses and how much, like 1 pack and 0.2 kg. Each sale takes that off what is left, a reversal puts it back, the Sell tile shows how many more can be made, and an item sells out when any stock it uses runs out, offline too. Menu items set up before stock items existed with **Count this item itself** still work as a stock item of their own.

Recipes › Stock items lists what you buy; Recipes › Prep lists what you make ahead in batches. A prep item's cost uses its purchased ingredients, how much one batch makes, and any other batch cost. To add a recipe to a stock item that the menu already uses, open that item in Stock items and choose **Make it** under How you get it; it then moves to Prep. Menu costing picks up the result whenever an ingredient price or batch yield changes. The till counts the finished prep as its own stock item.

In a menu item's **Stock** section, turn on **Made in batches** to enter ingredient quantities for the whole batch and its serving yield. With **Uses stock** and **Deduct batch ingredients per sale** on, each sale deducts the batch ingredients divided by the yield. Turn off that deduction switch to enter separate stock items per sale, such as one finished pastry. The editor divides material costs by the yield, then adds labor and other variable costs per serving in either setup.

Recipes › Menu costing compares unit cost, cost percentage, gross profit, gross margin, and suggested price across the menu. The averages use completed costs, and percentage averages use items with a positive selling price. In **Pricing rules**, set the business target margin and how much to round suggested prices up by. A menu item can save its own target margin.

Stock items can record purchase details, supplier, cost update date, SKU, and notes. Menu items and prep recipes have their own SKU and notes, and ingredient rows can carry a note.

When adding an item, categories, pick-one choices, add-ons and options already on the menu are offered as you type, so a choice like Size or Milk is set up once and reused. Picking a choice copies its options, which can then be changed for that item.

Settings › Opening checklist holds the steps to tick before the till opens. The ticked list is saved with the shift.

Items and checklist steps can carry a photo, taken with the camera or picked from the gallery. The phone shrinks it to a JPEG of at most 640 pixels before upload. Photos are stored in Postgres (`portable_pos.images`, 400 KB each at most), served from `/api/images/<id>` with a long cache, and kept by the service worker for offline use. Only the owner adds photos.

## Businesses and branding

One account can run several businesses, and can be on other people's teams too. Tap the business name at the top of Sell, or **Switch business** in Settings, to switch or add one. Each business has its own menu, team, shifts, PIN and till. On a phone, each keeps its own offline register, and sales waiting to sync stay with their business until you switch back. The app sends the chosen business in an `X-Business-Id` header. Without it, the server uses the first business the person owns, or else the first one they joined.

Settings › Business holds the logo and the theme: brand color (from the swatches or any color), font, corner roundness and text color. The theme applies across the whole app, including buttons and highlights, and previews live before it is saved. The logo and color also show on receipts, the business switcher and shift reports. Fonts other than Geist load from Google Fonts.

## Proof photos

Checkout can ask for a photo before a sale completes. For a discount, switch on **Require a proof photo** (new PHP registers start with it on for Senior / PWD). For a non-cash method, switch on **Require a payment photo**. Without that, non-cash sales still offer an optional photo of the payment screen. Photos are kept on the phone with the sale and upload as private images before the sale syncs, so checkout works offline. They're served from `/api/proofs/<id>` only to signed-in people on that business, and they show under the receipt.

## Team and schedule

Owners invite people in Settings › Team. Portable POS emails the invitation link to the address the owner enters. The invitee signs in with that confirmed address and can switch between this team and any businesses they already own or work for. Owners can open a pending invite to resend the email or share the link. Before sign-in, an invite link shows the business's name, logo and brand color, the primary owner's name, and the name the invitee joins as (from `/api/links/invite/<code>`), and defaults to creating an account. A person joins a shift as cashier or server and can switch until the shift ends. Owners can change anyone's shift role. Anyone on the team can run the till.

To give someone owner access, open **Settings › Team**, select someone who has accepted their invitation, set **Business access** to **Owner**, and save with the business's owner PIN. Owners can manage the register, settings and team, and see pay and profit. Select **Team member** to revoke access for an additional owner. The original owner keeps owner access.

The Shifts tab shows a month calendar of scheduled shifts. Each shift has a location, an organizer and event, the seats it needs, and the people on it with their pay. It also has rent, a sales quota, and an incentive paid to each person when sales reach the quota. Teammates can join open seats or leave a shift before it starts. The owner creates and edits shifts and can add a run of them at once for a bazaar. The owner also assigns, swaps, takes people off, or takes over a seat. All of these need the owner PIN.

When the till opens, it asks which scheduled shift it's for. That shift's profit is the till's net sales minus rent, salaries and any incentives. Cost of goods isn't counted. Rent, other people's pay, and profit are visible only to the owner.

A shift's sheet on the Shifts tab shows its best sellers. Tapping a seller, or **All sales**, opens the Sales tab filtered to that shift. The trophy button at the top of Shifts opens leaderboards for events, organizers, places and people, for **This month** or **All time**. In Sales, open **Sales by hour** to view the chart once enough receipts are available. The owner sees leaderboard rankings by sales with profit. Everyone else sees rankings by quotas hit, then shifts worked.

Location search uses OpenStreetMap's Photon geocoder, and the map preview uses OpenStreetMap tiles, so no API key is needed. **My location** opens the map at the phone's location. Drag the map or tap a spot to adjust the pin, then choose **Use this location**. Search and map tiles need a connection. Without one, the typed name can still be saved as the location.

## Verification

For toast interactions and shared action labels, start the app locally, then run `POS_TEST_APP_URL=http://localhost:3000 npx playwright test tests/toast.spec.ts`. This uses an isolated browser demo and checks tap, downward touch swipe, keyboard dismissal, drag direction, and Undo.

For the sign-in and invitation flows, run `npx playwright test tests/auth-entry.spec.ts`. To include the mocked sign-in and email confirmation tests, start the local app with `NEXT_PUBLIC_SUPABASE_URL=https://portable-pos-test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-test-key` and set `POS_TEST_MOCK_AUTH=1` when running Playwright.

`npm test` exercises local persistence, retry behavior, and the API authentication boundary. For the integration suite, migrate a disposable PostgreSQL database and set `POS_TEST_DATABASE_URL` before running the same command. Optional `POS_TEST_AUTH_URL` and `POS_TEST_AUTH_KEY` enable the real Supabase Auth tests against an isolated instance configured to confirm test accounts automatically.

The shared TypeScript domain code calculates prices, option selections, cash change, and drawer totals. Drizzle owns persistence and migrations. IndexedDB holds the device's cart, receipts, and ordered sync queue.
