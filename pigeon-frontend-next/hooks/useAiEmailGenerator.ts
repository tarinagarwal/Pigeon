import { useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface GeneratedEmail {
  subject: string;
  body: string;
}

interface GenerateEmailOptions {
  prompt: string;
  provider?: string;
}

export function useAiEmailGenerator(userId: string) {
  const [loading, setLoading] = useState(false);

  const generateEmail = async (options: GenerateEmailOptions): Promise<GeneratedEmail | null> => {
    if (!userId) {
      toast.error("You must be logged in to use AI generation.");
      return null;
    }
    setLoading(true);
    try {
      const provider = options.provider ?? "openai";
      const response = await api.llm.generateTemplate(userId, provider, options.prompt);
      const content = response.content ?? "";
      const subjectMatch = content.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
      const bodyMatch = content.match(/BODY:\s*([\s\S]+)/i);
      const subject = subjectMatch?.[1]?.trim() ?? "New outreach email subject";
      const body = (bodyMatch?.[1] ?? content).trim();
      return { subject, body };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate email with AI.");
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { generateEmail, loading };
}
