"use client";

import { useParams } from "next/navigation";
import TemplateForm from "@/components/TemplateForm";

export default function EditTemplatePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : undefined;

  return <TemplateForm templateId={id} />;
}
