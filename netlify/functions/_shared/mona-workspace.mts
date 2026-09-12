import { getStore, getDeployStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { assertSameOrigin, MEMBER_ID, MemberError, memberJSON, type MemberResolver } from './member-auth.mts';
import { scoutInput, readScoutLead, type ScoutInput, type ScoutLead } from './mona-lead-scout.mts';
import { defaultPaymentPreferences, parsePaymentPreferences, type PaymentPreferences } from './mona-payment-beta.mts';

export interface MonaStore {
  get(key: string, options: {type: 'json'}): Promise<any>;
  getWithMetadata(key: string, options: {type: 'json'}): Promise<{data: any; etag: string} | null>;
  setJSON(key: string, data: unknown, options?: {onlyIfNew?: boolean; onlyIfMatch?: string}): Promise<{modified: boolean}>;
}
const STATUSES = ['saved', 'contacted', 'booked', 'archived'] as const;
type SavedLead = ScoutLead & {status: typeof STATUSES[number]; notes: string; savedAt: string; updatedAt: string};
type Workspace = {memberId: string; revision: number; preferences: ScoutInput; leads: SavedLead[]; paymentPreferences: PaymentPreferences; taxReviewedAt: string | null; updatedAt: string | null};
const EMPTY: ScoutInput = {profession: '', location: '', offering: '', goal: 'clients'};
const MAX_LEADS = 50;
const CACHE_AGE = 7 * 24 * 60 * 60 * 1000;

export function monaStore(context: Context): MonaStore {
  const options = {name: 'mona-workspace', consistency: 'strong' as const};
  return context.deploy.context === 'production' ? getStore(options) : getDeployStore({...options, deployID: context.deploy.id});
}
function iso(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
function notes(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new MemberError(400, 'Keep your private note under 2,000 characters.');
  return value.trim();
}
function readWorkspace(value: any, memberId: string): Workspace {
  if (value === null) return {memberId, revision: 0, preferences: {...EMPTY}, leads: [], paymentPreferences: defaultPaymentPreferences(), taxReviewedAt: null, updatedAt: null};
  if (!value || value.memberId !== memberId || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !Array.isArray(value.leads) || value.leads.length > MAX_LEADS || !iso(value.updatedAt)) throw new Error('Invalid private Mona workspace');
  const preferences = value.preferences?.profession === '' && value.preferences?.location === '' && value.preferences?.offering === '' && value.preferences?.goal === 'clients' ? {...EMPTY} : scoutInput(value.preferences);
  const seen = new Set<string>();
  const leads = value.leads.map((item: any): SavedLead => {
    const lead = readScoutLead(item);
    if (!lead || seen.has(lead.id) || !STATUSES.includes(item.status) || !iso(item.savedAt) || !iso(item.updatedAt)) throw new Error('Invalid saved Mona opportunity');
    seen.add(lead.id);
    return {...lead, status: item.status, notes: notes(item.notes), savedAt: item.savedAt, updatedAt: item.updatedAt};
  });
  const paymentPreferences = value.paymentPreferences === undefined ? defaultPaymentPreferences() : parsePaymentPreferences(value.paymentPreferences);
  if (value.taxReviewedAt != null && !iso(value.taxReviewedAt)) throw new Error('Invalid records review date');
  return {memberId, revision: value.revision, preferences, leads, paymentPreferences, taxReviewedAt: value.taxReviewedAt ?? null, updatedAt: value.updatedAt};
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new MemberError(415, 'Use the Mona workspace to save your changes.');
  if (!req.body || Number(req.headers.get('content-length') || 0) > 12000) throw new MemberError(413, 'This update is too large.');
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 12000) { await reader.cancel(); throw new MemberError(413, 'This update is too large.'); } chunks.push(chunk.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch {}
  throw new MemberError(400, 'Your update could not be read. Please try again.');
}
export function monaWorkspaceFailure(error: unknown): Response {
  return error instanceof MemberError ? memberJSON({error: error.message}, error.status) : memberJSON({error: 'Mona could not open your saved work. Please try again.'}, 503);
}
export async function manageMonaWorkspace(req: Request, store: MonaStore, dependencies: {resolveMember: MemberResolver; now?: () => Date}): Promise<Response> {
  try {
    if (!['GET', 'POST'].includes(req.method)) throw new MemberError(405, 'Use the Mona workspace to make changes.');
    assertSameOrigin(req);
    const member = await dependencies.resolveMember();
    if (!MEMBER_ID.test(member.id)) throw new MemberError(401, 'Log in to open your Mona workspace.');
    const memberId = member.id.toLowerCase(), key = `workspaces/${memberId}`;
    const stored = await store.getWithMetadata(key, {type: 'json'});
    if (stored && (stored.data == null || typeof stored.etag !== 'string' || !stored.etag)) throw new Error('Unreadable saved Mona record');
    // Corrupt or mismatched data fails closed; it must never be overwritten by an empty default.
    const current = readWorkspace(stored?.data ?? null, memberId);
    if (req.method === 'GET') return memberJSON(current);
    const input = await body(req);
    const allowed = input.action === 'preferences' ? ['action', 'revision', 'preferences'] : input.action === 'payment-preferences' ? ['action', 'revision', 'paymentPreferences'] : input.action === 'tax-review' ? ['action', 'revision'] : input.action === 'update' ? ['action', 'revision', 'leadId', 'status', 'notes'] : input.action === 'save' ? ['action', 'revision', 'leadId', 'checkedAt'] : ['action', 'revision', 'leadId'];
    if (Object.keys(input).some(field => !allowed.includes(field))) throw new MemberError(400, 'Send only the change you selected in Mona.');
    if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision) throw new MemberError(409, 'Your Mona workspace changed in another tab. Reload it before saving.');
    const now = (dependencies.now ?? (() => new Date()))(), updatedAt = now.toISOString();
    let preferences = current.preferences, leads = [...current.leads];
    let paymentPreferences = current.paymentPreferences, taxReviewedAt = current.taxReviewedAt;
    if (input.action === 'preferences') preferences = scoutInput(input.preferences);
    else if (input.action === 'payment-preferences') paymentPreferences = parsePaymentPreferences(input.paymentPreferences);
    else if (input.action === 'tax-review') taxReviewedAt = updatedAt;
    else {
      if (typeof input.leadId !== 'string' || !/^[a-f0-9]{24}$/.test(input.leadId)) throw new MemberError(400, 'Choose an opportunity from Mona.');
      const index = leads.findIndex(lead => lead.id === input.leadId);
      if (input.action === 'save') {
        if (!iso(input.checkedAt)) throw new MemberError(400, 'Choose a current opportunity from Mona.');
        if (index >= 0) return memberJSON(current);
        if (leads.length >= MAX_LEADS) throw new MemberError(400, 'Your list has 50 opportunities. Remove one before saving another.');
        const cache = await store.get(`scouts/${memberId}`, {type: 'json'});
        const age = iso(cache?.checkedAt) ? now.getTime() - Date.parse(cache.checkedAt) : NaN;
        const candidate = Array.isArray(cache?.leads) ? cache.leads.find((lead: any) => lead?.id === input.leadId) : null;
        const lead = readScoutLead(candidate);
        if (!Number.isFinite(age) || age < -60000 || age > CACHE_AGE || !lead || lead.checkedAt !== cache.checkedAt || input.checkedAt !== cache.checkedAt ||
            (lead.deadline && lead.deadline < updatedAt.slice(0, 10))) throw new MemberError(409, 'Run Find opportunities again to refresh this source before saving it.');
        leads.unshift({...lead, status: 'saved', notes: '', savedAt: updatedAt, updatedAt});
      } else if (input.action === 'update') {
        if (index < 0) throw new MemberError(404, 'This opportunity is no longer in your saved list.');
        if (!STATUSES.includes(input.status as any)) throw new MemberError(400, 'Choose a valid progress status.');
        leads[index] = {...leads[index], status: input.status as SavedLead['status'], notes: notes(input.notes), updatedAt};
      } else if (input.action === 'remove') {
        if (index < 0) throw new MemberError(404, 'This opportunity is no longer in your saved list.');
        leads.splice(index, 1);
      } else throw new MemberError(400, 'Choose a Mona workspace action.');
    }
    const next: Workspace = {memberId, revision: current.revision + 1, preferences, leads, paymentPreferences, taxReviewedAt, updatedAt};
    // Installed Blobs SDK 11 supports atomic conditions. Protect updates across tabs/devices.
    const result = await store.setJSON(key, next, stored ? {onlyIfMatch: stored.etag} : {onlyIfNew: true});
    if (!result.modified) throw new MemberError(409, 'Your Mona workspace changed in another tab. Reload it before saving.');
    return memberJSON(next);
  } catch (error) { return monaWorkspaceFailure(error); }
}
