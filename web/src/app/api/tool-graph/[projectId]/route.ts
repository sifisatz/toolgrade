import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { member, organization, projects } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { buildProjectToolGraph } from "@/lib/tool-graph";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const user = await requireUser();
  const { projectId } = await params;

  // Verify the user has membership access to the org that owns this project
  const db = await getDb();
  const [found] = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(organization, eq(projects.orgId, organization.id))
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(and(eq(projects.id, projectId), eq(member.userId, user.id)))
    .limit(1);

  if (!found) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const graph = await buildProjectToolGraph(found.project.id);
  return NextResponse.json(graph);
}
