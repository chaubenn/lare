import { permanentRedirect } from "next/navigation";

/** Follow requests moved into the friends tab; keep the old link working. */
export default function RequestsPage(): never {
  permanentRedirect("/friends?tab=requests");
}
