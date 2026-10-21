# Welcome to your Expo app 👋

Offline-first point-of-sale and inventory for small Indian kirana stores. Expo SDK 58 + Expo Router, runs on web and Android.

## Run

```bash
npm install
npx expo start --web      # web
npx expo start --android  # Android (Expo Go works: no custom native modules yet)
```

Checks:

```bash
npx tsc --noEmit
npx expo lint
node scripts/check-engine.ts   # billing/inventory invariants (money, stock, idempotent confirm, barcodes)
```

## What is built (UI phase)

All 15 screens are real and work against local data: Home, New Bill, Product Search, Bill Review, Inline Correction, Open Sales, Barcode Scanner (camera + manual entry), Add Product, Restock, Inventory, Bill History, Receipt (WhatsApp/share), Nearby Sync, Sync Result, Today's Sales, Settings. English and Hindi.

- `src/lib/engine.ts` — pure billing/inventory logic. Money is integer paise, quantity is integer thousandths. Confirm is atomic (one new state or an error) and idempotent; drafts never touch stock; a shortage needs an explicit override.
- `src/lib/store.ts` — one JSON snapshot persisted to localStorage (web) / SQLite-backed localStorage (native). Every change goes through the engine.
- `src/lib/i18n.ts` — all strings, EN + HI.
- Design: Ramp-style tokens in `src/constants/theme.ts` (chartreuse accent only on actions, hairline borders, one font weight).

## Not built yet (honest status)

- **Voice / ML**: START SPEAKING and SPEAK CORRECTION show "voice is not enabled yet". No recognition runs. Planned for later.
- **Nearby sync**: no transport is installed, so no device is ever "discovered" and SYNC reports FAILED with the reason. The outbox (`State.events`) records changes already; payloads, hashes, pairing and the transport are still to do.
- **Appwrite / PostgreSQL**: not connected. Swap the write in `store.ts#persist` for repositories when the backend lands.
- **Backup**: none. Clearing browser/app data erases the shop's data.
- **Web offline install (PWA)**: not set up; the dev server needs to be online to load the page.
- Not tested on a physical Android device or in a browser yet.
