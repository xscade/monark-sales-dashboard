export const dynamic = "force-dynamic";

/** Liveness probe. Deliberately touches nothing — a database outage should not
 *  make the deployment itself look dead. */
export function GET() {
  return Response.json({ ok: true, service: "monark" });
}
