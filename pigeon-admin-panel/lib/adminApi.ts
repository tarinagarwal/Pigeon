import axios, { AxiosError, AxiosInstance } from "axios";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001/api";

function createAdminClient(): AxiosInstance {
  const instance = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true, // send HTTP-only auth cookie (same as user frontend)
  });

  instance.interceptors.response.use(
    (response) => response,
    (error: AxiosError<any>) => {
      if ((error.response?.status === 401 || error.response?.status === 403) && typeof window !== "undefined") {
        if (!window.location.pathname.startsWith("/admin/login")) {
          window.location.href = "/admin/login";
        }
      }
      return Promise.reject(error);
    },
  );

  return instance;
}

export const adminApi = createAdminClient();

export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    
    // Handle FastAPI validation errors
    if (data?.detail && Array.isArray(data.detail)) {
      const errors = data.detail.map((e: any) => {
        const field = e.loc?.join('.') || 'field';
        return `${field}: ${e.msg}`;
      }).join(', ');
      return errors || 'Validation error';
    }
    
    // Handle string detail
    if (typeof data?.detail === 'string') {
      return data.detail;
    }
    
    // Handle object detail (convert to string)
    if (data?.detail && typeof data.detail === 'object') {
      return JSON.stringify(data.detail);
    }
    
    // Fallback to error message
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

