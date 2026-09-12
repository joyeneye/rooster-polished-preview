export const TOP_EIGHT = [
  { id: "NSZ26l3DIKE", title: "Spend Dat", artist: "Yung Miami" },
  { id: "PEGccV-NOm8", title: "Bodak Yellow", artist: "Cardi B" },
  { id: "xTlNMmZKwpA", title: "I Like It", artist: "Cardi B, Bad Bunny & J Balvin" },
  { id: "lEIqjoO0-Bs", title: "Savage Remix", artist: "Megan Thee Stallion feat. Beyoncé" },
  { id: "DmWWqogr_r8", title: "a lot", artist: "21 Savage feat. J. Cole" },
  { id: "Zj2cK8wymIA", title: "Money", artist: "Cardi B" },
  { id: "phtcAd8j6Ro", title: "What It Is", artist: "Doechii feat. Kodak Black" },
  { id: "NEnephbahLA", title: "30 For 30", artist: "SZA feat. Kendrick Lamar" },
] as const;
export const DEFAULT_TOP_EIGHT: readonly string[] = TOP_EIGHT.map(track => track.id);
export function readTopEightOrder(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length !== 8 || new Set(value).size !== 8 || value.some(id => typeof id !== "string" || !DEFAULT_TOP_EIGHT.includes(id))) return null;
  return [...value];
}
