// The invite-only production deploy became reachable at this exact time.
// Accounts that existed before then were already members and keep access.
export const ACCESS_LAUNCHED_AT = "2026-09-08T06:08:30.204Z";

export type CutoverAccessRow = {
  status: string;
  grandfathered: boolean;
  decidedAt: Date | string | null;
  accountCreatedAt: Date | string | null;
};

function validTime(value: Date | string | null): number {
  if (!value) return Number.NaN;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : Number.NaN;
}

/** Only the untouched pending accounts accidentally caught by the old,
 * premature cutover are eligible for repair. Explicit Founder decisions and
 * accounts created after the actual launch are never changed. */
export function shouldGrandfatherAtCutover(row: CutoverAccessRow, launchedAt: Date): boolean {
  const createdAt = validTime(row.accountCreatedAt);
  return row.status === "pending"
    && !row.grandfathered
    && !row.decidedAt
    && Number.isFinite(createdAt)
    && createdAt <= launchedAt.getTime();
}

/** Resolve the cutover repair without overwriting a concurrent decision. If
 * another request wins the conditional update, its row is the authority. */
export async function resolveCutoverAccessRepair<Row extends CutoverAccessRow>(
  row: Row,
  launchedAt: Date,
  repair: () => Promise<Row | null>,
  reread: () => Promise<Row | null>,
): Promise<Row | null> {
  if (!shouldGrandfatherAtCutover(row, launchedAt)) return row;
  return await repair() ?? await reread();
}
