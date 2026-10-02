# Zero Before 30

Zero Before 30 (Z30) is a simple personal money tracker built around natural-language recording.

## Current slice

Web/PWA foundation and the first locked home-screen UX.

**Locked architecture:** React + Vite PWA → Cloudflare Worker API → AI interpreter → deterministic validation/rules → Supabase.

The current frontend is intentionally presentation-only. It does not write financial data yet.

## Run locally

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Build

```bash
npm run build
```
