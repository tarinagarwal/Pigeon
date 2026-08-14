import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const KNOWN_TAGS = ["plans"] as const;
const KNOWN_PATHS = ["/features", "/"] as const;

export async function POST(req: NextRequest) {
  let body: { secret?: string; tags?: string[]; paths?: string[] };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!process.env.REVALIDATE_SECRET) {
    console.error("[revalidate] REVALIDATE_SECRET env var is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  if (body.secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const tagsToInvalidate = body.tags?.length ? body.tags : [...KNOWN_TAGS];
  const pathsToInvalidate = body.paths?.length ? body.paths : [...KNOWN_PATHS];

  const revalidatedTags: string[] = [];
  const revalidatedPaths: string[] = [];

  for (const tag of tagsToInvalidate) {
    revalidateTag(tag, "max");
    revalidatedTags.push(tag);
  }

  for (const path of pathsToInvalidate) {
    revalidatePath(path);
    revalidatedPaths.push(path);
  }

  console.log("[revalidate] Cache invalidated →", { tags: revalidatedTags, paths: revalidatedPaths });

  return NextResponse.json({
    revalidated: true,
    tags: revalidatedTags,
    paths: revalidatedPaths,
    timestamp: new Date().toISOString(),
  });
}
