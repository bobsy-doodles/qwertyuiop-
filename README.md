# Gift Card Manager

A static, no-build-step gift card tracker: balances, expiry dates, and a
photo-backed receipt log with OCR-assisted amount detection. Auth and storage
run entirely on Supabase.

## What changed from the old version

- **Real backend.** Everything used to live in `localStorage`. Cards and
  receipts are now Postgres rows scoped to the signed-in user via Row Level
  Security — nothing is readable by anyone else, including other
  authenticated users.
- **Receipt photos live in Supabase Storage**, not as base64 blobs in the
  database. The app reads them back through short-lived signed URLs.
- **`spent` is derived, not stored.** The old app incremented/decremented a
  `spent` counter on every add/edit/delete, which is exactly the kind of
  thing that quietly drifts out of sync. This version always computes spend
  by summing receipts for a card, so it can't disagree with itself.
- **Full auth flow**: sign up with email confirmation, sign in, forgot
  password, and reset password are all wired up (the original had no real
  auth at all).

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com) (or reuse an
   existing one).
2. Go to **SQL Editor → New query**, paste in the contents of
   `supabase-schema.sql`, and run it. This creates the `cards` and
   `receipts` tables, turns on Row Level Security, and creates a private
   `receipts` storage bucket with its own access policies.
3. Go to **Project Settings → API** and copy your **Project URL** and
   **anon public key** into `config.js`.

## 2. Email delivery (important)

Supabase's built-in email service is rate-limited to a handful of emails per
hour — fine for a quick test, not fine for real signups. Before sharing this
with anyone else:

- Go to **Authentication → Providers → Email** and confirm "Confirm email"
  is on if you want email verification before first sign-in.
- Go to **Project Settings → Auth → SMTP Settings** and connect a custom
  SMTP provider (Resend, Postmark, SES, etc.) so confirmation and
  password-reset emails send reliably.
- Under **Authentication → URL Configuration**, add the URL you'll deploy to
  (e.g. `https://your-site.pages.dev`) as a **Redirect URL** — password
  reset links won't work without this.

## 3. Run it locally

No build step — just serve the folder:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open it over `http://localhost`, not `file://`, so `crypto.randomUUID()`
and Supabase auth redirects behave correctly.

## 4. Deploy to Cloudflare Pages

Push the folder to a git repo and connect it in Cloudflare Pages, or drag-and-drop
the folder in the Pages dashboard. There's no build command — it's a static
site (**Build output directory**: `/`).

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup for the auth screen and main app |
| `styles.css` | All styling |
| `script.js` | Auth, data loading, rendering, OCR, all event handling |
| `config.js` | Your Supabase URL + anon key |
| `supabase-schema.sql` | Tables, RLS policies, storage bucket + policies |

## Notes on data stored

Card numbers and PINs are stored as plain text columns, protected only by
Row Level Security (so only you can query your own rows through the anon
key). That's a reasonable bar for a personal tool but isn't encryption at
rest — if you ever want stronger protection, look at Supabase Vault or
encrypting those two fields client-side before insert.
