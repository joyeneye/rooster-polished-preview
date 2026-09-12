// How long a removed photo or video can still be brought back.
//
// Removing media happens in two steps. The record that publishes the picture or
// the video is deleted straight away, so the item disappears from the profile,
// the gallery, the wall and the video section for everybody and stays gone
// after a refresh. The picture or video file itself is kept for a short while
// behind a removal record, so an accidental tap can be undone. Once the window
// has passed the file and its records are deleted for good.
export const MEDIA_UNDO_MS = 30_000;
// What the Undo button offers. Shorter than the server window so a member who
// taps Undo on the last second is still inside it.
export const MEDIA_UNDO_SECONDS = 8;
// One tap in Manage Media can remove several items at once.
export const MAX_MEDIA_BATCH = 20;

export function withinUndoWindow(removedAt: string, now = Date.now()): boolean {
  const stamp = Date.parse(removedAt);
  return Number.isFinite(stamp) && now - stamp <= MEDIA_UNDO_MS;
}
