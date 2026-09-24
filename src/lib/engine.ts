// Ported, unmodified in logic, from the original service's lib/engine.mjs.
// Pure, deterministic, browser-safe (crypto.subtle works client-side too).
export const TITLE = 'Group Head of Sustainability and HSE';

export const ROLES: Record<string, string> = {
  group: TITLE,
  mr: 'Entity HSE MR',
  ceo: 'Entity CEO',
  owner: 'Action owner',
  gcbdo: 'GCBDO',
  committee: 'NH committee',
  auditor: 'Assigned auditor/specialist',
  independent: 'Independent assurance reviewer',
  it: 'NH IT administrator',
};

export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export const sha = async (data: string | Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data)
    )
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');

export const uaeToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date()
  );

export function dates(doc: any, today = uaeToday()) {
  const a: { risk: string; text: string }[] = [];
  for (const key of ['issueDate', 'effectiveDate', 'expiryDate', 'reviewDate', 'approvalDate']) {
    if (doc[key] && !/^\d{4}-\d{2}-\d{2}$/.test(doc[key])) {
      a.push({ risk: 'Unassessed', text: `${key}: ambiguous date; confirm ISO date and locale.` });
    }
  }
  if (doc.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(doc.expiryDate) && doc.expiryDate < today) {
    a.push({
      risk: doc.essential ? 'High' : 'Medium',
      text: `Expired on ${doc.expiryDate}. A renewal application does not extend validity.`,
    });
  }
  if (doc.effectiveDate > today) {
    a.push({ risk: 'Medium', text: `Future effective date ${doc.effectiveDate}; current applicability needs confirmation.` });
  }
  if (doc.reviewDate && doc.reviewBasis && doc.reviewDate < today) {
    a.push({ risk: 'Medium', text: `Review overdue since ${doc.reviewDate} under ${doc.reviewBasis}. This is not permit expiry.` });
  }
  if (doc.reviewDate && !doc.reviewBasis) {
    a.push({ risk: 'Unassessed', text: 'Review basis not established; confirm the rule before concluding overdue.' });
  }
  if (doc.supersedes) {
    a.push({ risk: 'Medium', text: 'Check that the superseded version is withdrawn from current use.' });
  }
  if (!doc.approver) {
    a.push({ risk: 'Medium', text: 'Approval metadata not established. Check original approval evidence.' });
  }
  if (doc.issueDate && doc.effectiveDate && doc.issueDate > doc.effectiveDate) {
    a.push({ risk: 'Medium', text: 'Issue date is after effective date; confirm chronology.' });
  }
  if (doc.documentType === 'permit' && !doc.expiryDate) {
    a.push({ risk: 'Unassessed', text: 'Permit validity cannot be determined: expiry or non-expiring basis missing.' });
  }
  return a;
}

export function deadline(risk: string, start = new Date(), legalDate?: string) {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + (risk === 'Medium' ? 30 : risk === 'Low' ? 60 : 2));
  const v = d.toISOString().slice(0, 10);
  return legalDate && legalDate < v ? legalDate : v;
}

export function counts(findings: any[], instances: any[]) {
  const reviewed = instances.filter((x) => x.result && x.result !== 'Unassessed' && x.result !== 'N/A');
  const controlled = reviewed.filter((x) => x.result === 'Verified documentary');
  return {
    total: instances.length,
    assessed: reviewed.length,
    unassessed: instances.filter((x) => !x.result || x.result === 'Unassessed').length,
    na: instances.filter((x) => x.result === 'N/A').length,
    coverage: instances.filter((x) => x.result !== 'N/A').length
      ? Math.round((reviewed.length / instances.filter((x) => x.result !== 'N/A').length) * 100)
      : null,
    documentaryConformance: reviewed.length ? Math.round((controlled.length / reviewed.length) * 100) : null,
    draft: findings.filter((x) => x.status === 'Draft').length,
    issued: findings.filter((x) => x.issued).length,
    open: findings.filter((x) => x.issued && x.status !== 'Verified closed').length,
    high: findings.filter((x) => x.risk === 'High' && x.status !== 'Rejected' && x.status !== 'Verified closed').length,
  };
}
