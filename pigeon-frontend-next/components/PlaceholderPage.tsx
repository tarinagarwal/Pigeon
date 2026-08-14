import Link from "next/link";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">Page content will be migrated here.</p>
      <Link href="/" className="text-primary hover:underline">Back to home</Link>
    </div>
  );
}
