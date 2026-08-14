import { redirect } from "next/navigation";

export default function Home() {
  // Redirect the root of the admin-panel app straight into the admin
  // experience. If you want logged-in admins to bypass the login screen,
  // we can later add a small server-side check here.
  redirect("/admin/login");
}
