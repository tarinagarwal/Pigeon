/**
 * Template Builder image upload → Cloudinary.
 * Add to .env or .env.local (Next.js):
 *   CLOUDINARY_CLOUD_NAME=your_cloud_name
 *   CLOUDINARY_API_KEY=your_api_key
 *   CLOUDINARY_API_SECRET=your_api_secret
 */
import { NextRequest, NextResponse } from "next/server";
import cloudinaryPkg from "cloudinary";
const cloudinary = cloudinaryPkg.v2;

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

export async function POST(request: NextRequest) {
  const config = getCloudinaryConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: "Image upload not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to .env.local",
      },
      { status: 503 }
    );
  }

  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  // GrapesJS sends single file as "files", multiple as "files[]"
  const single = formData.get("files");
  const multi = formData.getAll("files[]");
  const file = (single instanceof File ? single : multi[0] instanceof File ? multi[0] : null) as File | null;
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No file uploaded. Use field 'files' or 'files[]'." },
      { status: 400 }
    );
  }

  const type = (file.type || "").toLowerCase();
  if (!ALLOWED_TYPES.includes(type)) {
    return NextResponse.json(
      { error: "Invalid file type. Allowed: JPEG, PNG, GIF, WebP." },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Max 5 MB." },
      { status: 400 }
    );
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const base64 = buffer.toString("base64");
  const dataUri = `data:${file.type};base64,${base64}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      resource_type: "image",
      folder: "pigeon_template_images",
    });
    const url = result?.secure_url;
    if (!url) {
      return NextResponse.json(
        { error: "Upload failed: no URL returned" },
        { status: 502 }
      );
    }
    // GrapesJS Asset Manager expects { data: [ { src, name?, type? } ] }
    return NextResponse.json({
      data: [
        {
          src: url,
          name: file.name || "image",
          type: "image",
        },
      ],
    });
  } catch (e) {
    console.error("[upload-template-image] Cloudinary error:", e);
    return NextResponse.json(
      { error: "Upload failed. Try again." },
      { status: 502 }
    );
  }
}
