import { redirect } from "next/navigation";

export default async function InboxIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  if (view === "mailbox") {
    redirect("/inbox/mailbox");
  }
  redirect("/inbox/campaign-replies");
}
