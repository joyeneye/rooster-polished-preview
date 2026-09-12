import type { ProfileStore } from "./member-profiles.mts";
export async function verificationStatus(store: ProfileStore, id: string, owner: boolean) {
  if (owner) return { verified: true, verified_owner: true };
  const record = await store.get(`verifications/${id}`, { type: "json" });
  return { verified: record?.id === id && record?.verified === true, verified_owner: false };
}
