"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { BookOpen, Copy, FileJson, ImagePlus, Link as LinkIcon } from "lucide-react";

/** Example JSON for a new blog (API payload shape). Use "Copy example" to copy this. */
const BLOG_JSON_EXAMPLE = {
  title: "Your blog post title",
  slug: "your-blog-post-slug",
  content: "## Introduction\n\nWrite your content in **Markdown**.\n\n- List item 1\n- List item 2\n\n[Link](https://example.com)",
  excerpt: "Short summary for listings and SEO.",
  author: "Author Name",
  featured_image_url: "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800",
  tags: ["cold email", "outreach", "deliverability"],
  status: "draft",
  published_at: null as string | null,
};

type Blog = {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  author?: string;
  featured_image_url?: string;
  tags?: string[];
  status: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[-\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "blog";
}

const INITIAL_LIMIT = 100;

export default function AdminBlogsPage() {
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [total, setTotal] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<"upload" | "link">("link");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [copyDone, setCopyDone] = useState(false);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [content, setContent] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [author, setAuthor] = useState("");
  const [featuredImageUrl, setFeaturedImageUrl] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [publishedAt, setPublishedAt] = useState("");
  const [tags, setTags] = useState("");

  const fetchBlogs = useCallback(async (limit?: number) => {
    const effectiveLimit = limit ?? INITIAL_LIMIT;
    const isFullLoad = limit !== undefined && limit > INITIAL_LIMIT;
    if (isFullLoad) {
      setLoadingAll(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await adminApi.get<{ blogs: Blog[]; total: number }>("/admin/blogs", {
        params: { limit: effectiveLimit },
      });
      setBlogs(res.data.blogs ?? []);
      setTotal(res.data.total ?? 0);
      if (isFullLoad) setShowAll(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load blogs");
    } finally {
      setLoading(false);
      setLoadingAll(false);
    }
  }, []);

  const loadAllBlogs = useCallback(async () => {
    setLoadingAll(true);
    setError(null);
    try {
      const res = await adminApi.get<{ blogs: Blog[]; total: number }>("/admin/blogs", {
        params: { limit: 10000 },
      });
      setBlogs(res.data.blogs ?? []);
      setTotal(res.data.total ?? 0);
      setShowAll(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load all blogs");
    } finally {
      setLoadingAll(false);
    }
  }, []);

  useEffect(() => {
    fetchBlogs();
  }, [fetchBlogs]);

  const openCreate = () => {
    setEditingId(null);
    setTitle("");
    setSlug("");
    setContent("");
    setExcerpt("");
    setAuthor("");
    setFeaturedImageUrl("");
    setTags("");
    setStatus("draft");
    setPublishedAt("");
    setImageMode("link");
    setFormOpen(true);
  };

  const openEdit = (blog: Blog) => {
    setEditingId(blog.id);
    setTitle(blog.title);
    setSlug(blog.slug);
    setContent(blog.content ?? "");
    setExcerpt(blog.excerpt ?? "");
    setAuthor(blog.author ?? "");
    setFeaturedImageUrl(blog.featured_image_url ?? "");
    setTags(Array.isArray(blog.tags) ? blog.tags.join(", ") : "");
    setStatus((blog.status as "draft" | "published") || "draft");
    setPublishedAt(blog.published_at ? blog.published_at.slice(0, 16) : "");
    setImageMode(blog.featured_image_url ? "link" : "link");
    setFormOpen(true);
  };

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (!editingId) setSlug(slugify(v));
  };

  const handleChooseImage = () => {
    setError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (e.g. JPEG, PNG).");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/cloudinary", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Upload failed (${res.status})`);
        return;
      }
      if (data.url) {
        setFeaturedImageUrl(data.url);
        setImageMode("upload");
      } else {
        setError("Upload succeeded but no URL returned.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const tagsArray = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const payload = {
      title,
      slug: slug || slugify(title),
      content,
      excerpt: excerpt || undefined,
      author: author || undefined,
      featured_image_url: featuredImageUrl.trim() || "",
      tags: tagsArray,
      status,
      published_at: status === "published" && publishedAt ? new Date(publishedAt).toISOString() : undefined,
    };
    try {
      if (editingId) {
        await adminApi.put(`/admin/blogs/${editingId}`, payload);
      } else {
        await adminApi.post("/admin/blogs", payload);
      }
      setFormOpen(false);
      setEditingId(null);
      await fetchBlogs(showAll ? 10000 : INITIAL_LIMIT);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to save blog");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this blog?")) return;
    try {
      await adminApi.delete(`/admin/blogs/${id}`);
      await fetchBlogs(showAll ? 10000 : INITIAL_LIMIT);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete");
    }
  };

  const copyExample = async () => {
    const text = JSON.stringify(BLOG_JSON_EXAMPLE, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    } catch {
      setError("Could not copy to clipboard");
    }
  };

  const openImport = () => {
    setImportJson("");
    setImportOpen(true);
  };

  const applyImport = () => {
    setError(null);
    try {
      const raw = importJson.trim();
      if (!raw) {
        setError("Paste JSON first");
        return;
      }
      const data = JSON.parse(raw) as Record<string, unknown>;
      const titleVal = typeof data.title === "string" ? data.title : "";
      const slugVal = typeof data.slug === "string" ? data.slug : slugify(titleVal) || "blog";
      const contentVal = typeof data.content === "string" ? data.content : "";
      const excerptVal = typeof data.excerpt === "string" ? data.excerpt : "";
      const authorVal = typeof data.author === "string" ? data.author : "";
      const imageVal = typeof data.featured_image_url === "string" ? data.featured_image_url : "";
      const statusVal = data.status === "published" ? "published" : "draft";
      let publishedAtVal = "";
      if (data.published_at) {
        const d = new Date(data.published_at as string);
        if (!Number.isNaN(d.getTime())) publishedAtVal = d.toISOString().slice(0, 16);
      }
      let tagsVal = "";
      if (Array.isArray(data.tags)) {
        tagsVal = data.tags.filter((t: unknown) => typeof t === "string").join(", ");
      } else if (typeof data.tags === "string") {
        tagsVal = data.tags;
      }
      setEditingId(null);
      setTitle(titleVal);
      setSlug(slugVal);
      setContent(contentVal);
      setExcerpt(excerptVal);
      setAuthor(authorVal);
      setFeaturedImageUrl(imageVal);
      setTags(tagsVal);
      setStatus(statusVal);
      setPublishedAt(publishedAtVal);
      setImageMode(imageVal ? "link" : "link");
      setImportOpen(false);
      setFormOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { dateStyle: "short" });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Blogs
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fetchBlogs(showAll ? 10000 : INITIAL_LIMIT)}
            className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
          >
            Refresh
          </button>
          <button
            onClick={copyExample}
            className="flex items-center gap-1.5 rounded border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100"
            title="Copy example JSON for a new blog"
          >
            <Copy className="h-3.5 w-3.5" />
            {copyDone ? "Copied!" : "Copy example"}
          </button>
          <button
            onClick={openImport}
            className="flex items-center gap-1.5 rounded border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100"
            title="Paste JSON to fill the new blog form"
          >
            <FileJson className="h-3.5 w-3.5" />
            Import from JSON
          </button>
          <button
            onClick={openCreate}
            className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800"
          >
            New blog
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-600">
        Manage blog posts. Use markdown for content. Featured image: upload via Cloudinary or paste a URL.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {total > 0 && (
        <p className="text-xs text-zinc-600">
          {showAll
            ? `Showing all ${total} blog${total === 1 ? "" : "s"}.`
            : total > INITIAL_LIMIT
              ? `Showing latest ${blogs.length} of ${total} blogs.`
              : `Showing ${total} blog${total === 1 ? "" : "s"}.`}
          {total > INITIAL_LIMIT && !showAll && (
            <button
              type="button"
              onClick={loadAllBlogs}
              disabled={loadingAll}
              className="ml-2 rounded bg-zinc-800 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {loadingAll ? "Loading…" : "Load all"}
            </button>
          )}
        </p>
      )}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-zinc-50">
            <tr>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Title</th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Slug</th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Status</th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Published</th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Image</th>
              <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {blogs.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-zinc-500">
                  No blogs yet. Create one to get started.
                </td>
              </tr>
            )}
            {blogs.map((b) => (
              <tr key={b.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2 font-medium">{b.title}</td>
                <td className="border-b px-2 py-2 font-mono text-[11px]">{b.slug}</td>
                <td className="border-b px-2 py-2">
                  <span className={b.status === "published" ? "text-green-700" : "text-zinc-500"}>
                    {b.status}
                  </span>
                </td>
                <td className="border-b px-2 py-2">{b.published_at ? formatDate(b.published_at) : "—"}</td>
                <td className="border-b px-2 py-2">
                  {b.featured_image_url ? (
                    <img src={b.featured_image_url} alt="" className="h-8 w-12 object-cover rounded" />
                  ) : (
                    "—"
                  )}
                </td>
                <td className="border-b px-2 py-2 text-right space-x-1">
                  <button
                    onClick={() => openEdit(b)}
                    className="rounded bg-zinc-100 px-2 py-1 text-[11px] font-medium hover:bg-zinc-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(b.id)}
                    className="rounded bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="text-xs text-zinc-500">Loading…</p>}

      {formOpen && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/30 py-8">
          <div className="w-full max-w-2xl rounded-lg border bg-white shadow-lg">
            <div className="border-b px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">
                {editingId ? "Edit blog" : "New blog"}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded p-1 hover:bg-zinc-100 text-zinc-600"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Title *</label>
                <input
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  required
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Slug *</label>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm font-mono"
                  placeholder="url-friendly-slug"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Content (Markdown)</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={8}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Excerpt</label>
                <input
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Author</label>
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Tags</label>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                  placeholder="cold email, outreach, deliverability"
                />
                <p className="text-[11px] text-zinc-500 mt-0.5">Comma-separated. Shown on the blog page.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-2">Featured image</label>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setImageMode("upload")}
                    className={`flex items-center gap-1 rounded border px-3 py-1.5 text-xs ${imageMode === "upload" ? "border-zinc-900 bg-zinc-100" : "border-zinc-300"}`}
                  >
                    <ImagePlus className="h-3.5 w-3.5" /> Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageMode("link")}
                    className={`flex items-center gap-1 rounded border px-3 py-1.5 text-xs ${imageMode === "link" ? "border-zinc-900 bg-zinc-100" : "border-zinc-300"}`}
                  >
                    <LinkIcon className="h-3.5 w-3.5" /> Enter link
                  </button>
                  {featuredImageUrl && (
                    <button
                      type="button"
                      onClick={() => { setFeaturedImageUrl(""); setError(null); }}
                      className="flex items-center gap-1 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 hover:bg-red-100"
                    >
                      Remove image (no image)
                    </button>
                  )}
                </div>
                {imageMode === "upload" && (
                  <div className="space-y-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <button
                      type="button"
                      onClick={handleChooseImage}
                      disabled={uploading}
                      className="rounded border border-zinc-300 px-3 py-2 text-xs hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {uploading ? "Uploading…" : "Choose image (Cloudinary)"}
                    </button>
                    {featuredImageUrl && (
                      <div className="flex items-center gap-2">
                        <img src={featuredImageUrl} alt="" className="h-20 w-28 object-cover rounded border" />
                      </div>
                    )}
                  </div>
                )}
                {imageMode === "link" && (
                  <>
                    <input
                      type="url"
                      value={featuredImageUrl}
                      onChange={(e) => setFeaturedImageUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                    />
                    {featuredImageUrl && (
                      <img src={featuredImageUrl} alt="" className="mt-2 h-20 w-28 object-cover rounded border" />
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as "draft" | "published")}
                    className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">Published at (optional)</label>
                  <input
                    type="datetime-local"
                    value={publishedAt}
                    onChange={(e) => setPublishedAt(e.target.value)}
                    className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  {editingId ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/30 py-8">
          <div className="w-full max-w-xl rounded-lg border bg-white shadow-lg">
            <div className="border-b px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                <FileJson className="h-4 w-4" />
                Import from JSON
              </h2>
              <button
                type="button"
                onClick={() => { setImportOpen(false); setError(null); }}
                className="rounded p-1 hover:bg-zinc-100 text-zinc-600"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-zinc-600">
                Paste JSON for a new blog (e.g. from &quot;Copy example&quot;). Fields: title, slug, content, excerpt, author, tags, featured_image_url, status, published_at.
              </p>
              <textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder='{"title": "...", "slug": "...", "content": "...", ...}'
                rows={12}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-xs font-mono"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setImportOpen(false); setError(null); }}
                  className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyImport}
                  className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Apply & open form
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
