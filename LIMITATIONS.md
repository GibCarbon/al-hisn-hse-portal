# Limitations — read before treating this as production-complete

This is a rebuild of the ChatGPT-produced `NH-HSE-Portal` (Next.js +
Cloudflare D1/Workers, `NH_HSE_Portal_Source_and_IT_Handover.zip`) as a
static React app on Firebase, so it can be hosted the same free,
serverless way as the GHG/ESG (Meezan) platform — GitHub Pages + Firebase,
no server. That hosting change comes with an honest scope trade-off,
listed here in full, matching the same disclosure standard the original
build used (`docs/README-NH-IT.md` §"Delivery status").

## Ported and working (real, not mocked)

- Real named-account sign-in via Firebase Authentication (no demo/seeded
  users — invite-only, enforced server-side by Firestore security rules).
- Entity-scoped access control (`firestore.rules`), mirroring the
  original's role/entity checks.
- The 796-control reference workbook across all 7 NH entities (one-click
  load from Administration).
- Audit scoping (select entity, sites, controls, criterion → creates
  control instances).
- Evidence upload, chunked to Firebase Storage with SHA-256 integrity
  verification on finalize (same chunk-and-verify protocol as the
  original, just backed by Storage instead of R2/D1).
- Deterministic document-date checks (expiry, review-overdue, ambiguous
  dates, missing approver, etc.) — the same `dates()` engine, unmodified.
- Control review, findings review (confirm/reject/clarify/defer),
  corrective-action lifecycle (plan → CEO approval → complete →
  independent verification → close, plus extension requests and
  reopening).
- Audit trail (append-only event log) and the group dashboard.

## Deliberately NOT ported in this build

- **PDF report generation.** "Issue report" records the issue decision,
  opens corrective actions for confirmed findings, and marks the audit
  Issued — but does not produce a signed PDF artefact. Recipients would
  need the findings register (visible in-app) rather than a PDF today.
- **OCR / text extraction from uploaded documents.** Files upload and
  hash-verify correctly, but page text isn't extracted, so the
  reporting-line-contradiction check and per-page evidence citations are
  not available. A verified-transcription workflow existed in the
  original for exactly this gap; it isn't wired up here yet.
- **Semantic/AI assessment.** The original only used this when a paid
  provider was configured anyway (`ASSESSMENT_URL`); this build always
  runs the deterministic checks only, same as the original's
  unconfigured-AI fallback path.
- **Malware scanning on upload.** Uploaded files are stored and
  hash-verified but not scanned. Don't upload from untrusted sources
  without your own antivirus step until this is added.
- **Workbook re-import (XLSX upload/preview/commit).** The bundled 796
  controls can be loaded once; re-importing a revised spreadsheet through
  the UI isn't implemented — ask me to add it if you need to reconcile
  workbook changes later than this delivery.
- **Report revision / supersede workflow.** Issued audits can't be
  revised in place; create a new audit as a follow-up review instead.
- **Email notifications.** No outbox/delivery system — recipients are
  recorded but nothing is emailed. NH's own email sending would need a
  small Cloud Function (or a service like SendGrid called from the
  client) added on top.
- **Background assessment worker / job queue.** Assessment runs
  synchronously in the browser when you click "Reassess" — fine at NH's
  scale, but there's no independent recovery path for a job that fails
  mid-run the way the original's polling worker provided.
- **CSV/XLSX register export.** Not wired up in this build.

## Security note

Firestore security rules (`firestore.rules`) are the actual authorization
boundary — deploy them (`firebase deploy --only firestore:rules,storage:rules`,
see SETUP.md) before inviting real users. Without deployed rules, Firebase
defaults to locked-down (denies everything) or fully open depending on
how you initialized the project — check the Firebase console's Firestore
"Rules" tab shows the contents of `firestore.rules` before go-live.

This is a functional pilot, same as the original ChatGPT delivery — not a
claim of ISO certification tooling or a fully production-hardened system.
