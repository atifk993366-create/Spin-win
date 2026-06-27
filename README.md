# 🎡 Spin & Win — Setup Guide

## Files
```
index.html      → Main user-facing spin wheel
admin.html      → Admin panel
app.js          → User app logic
admin.js        → Admin panel logic
supabase-schema.sql → Database setup
```

---

## Step 1 — Supabase Setup

1. Go to https://supabase.com → Create new project
2. Open **SQL Editor** → Paste full contents of `supabase-schema.sql` → Run
3. Go to **Settings → API**:
   - Copy **Project URL**
   - Copy **anon/public** key

---

## Step 2 — Add Supabase Keys

Open both `app.js` and `admin.js`, replace at top:

```js
const SUPABASE_URL  = 'https://xxxx.supabase.co';
const SUPABASE_ANON = 'eyJhbGci...';
```

---

## Step 3 — Set Admin Phone

In Supabase SQL Editor, run:
```sql
UPDATE admin_settings SET value = '9876543210' WHERE key = 'admin_phone';
```
Replace with your actual phone number.

Then register that number on `index.html` first (this creates the user account).
After that, use `admin.html` to log in with that phone + password.

---

## Step 4 — Configure Slots (Admin Panel)

1. Open `admin.html`
2. Go to **Wheel Slots**
3. For each slot:
   - Set prize name (e.g., "50% Off", "Buy 1 Get 1")
   - Paste your product page URL
   - Set **Winner** or **Loser**
   - Adjust **weight** (higher = more likely to land)

---

## Step 5 — Configure Win Rate

Go to **Settings** in admin panel:

| Setting | Meaning |
|---------|---------|
| IP Win Rate (%) | If 100 people spin from 1 IP, only this % win |
| Max Wins Per IP Per Day | Hard cap on winners per IP per day |
| Force Next Win | Toggle ON to guarantee next spin wins |

---

## Step 6 — Deploy to GitHub Pages

```bash
# Create repo on GitHub
git init
git add .
git commit -m "Spin wheel launch"
git remote add origin https://github.com/YOUR_USERNAME/spin-wheel.git
git push -u origin main
```

Then in GitHub repo → Settings → Pages → Source: `main` branch → Save.

Your URLs:
- **Spin wheel**: `https://yourusername.github.io/spin-wheel/`
- **Admin panel**: `https://yourusername.github.io/spin-wheel/admin.html`

---

## Step 7 — Referral Sharing

When user clicks their referral code, it copies this URL:
```
https://yourusername.github.io/spin-wheel/?ref=ABC123
```

When someone opens this link and registers → referrer gets +1 referral count.
Every 10 referrals = 1 bonus spin (auto-handled by Supabase function).

---

## Step 8 — SMS OTP (Production)

In `app.js`, find `sendOTP()` function.
Replace the `alert()` with real SMS API:

**Fast2SMS (India, cheapest):**
```js
await fetch('https://www.fast2sms.com/dev/bulkV2', {
  method: 'POST',
  headers: { 'authorization': 'YOUR_API_KEY' },
  body: new URLSearchParams({
    route: 'otp',
    variables_values: code,
    numbers: phone
  })
});
```

---

## Supabase RLS Note

The schema enables RLS. For admin operations (reading all users, updating slots), either:
1. Use the **service_role** key in admin.js (keep it server-side only), OR
2. Add admin-specific RLS policies in Supabase for your admin phone

Simplest approach: Disable RLS on `spin_slots` and `admin_settings` (they're not sensitive):
```sql
ALTER TABLE spin_slots DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings DISABLE ROW LEVEL SECURITY;
```

---

## Security Notes

- Spin history is **never shown to users** (no UI for it)
- Win logic runs client-side but controlled by DB values — for production, move `determineSpinResult()` to a **Supabase Edge Function** so users can't inspect it
- IP fingerprinting is browser-based; for real IP tracking, use an Edge Function with `request.headers.get('x-forwarded-for')`
- Admin panel URL (`admin.html`) — keep it unlisted; don't share publicly
