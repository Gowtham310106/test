import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson, requireUser } from "@/lib/api";
import { classifyUpload, sanitizeFileName } from "@/lib/files";
import { presignUpload } from "@/lib/r2";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSettings } from "@/lib/types";

const Body = z.object({
  name: z.string().min(1).max(500),
  size: z.number().int().positive(),
});

// Uploads a student may start per hour; stops the bucket being used as free storage.
const UPLOADS_PER_HOUR = 60;

/** Step 1 of an upload: validate, record it, and hand back a presigned PUT URL. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readJson(request, Body);
  if (!body.ok) return body.response;

  const name = sanitizeFileName(body.data.name);
  const type = classifyUpload(name);
  if (!type) {
    return jsonError("This file type isn't supported. Upload a PDF, Word document or a JPG/PNG photo.", 400);
  }

  const admin = createAdminClient();
  const { data: settings } = await admin.from("app_settings").select("*").eq("id", 1).single<AppSettings>();
  if (!settings) return jsonError("The service is not set up yet.", 503);
  if (!settings.accepting_orders) return jsonError(settings.closed_message, 409);

  const maxBytes = settings.max_file_mb * 1024 * 1024;
  if (body.data.size > maxBytes) {
    return jsonError(`Files can be up to ${settings.max_file_mb} MB. Compress it or split it into parts.`, 413);
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("files")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", auth.userId)
    .gte("created_at", since);
  if ((count ?? 0) >= UPLOADS_PER_HOUR) {
    return jsonError("Too many uploads in the last hour. Please wait a little and try again.", 429);
  }

  const objectKey = `uploads/${auth.userId}/${crypto.randomUUID()}.${type.ext}`;
  const { data: file, error } = await admin
    .from("files")
    .insert({
      owner_id: auth.userId,
      object_key: objectKey,
      original_name: name,
      mime_type: type.mime,
      kind: type.kind,
      size_bytes: body.data.size,
    })
    .select("id")
    .single();
  if (error || !file) {
    console.error("file insert failed", error);
    return jsonError("Couldn't start the upload. Please try again.", 500);
  }

  const uploadUrl = await presignUpload(objectKey, type.mime, body.data.size);
  return NextResponse.json({
    fileId: file.id,
    uploadUrl,
    headers: { "Content-Type": type.mime },
    name,
    kind: type.kind,
  });
}
