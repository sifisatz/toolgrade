import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { member, organization, projects, runs } from "@/db/schema";
import { requireUser } from "@/lib/session";

const AnnotationSchema = z.object({
  rating: z.union([z.literal(1), z.literal(-1), z.null()]),
  note: z.string().max(500).optional(),
});

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  const { runId } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(runId)) {
    return json({ error: "invalid run id" }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const parsed = AnnotationSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  }

  const db = await getDb();

  // Verify the run belongs to a project the user has access to via org membership
  const [found] = await db
    .select({ runId: runs.id })
    .from(runs)
    .innerJoin(projects, eq(runs.projectId, projects.id))
    .innerJoin(organization, eq(projects.orgId, organization.id))
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(and(eq(runs.id, runId), eq(member.userId, user.id)))
    .limit(1);

  if (!found) {
    return json({ error: "run not found" }, 404);
  }

  const { rating, note } = parsed.data;
  await db
    .update(runs)
    .set({
      annotationRating: rating,
      ...(note !== undefined ? { annotationNote: note } : {}),
    })
    .where(eq(runs.id, runId));

  return json({ ok: true });
}
