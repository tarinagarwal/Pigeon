/** Typed helpers for Rent Your Network admin routes (`/api/admin/ryn/...`). */
import { adminApi } from "@/lib/adminApi";

export async function rynGet<T>(path: string): Promise<T> {
  const { data } = await adminApi.get<T>(path);
  return data;
}

export async function rynPut<T>(path: string, body: unknown): Promise<T> {
  const { data } = await adminApi.put<T>(path, body);
  return data;
}

export async function rynPost<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await adminApi.post<T>(path, body);
  return data;
}

export async function rynDelete(path: string): Promise<void> {
  await adminApi.delete(path);
}
