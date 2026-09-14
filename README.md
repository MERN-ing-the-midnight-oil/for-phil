# For Phil

Family board for Phil’s Bellingham memory care search. The UI is static HTML/JS; **Supabase** holds facilities, call notes, and family names.

The old Google Sheet / Apps Script files in `gas/` are leftover until the new site is confirmed. Do not deploy them.

## One-time backend setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste and run [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql). That creates `facilities`, `people`, and `call_logs`, seeds the eight family names, adds claim/save RPCs, and turns on Row Level Security plus Realtime.
3. **Authentication → Providers → Email**: turn **Confirm email** off so the shared family user can sign in immediately.
4. **Authentication → Users → Add user**:
   - Email: a dummy family address, e.g. `family@for-phil.app` (must match `familyEmail` in config).
   - Password: the **shared family PIN**.
5. **Project Settings → API**: copy Project URL and the `anon` `public` key.

## Connect the app

```bash
cp config.example.js config.js
```

Fill in `supabaseUrl`, `supabaseAnonKey`, and `familyEmail`. The anon key is safe to ship in the browser; the PIN is the secret.

`config.js` is committed so GitHub Pages can serve it. Keep `.env` out of git — that file has the service role key.

## Import the Google Sheet

Export the Facilities tab as CSV (**File → Download → Comma Separated Values**). Optionally export the `CallLog` tab too.

```bash
cp .env.example .env
```

Put these in `.env` (gitignored; never put them in `config.js`):

- Project URL
- Database password from project creation (Postgres; useful if you connect with the Supabase CLI or a SQL client)
- **service role** key from **Project Settings → API** (needed for the CSV import)

Then:

```bash
node scripts/import-sheet.mjs --csv path/to/facilities.csv
node scripts/import-sheet.mjs --csv path/to/facilities.csv --logs path/to/calllog.csv
```

If the spreadsheet is still shared publicly:

```bash
node scripts/import-sheet.mjs --from-sheet
```

The importer upserts on facility name, maps the old column headers, and flags A Place for Mom top-10 homes when that column is empty.

## Family use

1. Open the hosted site.
2. Enter the shared PIN.
3. Pick your name (or add someone). Names stamp notes and “I’ve started this”.
4. Share the site URL plus the PIN — not a Google Apps Script link.

Everyone stays signed in on that phone/browser until they clear site data.

## Deploy the UI

This is a static folder (`index.html`, `app.js`, `styles.css`, `config.js`).

**Live site:** [https://mern-ing-the-midnight-oil.github.io/for-phil/](https://mern-ing-the-midnight-oil.github.io/for-phil/)

GitHub Pages serves those files from the `main` branch root.

- **Local**: `python3 -m http.server 4173` from this directory, then open `http://localhost:4173`.

Realtime updates need the SQL migration’s publication step. If two people edit at once, the other phone should refresh within a second without a reload.

## What replaced the sheet

| Old | New |
| --- | --- |
| Facilities tab | `facilities` table |
| CallLog tab | `call_logs` table |
| Family names | `people` table |
| Apps Script `save` / `note` | `save_facility` RPC |
| Claim / release + LockService | `claim_facility` / `release_facility` |
| JSONP / `google.script.run` | Supabase JS client |
| Shared `/exec` URL | This static site + PIN |
