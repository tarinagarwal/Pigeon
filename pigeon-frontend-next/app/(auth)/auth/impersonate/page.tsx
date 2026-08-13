import { ImpersonateClient } from "./ImpersonateClient";

export default async function ImpersonatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params?.token;
  const token =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? null : null;
  return <ImpersonateClient token={token} />;
}
