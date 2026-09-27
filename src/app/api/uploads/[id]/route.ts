import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { imageMime, signatureMatches, sniffSignature } from "@/lib/files";
import { countPages } from "@/lib/page-count";
import { deleteObjects, getObjectBytes, headObject, putObject } from "@/lib/r2";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FileRow } from "@/lib/types";

export const maxDuration = 60;

function summary(file: FileRow, warning?: string) {
  return {
    id: file.id,
    name: file.original_name,
    kind: file.kind,
    size: file.size_bytes,
    status: file.status,
    pageDetection: file.page_detection,
    pages: file.detected_pages,
    encrypted: file.is_encrypted,
    error: file.error,
    warning: warning ?? null,
  };
}

/**
 * Step 2 of an upload: the browser finished the PUT. Check the object really
 * is what it claims to be and count its pages on the server, so page counts
 * (and so prices) never come from the browser. The verified bytes are then
 * stored under a new key: the upload URL stays valid for a few minutes, and a
 * second PUT to it must not swap in a longer file after counting.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const { data: file } = await admin
    .from("files")
    .select("*")
    .eq("id", id)
    .eq("owner_id", auth.userId)
    .maybeSingle<FileRow>();
  if (!file) return jsonError("Upload not found.", 404);
  if (file.status !== "pending") return NextResponse.json(summary(file));

  const reject = async (reason: string) => {
    await deleteObjects([file.object_key]).catch(() => undefined);
    const { data } = await admin
      .from("files")
      .update({ status: "rejected", error: reason, page_detection: "none" })
      .eq("id", file.id)
      .select("*")
      .single<FileRow>();
    return NextResponse.json(summary(data ?? file), { status: 422 });
  };

  const head = await headObject(file.object_key);
  if (!head) return jsonError("The upload didn't reach the server. Please try again.", 409);
  if (head.size !== file.size_bytes) return reject("The upload was incomplete. Please upload the file again.");

  const bytes = await getObjectBytes(file.object_key);
  if (bytes.length !== file.size_bytes) return reject("The upload was incomplete. Please upload the file again.");
  const signature = sniffSignature(bytes);
  if (!signatureMatches(file.kind, signature)) {
    return reject(`This file isn't a real ${file.kind === "image" ? "photo" : file.kind.toUpperCase()} file. Save it again and re-upload.`);
  }

  const result = await countPages(bytes, file.kind);
  if (result.rejectReason) return reject(result.rejectReason);

  const mimeType = file.kind === "image" ? imageMime(signature) : file.mime_type;
  // A fresh key per attempt, so a concurrent duplicate request can't clobber this one.
  const ext = file.object_key.split(".").pop();
  const verifiedKey = `files/${auth.userId}/${crypto.randomUUID()}.${ext}`;
  await putObject(verifiedKey, bytes, mimeType);

  const { data: updated, error } = await admin
    .from("files")
    .update({
      object_key: verifiedKey,
      status: "ready",
      page_detection: result.detection,
      detected_pages: result.pages,
      is_encrypted: result.encrypted,
      mime_type: mimeType,
      uploaded_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", file.id)
    .eq("status", "pending")
    .select("*")
    .single<FileRow>();
  if (error || !updated) {
    await deleteObjects([verifiedKey]).catch(() => undefined);
    return jsonError("Couldn't finish the upload. Please try again.", 500);
  }
  await deleteObjects([file.object_key]).catch(() => undefined);

  return NextResponse.json(summary(updated, result.warning));
}

/** Removes a file the student added to a draft and then took out again. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const { data: file } = await admin
    .from("files")
    .select("id, object_key, status")
    .eq("id", id)
    .eq("owner_id", auth.userId)
    .maybeSingle();
  if (!file) return jsonError("Upload not found.", 404);

  // Files already on an order stay until the retention clean-up removes them.
  const { count } = await admin.from("order_items").select("id", { count: "exact", head: true }).eq("file_id", id);
  if ((count ?? 0) > 0) return NextResponse.json({ ok: true, kept: true });

  await deleteObjects([file.object_key]).catch(() => undefined);
  await admin.from("files").update({ status: "deleted", deleted_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true });
}
