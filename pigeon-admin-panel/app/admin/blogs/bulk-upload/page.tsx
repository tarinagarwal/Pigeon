"use client";

import { FormEvent, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import {
  BookOpen,
  CheckCircle2,
  Copy,
  FileJson,
  Info,
  TriangleAlert,
} from "lucide-react";

const BLOG_JSON_EXAMPLE = {
  title: "Your blog post title",
  slug: "your-blog-post-slug",
  content:
    "## Introduction\n\nWrite your content in **Markdown**.\n\n- List item 1\n- List item 2\n\n[Link](https://example.com)",
  excerpt: "Short summary for listings and SEO.",
  author: "Author Name",
  featured_image_url:
    "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800",
  tags: ["cold email", "outreach", "deliverability"],
  status: "draft",
  published_at: null as string | null,
};

type PreviewBlog = {
  index: number;
  title: string;
  slug: string;
  status: "draft" | "published";
  author?: string;
  hasContent: boolean;
  featured_image_url?: string;
  error?: string;
};

type BulkResult = {
  created_count: number;
  error_count: number;
  errors: { index: number; title?: string; slug?: string; detail: string | any }[];
};

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[-\s]+/g, "-")
      .replace(/^-+|-+$/g, "") || "blog"
  );
}

export default function BulkUploadBlogsPage() {
  const [rawJson, setRawJson] = useState("");
  const [preview, setPreview] = useState<PreviewBlog[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [copyDone, setCopyDone] = useState(false);

  const handleParse = (e: FormEvent) => {
    e.preventDefault();
    setParseError(null);
    setBulkResult(null);

    const raw = rawJson.trim();
    if (!raw) {
      setParseError("Paste JSON array first");
      setPreview(null);
      return;
    }

    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) {
        setParseError("JSON must be an array of blog objects");
        setPreview(null);
        return;
      }

      if (data.length === 0) {
        setParseError("Array is empty. Add at least one blog object.");
        setPreview(null);
        return;
      }

      const seenSlugs = new Set<string>();
      const previewItems: PreviewBlog[] = data.map((item, idx) => {
        const obj = (item ?? {}) as Record<string, any>;
        const title = typeof obj.title === "string" ? obj.title.trim() : "";
        const rawSlug =
          typeof obj.slug === "string" && obj.slug.trim()
            ? obj.slug.trim()
            : slugify(title || `blog-${idx + 1}`);
        const status: "draft" | "published" =
          obj.status === "published" ? "published" : "draft";

        let error: string | undefined;
        if (!title) {
          error = "Missing required field: title";
        } else if (seenSlugs.has(rawSlug)) {
          error = `Duplicate slug in payload: ${rawSlug}`;
        }

        seenSlugs.add(rawSlug);

        const featuredImageUrl =
          typeof obj.featured_image_url === "string" && obj.featured_image_url.trim()
            ? obj.featured_image_url.trim()
            : undefined;

        return {
          index: idx,
          title: title || "(missing title)",
          slug: rawSlug,
          status,
          author:
            typeof obj.author === "string" && obj.author.trim()
              ? obj.author.trim()
              : undefined,
          hasContent:
            typeof obj.content === "string" && obj.content.trim().length > 0,
          featured_image_url: featuredImageUrl,
          error,
        };
      });

      setPreview(previewItems);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "Invalid JSON. Please check your input."
      );
      setPreview(null);
    }
  };

  const handleUpload = async () => {
    if (!preview || preview.length === 0) return;
    setUploading(true);
    setBulkResult(null);

    try {
      const raw = JSON.parse(rawJson) as any[];
      const res = await adminApi.post<BulkResult>("/admin/blogs/bulk", raw);
      setBulkResult(res.data);
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setBulkResult({
        created_count: 0,
        error_count: 1,
        errors: [{ index: -1, detail: message }],
      });
    } finally {
      setUploading(false);
    }
  };

  const copyExampleArray = async () => {
    const exampleArray = [
      BLOG_JSON_EXAMPLE,
      {
        ...BLOG_JSON_EXAMPLE,
        title: "Second blog post title",
        slug: "second-blog-post-title",
      },
    ];
    const text = JSON.stringify(exampleArray, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    } catch {
      // Fall back to filling the textarea if clipboard fails
      setRawJson(text);
    }
  };

  const hasBlockingErrors = preview?.some((p) => p.error) ?? false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Bulk upload blogs
        </h1>
        <button
          onClick={copyExampleArray}
          className="flex items-center gap-1.5 rounded border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100"
          title="Copy example JSON array for bulk upload"
        >
          <Copy className="h-3.5 w-3.5" />
          {copyDone ? "Copied!" : "Copy example array"}
        </button>
      </div>

      <p className="text-xs text-zinc-600 space-y-1">
        <span className="block">
          Paste a JSON <strong>array of blog objects</strong> using the same fields as
          the single blog creation form: <code>title</code>, <code>slug</code>,{" "}
          <code>content</code>, <code>excerpt</code>, <code>author</code>,{" "}
          <code>tags</code>, <code>featured_image_url</code>, <code>status</code>,{" "}
          <code>published_at</code>.
        </span>
        <span className="block mt-1">
          First click <strong>Parse &amp; preview</strong> to validate and review all
          blogs. Then click <strong>Upload blogs</strong> to create them in bulk.
          Uploads are processed in parallel by multiple workers for faster results.
        </span>
      </p>

      <form onSubmit={handleParse} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-1">
            JSON array of blogs
          </label>
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            rows={14}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-xs font-mono leading-snug"
            placeholder={`[\n  ${JSON.stringify(BLOG_JSON_EXAMPLE, null, 2)
              .split("\n")
              .join("\n  ")}\n]`}
          />
        </div>

        {parseError && (
          <p className="text-xs text-red-600 flex items-center gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5" />
            {parseError}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Info className="h-3.5 w-3.5" />
            Titles are required. Slugs are auto-generated from titles if missing.
            Duplicate slugs in the payload or existing database will be rejected per-item.
          </div>
          <button
            type="submit"
            className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
          >
            Parse &amp; preview
          </button>
        </div>
      </form>

      {preview && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-700">
              Previewing <strong>{preview.length}</strong> blog
              {preview.length === 1 ? "" : "s"}.{" "}
              {hasBlockingErrors ? (
                <span className="text-red-600 ml-1">
                  Fix rows with errors before uploading.
                </span>
              ) : (
                <span className="text-emerald-700 ml-1 flex items-center gap-1 inline-flex">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Ready to upload.
                </span>
              )}
            </p>
            <button
              type="button"
              disabled={uploading || preview.length === 0}
              onClick={handleUpload}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {uploading ? "Uploading…" : "Upload blogs"}
            </button>
          </div>

          <div className="overflow-x-auto rounded border bg-white max-h-96">
            <table className="min-w-full border-collapse text-xs">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                    #
                  </th>
                  <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                    Title
                  </th>
                  <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                    Slug
                  </th>
                  <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                    Status
                  </th>
                  <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                    Author
                  </th>
                  <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                    Featured image
                  </th>
                  <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                    Content
                  </th>
                  <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                    Row error
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr
                    key={p.index}
                    className={
                      p.error ? "bg-red-50/40 hover:bg-red-50" : "hover:bg-zinc-50"
                    }
                  >
                    <td className="border-b px-2 py-1 align-top text-zinc-500">
                      {p.index + 1}
                    </td>
                    <td className="border-b px-2 py-1 align-top font-medium max-w-xs truncate">
                      {p.title}
                    </td>
                    <td className="border-b px-2 py-1 align-top font-mono text-[11px] max-w-xs truncate">
                      {p.slug}
                    </td>
                    <td className="border-b px-2 py-1 align-top">
                      <span
                        className={
                          p.status === "published"
                            ? "px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "px-1.5 py-0.5 rounded text-[10px] bg-zinc-50 text-zinc-600 border border-zinc-200"
                        }
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="border-b px-2 py-1 align-top text-zinc-600">
                      {p.author || "—"}
                    </td>
                    <td className="border-b px-2 py-1 align-top">
                      {p.featured_image_url ? (
                        <a
                          href={p.featured_image_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block rounded border border-zinc-200 overflow-hidden bg-zinc-100 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                          title={p.featured_image_url}
                        >
                          <img
                            src={p.featured_image_url}
                            alt=""
                            className="h-12 w-12 object-cover"
                          />
                        </a>
                      ) : (
                        <span className="text-zinc-400 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="border-b px-2 py-1 align-top text-zinc-600">
                      {p.hasContent ? "Yes" : "No"}
                    </td>
                    <td className="border-b px-2 py-1 align-top text-[11px] text-red-600 max-w-xs truncate">
                      {p.error || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {bulkResult && (
        <div className="rounded border bg-white p-3 text-xs space-y-1">
          <div className="flex items-center gap-1.5">
            {bulkResult.error_count > 0 ? (
              <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            )}
            <span className="font-medium text-zinc-800">
              Bulk upload result: created {bulkResult.created_count} blog
              {bulkResult.created_count === 1 ? "" : "s"},{" "}
              {bulkResult.error_count} error
              {bulkResult.error_count === 1 ? "" : "s"}.
            </span>
          </div>
          {bulkResult.errors.length > 0 && (
            <ul className="list-disc list-inside text-zinc-700 max-h-40 overflow-y-auto mt-1">
              {bulkResult.errors.map((err, i) => (
                <li key={i}>
                  Row {err.index >= 0 ? err.index + 1 : "?"}: {err.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

