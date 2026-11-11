/**
 * Mirror of `private.is_owned_storage_path` (migration 0031): at least two segments, the first is
 * the owner's id, and none is empty, `.` or `..` or contains a backslash. Every path column is
 * checked with it in the database; service-role storage calls check it again because they ignore
 * storage policies and a row written before 0031 was never checked.
 */
export function isOwnStoragePath(path: string, userId: string): boolean {
  if (!userId || path.includes("\\")) return false;
  const parts = path.split("/");
  return (
    parts.length >= 2 &&
    parts[0] === userId &&
    parts.every((part) => part !== "" && part !== "." && part !== "..")
  );
}
