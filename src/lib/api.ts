// Client-side replacement for the original app's server API.
//
// The original portal.tsx UI talks to a single function: api(path, data).
// This file implements that exact same contract, but against Firestore
// directly (no server) — so the UI component is reused almost unmodified.
//
// SCOPE NOTE (read LIMITATIONS.md for the full list): this port covers the
// core assurance workflow — entities, audit scoping, evidence upload,
// deterministic document-date checks, control review, findings review,
// corrective actions (plan → approve → complete → verify), and reporting
// status. It deliberately does NOT port: semantic AI assessment (the
// original only used this when a paid provider was configured anyway),
// OCR, malware scanning, resumable chunked uploads, PDF report generation,
// the background assessment worker, and the report revision/supersede
// workflow. Each of those throws a clear "not available in this
// deployment" error rather than silently pretending to work.
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, storage } from './firebase';
import { getBytes, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { ROLES, TITLE, counts, dates, now, sha, uaeToday, uuid } from './engine';
import type { Member } from './auth';
import workbook from './workbook.json';

type R = Record<string, any>;

const fail = (message: string): never => {
  throw new Error(message);
};
const need = (cond: any, message: string) => {
  if (!cond) fail(message);
};

const DEMO_NAMES = ['Exeed', 'EFI', 'Bloom Holding', 'FoodQuest', 'Rise', 'Petromal', 'NH Head Office'];
const slug = (n: string) => n.toLowerCase().replaceAll(' ', '-');

function requireRole(p: R, ...roles: string[]) {
  if (!roles.includes(p.role)) fail('Your role cannot perform this action.');
}
const isGroupWide = (role: string) => ['group', 'gcbdo', 'committee', 'it', 'independent'].includes(role);

function recordsCol() {
  if (!db) fail('Firebase is not configured. See SETUP.md.');
  return collection(db, 'records');
}
function membersCol() {
  if (!db) fail('Firebase is not configured. See SETUP.md.');
  return collection(db, 'members');
}
function eventsCol() {
  if (!db) fail('Firebase is not configured. See SETUP.md.');
  return collection(db, 'events');
}

async function fetchRecord(id: string): Promise<R | null> {
  const snap = await getDoc(doc(recordsCol(), id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function scope(p: R, r: R): boolean {
  if (isGroupWide(p.role) && p.role !== 'it') return true;
  if (p.role === 'it') return false;
  if (p.entity !== r.entity) return false;
  if (p.role === 'owner') {
    return (p.allowedRecords || []).includes(r.id) || (r.kind === 'document' && (p.allowedRecords || []).includes(r.audit));
  }
  return true;
}

async function get(id: string, p: R, kind?: string): Promise<R> {
  const r = await fetchRecord(id);
  if (!r || (kind && r.kind !== kind) || !scope(p, r)) fail('Record unavailable in your authorised scope.');
  return r!;
}

async function listRecords(p: R, kind?: string, audit?: string): Promise<R[]> {
  const clauses = [] as any[];
  if (kind) clauses.push(where('kind', '==', kind));
  if (audit) clauses.push(where('audit', '==', audit));
  if (!isGroupWide(p.role)) clauses.push(where('entity', '==', p.entity));
  const snap = await getDocs(query(recordsCol(), ...clauses));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => scope(p, r));
}

async function createRecord(kind: string, entity: string | null, payload: R, audit: string | null = null, id = uuid()) {
  const rec = { kind, entity, audit, version: 1, created: now(), updated: now(), ...payload };
  await setDoc(doc(recordsCol(), id), rec);
  return { id, ...rec };
}
async function patchRecord(r: R, payload: R) {
  const next = { ...r, ...payload, version: (r.version || 1) + 1, updated: now() };
  const { id, ...rest } = next;
  await setDoc(doc(recordsCol(), r.id), rest, { merge: false });
  return next;
}
async function logEvent(p: R, action: string, r: R, detail?: any) {
  await addDoc(eventsCol(), {
    entity: r.entity || 'group',
    audit: r.audit || null,
    record: r.id || null,
    represented: { id: p.id, name: p.name, designation: p.designation, role: p.role, entity: p.entity },
    action,
    detail: detail || {},
    created: now(),
  });
}

// ── profile / principal resolution ──────────────────────────────────────
export async function principal(member: Member): Promise<R> {
  let allowedRecords: string[] = [];
  if (member.role === 'owner') {
    for (const id of member.assignments || []) {
      const action = await fetchRecord(id);
      if (action && action.kind === 'action') {
        allowedRecords.push(action.id, action.finding, action.audit, ...(action.completion?.evidence || []));
      }
    }
  }
  return { ...member, allowedRecords };
}

// ── bootstrap: seed the 7 NH entities + 796-control reference workbook ──
export async function seedReferenceData(p: R) {
  const existingEntities = await listRecords(p, 'entity');
  if (existingEntities.length) return { alreadySeeded: true };
  requireRole(p, 'group');
  for (const name of (workbook as any).entities || DEMO_NAMES) {
    const id = slug(name);
    await createRecord(
      'entity',
      id,
      {
        name,
        logo: { 'nh-head-office': 'nh', 'bloom-holding': 'bloom' }[id] || id,
        ceo: '',
        mr: '',
        location: 'Needs confirmation',
        divisions: [...new Set((workbook as any).controls.filter((c: any) => c.entity === name).map((c: any) => c.scope))],
      },
      null,
      id
    );
  }
  for (const c of (workbook as any).controls) {
    await createRecord(
      'control',
      slug(c.entity),
      { ...c, entityName: c.entity, criterionStatus: 'Unvalidated workbook reference', active: true },
      null,
      `${slug(c.entity)}:${c.originalId}`
    );
  }
  await createRecord(
    'criterion',
    'group',
    {
      name: 'NH internal document-control and responsibility check',
      authority: 'NH internal',
      clause: 'NH-DC-01',
      versionLabel: '1',
      wording:
        'Requested evidence must be current, approved and consistent. Reporting-line contradictions require clarification.',
      source: 'NH HSE governance and assurance master specification',
      basis: 'Internal',
      status: 'Approved',
      aiAllowed: false,
      jurisdiction: 'All scoped audits',
      verifiedBy: p.name,
      verifiedAt: now(),
    },
    null,
    'internal-criterion'
  );
  await logEvent(p, 'REFERENCE_DATA_SEEDED', { entity: 'group' }, { entities: DEMO_NAMES.length, controls: (workbook as any).controls.length });
  return { seeded: true };
}

// ── state assembly (mirrors GET /api/state) ─────────────────────────────
export async function getState(p: R) {
  const rs = await listRecords(p);
  const eventsSnap = isGroupWide(p.role) && p.role !== 'it' && p.role !== 'committee'
    ? await getDocs(query(eventsCol()))
    : p.role === 'it' || p.role === 'committee'
    ? null
    : await getDocs(query(eventsCol(), where('entity', '==', p.entity)));
  let events = eventsSnap ? eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  events = events.sort((a: any, b: any) => (a.created < b.created ? 1 : -1)).slice(0, 150);
  if (p.role === 'owner') events = events.filter((e: any) => (p.allowedRecords || []).includes(e.record));

  const members = ['group', 'it'].includes(p.role) ? (await getDocs(membersCol())).docs.map((d) => ({ id: d.id, ...d.data() })) : [];

  return {
    profile: p,
    roles: ROLES,
    records: rs.map((r) => (r.kind === 'document' ? { ...r, text: undefined, pages: undefined } : r)),
    events,
    outbox: [] as R[],
    stats: counts(rs.filter((r) => r.kind === 'finding'), rs.filter((r) => r.kind === 'instance')),
    integrations: { mode: 'Pilot', ai: false, ocr: false, scanner: false, email: false },
    members,
  };
}

// ── the api(path, data) router ───────────────────────────────────────────
export async function apiRouter(p: R, path: string, data: any): Promise<any> {
  const seg = path.split('/').filter(Boolean);

  if (seg[0] === 'entities') {
    requireRole(p, 'group');
    need(data.name && data.ceo && data.mr, 'Entity name and approved CEO/MR contacts required');
    const old = data.id ? await get(data.id, p, 'entity') : null;
    const id = old?.id || slug(data.name);
    const payload = {
      name: data.name,
      ceo: data.ceo,
      mr: data.mr,
      location: data.location || 'Needs confirmation',
      divisions: data.divisions || [],
      contactsApproved: !!data.contactsApproved,
      committee: data.committee || old?.committee || '',
      gcbdo: data.gcbdo || old?.gcbdo || '',
      logo: old?.logo || 'nh',
    };
    const rec = old ? await patchRecord(old, payload) : await createRecord('entity', id, payload, null, id);
    await logEvent(p, 'ENTITY_CONFIGURATION', { id: rec.id, entity: id }, payload);
    return { id: rec.id };
  }

  if (seg[0] === 'members') {
    requireRole(p, 'group');
    need(ROLES[data.role] && data.email && data.name && data.designation, 'Name, email, designation and valid role required');
    if (!isGroupWide(data.role)) await get(data.entity, p, 'entity');
    // Real Firebase account creation needs an interactive sign-up by that
    // person (Firebase Auth has no client-side "create another user"
    // call) — so this stores the invite, and the uid is written the first
    // time that email signs in (see auth.tsx / onFirstSignInClaimInvite).
    const id = data.id || `invite-${uuid()}`;
    await setDoc(doc(membersCol(), id), {
      email: String(data.email).toLowerCase(),
      name: data.name,
      role: data.role,
      entity: data.entity,
      designation: data.designation,
      active: data.active !== false,
      expires: data.expires || null,
      assignments: data.assignments || [],
    });
    await logEvent(p, 'MEMBERSHIP_CHANGED', { entity: data.entity, id }, { email: data.email, role: data.role });
    return { id };
  }

  if (seg[0] === 'audits' && seg.length === 1) {
    requireRole(p, 'group');
    const ent = await get(data.entity, p, 'entity');
    const c = await get(data.criterion, { ...p, role: 'group' }, 'criterion');
    need(c.status === 'Approved', 'Select an approved criterion.');
    need(data.title && data.due && data.sites?.length && data.controls?.length, 'Title, deadline, site(s) and controls are required');
    const controls: R[] = [];
    for (const cid of data.controls) {
      const control = await get(cid, p, 'control');
      need(control.entity === ent.id, "Scope contains another entity's control");
      controls.push(control);
    }
    const id = uuid();
    const a = {
      title: data.title,
      type: data.type || 'Baseline',
      stage: 1,
      status: 'Draft',
      sites: data.sites,
      due: data.due,
      timezone: 'Asia/Dubai',
      criterion: c.id,
      criterionSnapshot: c,
      scopeVersion: 1,
      documentaryOnly: !!data.documentaryOnly,
      limitations: data.limitations || '',
      recipients: [ent.mr],
      ceo: ent.ceo,
    };
    await createRecord('audit', ent.id, a, id, id);
    for (const control of controls) {
      for (const site of data.sites) {
        await createRecord(
          'instance',
          ent.id,
          {
            originalId: control.originalId,
            control: control.id,
            site,
            documents: control.documents,
            verify: control.verify,
            basis: control.basis,
            criterion: c.id,
            criterionSnapshot: c,
            applicability: 'Applicable',
            result: 'Unassessed',
            risk: 'Unassessed',
            owner: 'HSE MR',
          },
          id
        );
      }
    }
    await logEvent(p, 'AUDIT_CREATED', { id, entity: ent.id, audit: id }, { scope: a, controls: controls.map((c) => c.id) });
    return { id };
  }

  if (seg[0] === 'audits' && seg[1] && seg[2]) {
    const a = await get(seg[1], p, 'audit');
    const action = seg[2];

    if (action === 'observation') {
      requireRole(p, 'group', 'auditor', 'independent');
      need(!a.reportId, 'Issued report is frozen');
      need(data.text && data.method && data.site && data.date, 'Method, site, date and observation required');
      const id = uuid();
      await createRecord('observation', a.entity, { ...data, author: p.name, status: data.status || 'Completed' }, a.id, id);
      await patchRecord(a, { stage: 2, status: 'Field verification' });
      await logEvent(p, 'FIELD_OBSERVATION', a, data);
      return { id };
    }

    if (action === 'approve-review') {
      requireRole(p, 'group', 'independent');
      need(!a.reportId, 'Already issued');
      const fs = await listRecords(p, 'finding', a.id);
      const ins = await listRecords(p, 'instance', a.id);
      const obs = await listRecords(p, 'observation', a.id);
      need(
        !fs.some((f) => ['Draft', 'Clarification requested', 'Deferred to field'].includes(f.status)),
        'Review or resolve every draft, clarification and deferred finding first'
      );
      need(!(ins.some((i) => i.result === 'Unassessed') && !data.limitations), 'Unassessed criteria require explicit report limitations');
      need(a.documentaryOnly || obs.some((o) => o.status === 'Completed'), 'Stage 2 field/interview evidence required, or mark this scope documentary-only');
      need(data.summary, 'Executive summary is required');
      await patchRecord(a, {
        stage: 3,
        status: 'Reviewer-approved',
        reviewedBy: { id: p.id, name: p.name, designation: p.designation, at: now() },
        summary: data.summary,
        limitations: data.limitations || a.limitations,
      });
      await logEvent(p, 'REVIEW_APPROVED', a, { summary: data.summary });
      return { ok: true };
    }

    if (action === 'ready') {
      requireRole(p, 'group');
      need(a.status === 'Reviewer-approved', 'Review is required before marking ready to issue');
      await patchRecord(a, { status: 'Ready to issue' });
      return { ok: true };
    }

    if (action === 'issue') {
      requireRole(p, 'group');
      if (a.reportId) return { id: a.reportId, alreadyIssued: true };
      need(a.status === 'Ready to issue', 'Approve review and mark ready to issue first');
      const fs = (await listRecords(p, 'finding', a.id)).filter((f) => f.status === 'Confirmed');
      need(
        !fs.some((f) => !f.due || !f.actionOwner || (!f.evidence?.length && f.findingType !== 'Evidence gap')),
        'Confirmed findings need evidence (or a documented evidence-gap basis), owner and deadline'
      );
      // NOTE: PDF report generation is not ported in this build (see
      // LIMITATIONS.md) — this records the issue decision and opens
      // corrective actions for each confirmed finding, without producing
      // a signed PDF artefact.
      const id = `report-${a.id}`;
      await createRecord('report', a.entity, { title: a.title, status: 'Issued', findingCount: fs.length }, a.id, id);
      await patchRecord(a, { stage: 4, status: 'Issued', reportId: id, issuedAt: now() });
      for (const f of fs) {
        await patchRecord(f, { issued: true, reportId: id });
        await createRecord(
          'action',
          a.entity,
          {
            finding: f.id,
            title: f.text,
            status: 'Plan requested',
            owner: f.actionOwner,
            originalDue: f.due,
            due: f.due,
            risk: f.risk,
            verificationMethod: f.verificationMethod || 'Evidence and effectiveness review',
            plan: null,
          },
          a.id,
          `action-${f.id}`
        );
      }
      await logEvent(p, 'REPORT_ISSUED', a, { report: id });
      return { id };
    }

    if (action === 'acknowledge') {
      requireRole(p, 'ceo');
      const report = await get(a.reportId, p, 'report');
      need(report.status === 'Issued', 'Report is not issued');
      await createRecord('decision', a.entity, { type: 'Acknowledgment', report: report.id, actor: { id: p.id, name: p.name }, at: now() }, a.id);
      return { ok: true };
    }

    if (action === 'revise') fail('Report revision is not available in this build yet — see LIMITATIONS.md. Create a new audit for a follow-up review.');
    fail('Unknown audit action.');
  }

  if (seg[0] === 'instances') {
    requireRole(p, 'group', 'independent', 'auditor');
    const i = await get(seg[1], p, 'instance');
    const a = await get(i.audit, p, 'audit');
    need(!a.reportId, 'Issued scope is frozen');
    need(['Verified documentary', 'Gap', 'Unassessed', 'N/A'].includes(data.result) && data.reason, 'Result and review reason required');
    if (data.result === 'N/A') requireRole(p, 'group', 'independent');
    await patchRecord(i, { result: data.result, reason: data.reason, reviewer: p.name, reviewedAt: now() });
    await logEvent(p, 'CONTROL_REVIEWED', i, data);
    return { ok: true };
  }

  if (seg[0] === 'findings') {
    const f = await get(seg[1], p, 'finding');
    const a = await get(f.audit, p, 'audit');
    const op = seg[2] || 'review';
    if (op === 'review') {
      requireRole(p, 'group', 'independent');
      need(!a.reportId, 'Issued findings are immutable; record subsequent decisions or a follow-up audit');
      need(['Confirmed', 'Rejected', 'Clarification requested', 'Deferred to field'].includes(data.status) && data.reason, 'Select a review decision and record your reason');
      if (data.status === 'Confirmed') {
        need(
          ['High', 'Medium', 'Low'].includes(data.risk) && /^\d{4}-\d{2}-\d{2}$/.test(data.due || '') && data.actionOwner && data.verificationMethod,
          'Confirmation requires risk, owner, deadline and verification method'
        );
      }
      await patchRecord(f, { ...data, reviewedAt: now(), reviewedBy: p.name });
      await logEvent(p, 'FINDING_REVIEWED', f, { decision: data });
      return { ok: true };
    }
    if (op === 'respond') {
      requireRole(p, 'ceo');
      need(f.issued, 'Only issued findings can be accepted/disputed');
      need(['Accept finding', 'Dispute finding'].includes(data.type) && data.text, 'Response and explanation required');
      await createRecord('decision', f.entity, { ...data, finding: f.id, actor: { id: p.id, name: p.name }, at: now() }, f.audit);
      await logEvent(p, data.type === 'Accept finding' ? 'FINDING_ACCEPTED' : 'FINDING_DISPUTED', f, data);
      return { ok: true };
    }
    fail('Unknown finding action.');
  }

  if (seg[0] === 'actions') {
    const r = await get(seg[1], p, 'action');
    const op = seg[2];
    const f = await get(r.finding, p, 'finding');
    let patch: R = {};
    if (op === 'plan') {
      requireRole(p, 'group', 'mr', 'owner');
      need(['Plan requested', 'Plan submitted', 'Rejected completion', 'Reopened'].includes(r.status), 'Plan cannot be edited in the current state');
      need(data.correction && data.rootCause && data.correctiveAction && data.owner && data.effectiveness, 'Containment, root cause, corrective action, owner and effectiveness method required');
      patch = { plan: data, status: 'Plan submitted', owner: data.owner };
    } else if (op === 'approve') {
      requireRole(p, 'ceo');
      need(r.status === 'Plan submitted', 'Submit a plan first');
      patch = { status: 'Plan approved', approvedBy: { id: p.id, name: p.name, at: now() } };
    } else if (op === 'start') {
      requireRole(p, 'group', 'mr', 'owner');
      need(r.status === 'Plan approved', 'CEO plan approval required');
      patch = { status: 'In progress' };
    } else if (op === 'complete') {
      requireRole(p, 'group', 'mr', 'owner');
      need(['In progress', 'Rejected completion'].includes(r.status), 'Action must be in progress');
      need(data.evidence?.length && data.effectiveness, 'Implementation evidence and effectiveness results required');
      patch = { status: 'Completion submitted', completion: data, completedAt: now(), completedBy: p.id };
    } else if (op === 'verify') {
      requireRole(p, 'group', 'independent');
      need(r.status === 'Completion submitted', 'Submit completion before verification');
      need(r.completedBy !== p.id && r.owner !== p.name, 'Independent verification is required for work you own or submitted');
      need(data.reason && data.effectivenessConfirmed, 'Record independent effectiveness verification and rationale');
      patch = { status: 'Verified closed', verification: data, verifiedBy: p.name, verifiedAt: now() };
    } else if (op === 'reject') {
      requireRole(p, 'group', 'independent');
      need(r.status === 'Completion submitted' && data.reason, 'Completion submission and rejection reason required');
      patch = { status: 'Rejected completion', rejection: data.reason };
    } else if (op === 'extension') {
      requireRole(p, 'group', 'mr', 'owner', 'ceo');
      need(data.due && data.reason, 'Proposed deadline and reason required');
      patch = { extension: { ...data, requestedBy: p.name, at: now(), status: 'Requested' } };
    } else if (op === 'approve-extension') {
      requireRole(p, 'group', 'independent');
      need(r.extension && data.reason, 'Extension request and recorded basis required');
      patch = {
        due: r.extension.due,
        extensions: [...(r.extensions || []), { ...r.extension, approvedBy: p.name, approvalReason: data.reason, approvedAt: now() }],
        extension: null,
      };
    } else if (op === 'reopen') {
      requireRole(p, 'group', 'independent');
      need(r.status === 'Verified closed' && data.reason, 'Verified closure and recurrence reason required');
      patch = { status: 'Reopened', reopenedAt: now(), reopenReason: data.reason };
    } else fail('Unknown action.');

    const updated = await patchRecord(r, patch);
    if (op === 'verify') {
      const siblings = await listRecords(p, 'action', r.audit);
      if (siblings.filter((x) => x.finding === f.id && x.id !== r.id).every((x) => x.status === 'Verified closed')) {
        await patchRecord(f, { status: 'Verified closed', closedAt: now() });
      }
    }
    if (op === 'reopen') await patchRecord(f, { status: 'Confirmed', closedAt: null });
    await logEvent(p, `ACTION_${op.toUpperCase()}`, r, { before: r.status, ...data });
    return { ok: true, ...updated };
  }

  if (seg[0] === 'criteria') {
    requireRole(p, 'group');
    need(data.name && data.clause && data.wording && data.source && data.versionLabel && data.basis, 'Criterion title, clause, wording, source, version and basis are required');
    const id = uuid();
    await createRecord('criterion', 'group', { ...data, verifiedBy: p.name }, null, id);
    await logEvent(p, 'CRITERION_VERSION_CREATED', { id, entity: 'group' }, data);
    return { id };
  }

  if (seg[0] === 'seed-reference') return seedReferenceData(p);

  // ── evidence upload — chunked to Firebase Storage, reassembled + hash
  // verified on finalize, matching the original app's resumable protocol
  // and call sequence (create → chunk → finalize) so the UI's own
  // resumableUpload() helper works unmodified. ──────────────────────────
  if (seg[0] === 'uploads') {
    requireRole(p, 'group', 'mr', 'auditor', 'independent', 'owner', 'ceo');
    if (seg.length === 1 && data && !(data instanceof FormData)) {
      const a = await get(data.audit, p, 'audit');
      need(data.filename && data.size && data.size <= 15 * 1024 * 1024 && data.hash, 'Valid supported file up to 15 MB required');
      const id = uuid();
      await createRecord('upload', a.entity, { filename: data.filename, size: data.size, hash: data.hash, contentType: data.contentType, metadata: data.metadata || {}, chunks: [], owner: p.id }, a.id, id);
      return { id, chunkSize: 1024 * 1024 };
    }
    const u = await get(seg[1], p, 'upload');
    if (seg.length === 2) return u; // GET-style status check
    if (seg[2] === 'chunk') {
      const form = data as FormData;
      const index = Number(form.get('index'));
      const chunk = form.get('chunk') as File;
      const bytes = new Uint8Array(await chunk.arrayBuffer());
      if (!storage) fail('Firebase Storage is not configured. See SETUP.md.');
      await uploadBytes(ref(storage!, `${u.entity}/uploads/${u.id}/${index}`), bytes);
      await patchRecord(u, { chunks: [...new Set([...(u.chunks || []), index])] });
      return { received: index };
    }
    if (seg[2] === 'finalize') {
      if (u.document) return { id: u.document, alreadyFinalized: true };
      const totalChunks = Math.ceil(u.size / (1024 * 1024));
      need((u.chunks || []).length === totalChunks, 'Upload incomplete; resume missing chunks');
      const parts: Uint8Array[] = [];
      if (!storage) fail('Firebase Storage is not configured. See SETUP.md.');
      for (let i = 0; i < totalChunks; i++) parts.push(await getBytes(ref(storage!, `${u.entity}/uploads/${u.id}/${i}`)).then((b) => new Uint8Array(b)));
      const bytes = new Uint8Array(u.size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      need((await sha(bytes)) === u.hash, 'Original file hash mismatch — retry the upload');
      const key = `${u.entity}/documents/${u.id}`;
      await uploadBytes(ref(storage!, key), bytes, { contentType: u.contentType || 'application/octet-stream' });
      const meta = u.metadata || {};
      const document = await createRecord(
        'document',
        u.entity,
        {
          ...meta,
          title: meta.title || u.filename,
          filename: u.filename,
          contentType: u.contentType,
          size: u.size,
          hash: u.hash,
          key,
          instances: meta.instances || [],
          processing: 'Processed',
          scan: 'Not scanned — malware scanning is not configured in this build (see LIMITATIONS.md)',
          text: '',
          pages: [],
          extractionMethod: 'None — OCR/text extraction not configured in this build',
          uploader: { id: p.id, name: p.name, designation: p.designation },
        },
        u.audit
      );
      await patchRecord(u, { document: document.id });
      await logEvent(p, 'EVIDENCE_UPLOADED', { id: document.id, entity: u.entity, audit: u.audit }, { document: document.id, hash: u.hash });
      return { id: document.id, processing: 'Processed' };
    }
    fail('Unknown upload action.');
  }

  if (seg[0] === 'documents' && seg[1] && seg[2] === 'link') {
    requireRole(p, 'group', 'mr', 'auditor', 'independent', 'owner', 'ceo');
    const d = await get(seg[1], p, 'document');
    for (const id of data.instances || []) {
      const i = await get(id, p, 'instance');
      need(i.audit === d.audit, 'Sharing across audit/entity boundaries requires a separate controlled submission');
    }
    await patchRecord(d, { instances: [...new Set([...(d.instances || []), ...(data.instances || [])])] });
    await logEvent(p, 'EVIDENCE_LINKED', d, data);
    return { ok: true };
  }

  if (seg[0] === 'files' && seg[1]) {
    const d = await get(seg[1], p);
    if (!['document', 'report'].includes(d.kind)) fail('No file');
    if (!storage) fail('Firebase Storage is not configured. See SETUP.md.');
    const url = await getDownloadURL(ref(storage!, d.key));
    return { url };
  }

  // ── deterministic (non-AI) assessment run — the same document-date
  // and reporting-line checks the original engine ran without a paid
  // semantic-AI provider configured. ─────────────────────────────────
  if (seg[0] === 'jobs') {
    requireRole(p, 'group', 'auditor', 'independent');
    if (seg.length === 1) {
      const a = await get(data.audit, p, 'audit');
      need(!a.reportId, 'Issued audit is frozen');
      const id = uuid();
      await createRecord('job', a.entity, { type: 'Assessment', status: 'Queued', requestedBy: p.id }, a.id, id);
      return { id };
    }
    const job = await get(seg[1], p, 'job');
    if (job.status === 'Completed') return { alreadyCompleted: true };
    const a = await get(job.audit, p, 'audit');
    const docs = await listRecords(p, 'document', a.id);
    const instances = await listRecords(p, 'instance', a.id);
    const previous = await listRecords(p, 'finding', a.id);
    const drafts: R[] = [];
    const make = (i: R | undefined, text: string, risk: string, evidence: any[] = [], findingType = 'Clarification') => {
      if (previous.some((f) => f.instance === i?.id && f.text === text && f.status !== 'Rejected')) return;
      drafts.push({
        instance: i?.id || instances[0]?.id,
        controlId: i?.originalId || 'Cross-document',
        scope: i?.site || a.sites.join(', '),
        criterion: i?.criterion || a.criterion,
        criterionSnapshot: i?.criterionSnapshot || a.criterionSnapshot,
        text,
        risk,
        findingType,
        status: 'Draft',
        evidence,
        issued: false,
        humanReviewRequired: true,
      });
    };
    for (const i of instances) {
      const linked = docs.filter((d) => (d.instances || []).includes(i.id));
      if (i.applicability === 'N/A') continue;
      if (i.applicability !== 'Applicable') {
        make(i, 'Applicability unresolved; no conclusion can be drawn.', 'Unassessed');
        continue;
      }
      if (!linked.length) {
        const missing = a.requestIssued && a.due < uaeToday();
        make(
          i,
          missing ? 'Requested evidence not received by the deadline. Confirm non-availability with the HSE MR before confirming risk.' : 'No linked evidence yet. Assessment remains open.',
          missing ? 'High' : 'Unassessed',
          [],
          'Evidence gap'
        );
        continue;
      }
      for (const d of linked) {
        const ev = [{ document: d.id, page: 1, section: 'Document metadata (uploader supplied; verify against original)', quote: `${d.title}; expiry ${d.expiryDate || 'unknown'}; review ${d.reviewDate || 'unknown'}` }];
        for (const issue of dates(d)) make(i, issue.text, issue.risk, ev, 'Document control');
      }
      make(i, 'Semantic AI is not configured in this build. Date checks are active; coverage gaps remain unassessed for human review.', 'Unassessed');
    }
    for (const f of drafts) await createRecord('finding', a.entity, f, a.id);
    await createRecord('run', a.entity, { status: 'Completed deterministic checks', provider: 'Not configured', documentCount: docs.length, draftCount: drafts.length, limitations: ['Documentary review is not implementation assurance', 'Semantic assessment requires a configured AI service — not included in this build'] }, a.id);
    await patchRecord(a, { stage: 1, status: 'Under review' });
    await patchRecord(job, { status: 'Completed', result: { count: drafts.length }, completedAt: now() });
    await logEvent(p, 'ASSESSMENT_RUN', a, { drafts: drafts.length });
    return { count: drafts.length };
  }

  if (seg[0] === 'imports' || seg[0] === 'documents') {
    fail('Workbook re-import and OCR transcription are not available in this build — see LIMITATIONS.md. Use "Load NH reference workbook" in Administration instead of importing a new XLSX.');
  }

  fail(`Endpoint not found: ${path}`);
}
