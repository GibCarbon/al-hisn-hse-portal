# Al Hisn — National Holding HSE Governance & Assurance Platform — Firebase edition

A static React app (no server) talking directly to Firebase
Authentication + Firestore + Storage, deployed to GitHub Pages — the same
architecture as National Holding's GHG/ESG (Meezan) platform.

**Start here: [`SETUP.md`](SETUP.md)** — exact steps to create the
Firebase project, create the GitHub repo, and get a live shareable link.

**Read before go-live: [`LIMITATIONS.md`](LIMITATIONS.md)** — what's
genuinely ported and working vs. deliberately deferred (PDF report
generation, OCR, malware scanning, email delivery).

This is a rebuild of a more complete Next.js/Cloudflare application built
earlier (source preserved by National Holding separately) — rebuilt here
specifically to get the GitHub Pages + Firebase hosting style, static
site, free tier, shareable URL, no server to run.

## Stack

- React 18 + TypeScript + Vite
- Firebase Authentication (email/password, real named accounts only)
- Cloud Firestore (entity-scoped data, security rules enforced
  server-side)
- Firebase Storage (evidence file uploads, chunked + hash-verified)
- Tailwind CSS v4 + the original hand-built NH-branded stylesheet
- GitHub Actions → GitHub Pages

## Local development

```sh
npm install
cp .env.example .env   # paste Firebase web-app config
npm run dev
```

## Repository layout

```
src/
  App.tsx            the portal UI (screens, forms, tables) — adapted
                      from the original build, same component, same
                      business logic, re-pointed at Firestore
  main.tsx            auth gate: sign-in / first-admin bootstrap / Portal
  lib/
    firebase.ts       Firebase app initialization
    auth.tsx          Firebase Authentication + member-profile resolution
    api.ts            the data layer — every audit/finding/action
                       operation, implemented against Firestore/Storage
    engine.ts         deterministic assessment rules (document-date
                       checks, deadline calculation, dashboard stats)
    workbook.json      the real 796-control reference workbook
  globals.css          NH-branded styles (red/navy, National Holding logo)
public/brands/          entity + NH logos
firestore.rules          server-enforced entity-scoped access control
storage.rules             evidence-file access control
.github/workflows/deploy.yml   builds + deploys to GitHub Pages on push
```
