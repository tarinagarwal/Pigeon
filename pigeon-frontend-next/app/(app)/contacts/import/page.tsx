"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Upload,
  Download,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { api, ContactUploadError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useContactLists } from "@/hooks/useContacts";
import { HelpLinks } from "@/components/HelpLinks";

const ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function getFileExtension(filename: string): string {
  if (!filename || !filename.includes(".")) return "";
  return "." + filename.split(".").pop()?.toLowerCase() || "";
}

const DB_FIELDS = ["email", "first_name", "last_name", "company", "industry", "location"] as const;
const INITIAL_MAPPING: Record<string, string> = {
  email: "",
  first_name: "",
  last_name: "",
  company: "",
  industry: "",
  location: "",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractValidEmails(raw: string): string[] {
  if (!raw) return [];

  const emails = new Set<string>();

  // First split on commas/semicolons (typical separators in CSV cells)
  const primarySplit = raw.split(/[;,]/);
  for (const segment of primarySplit) {
    // Further split on whitespace to handle "a@b.com c@d.com"
    const tokens = segment
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    for (const token of tokens) {
      if (EMAIL_REGEX.test(token)) {
        emails.add(token);
      }
    }
  }

  return Array.from(emails);
}

function expandContactsWithValidEmails(
  rows: Record<string, unknown>[],
  emailField: string
): Record<string, unknown>[] {
  if (!emailField) return [];

  const expanded: Record<string, unknown>[] = [];

  for (const row of rows) {
    const raw = String(row[emailField] ?? "").trim();
    const emails = extractValidEmails(raw);
    if (!emails.length) continue;

    for (const email of emails) {
      expanded.push({
        ...row,
        [emailField]: email,
      });
    }
  }

  return expanded;
}

export default function ImportContactsPage() {
  const router = useRouter();
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadStep, setUploadStep] = useState<"select" | "mapping" | "saving">("select");
  const [uploadError, setUploadError] = useState<ContactUploadError | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saveProgress, setSaveProgress] = useState<number>(0);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [contactsData, setContactsData] = useState<Record<string, unknown>[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({ ...INITIAL_MAPPING });
  const [addToListMode, setAddToListMode] = useState<"existing" | "new">("existing");
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [newListName, setNewListName] = useState<string>("");

  const { data: contactLists = [] } = useContactLists(userId);

  const handleDownloadExample = () => {
    const csvContent = `email,first_name,last_name,company,title,industry,location
john.doe@example.com,John,Doe,Acme Corp,CEO,Technology,San Francisco
jane.smith@example.com,Jane,Smith,Tech Solutions,CTO,Software,New York
bob.johnson@example.com,Bob,Johnson,StartupCo,Founder,SaaS,Austin`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "contacts_example.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = async (file: File) => {
    const ext = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setUploadError(
        new ContactUploadError({
          code: "INVALID_FILE_TYPE",
          message: `"${file.name}" is not a supported file type.`,
          fix: "Use a CSV (.csv) or Excel (.xlsx, .xls) file. Download the example CSV for the correct format.",
        })
      );
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(
        new ContactUploadError({
          code: "FILE_TOO_LARGE",
          message: `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max ${MAX_FILE_SIZE_MB} MB.`,
          fix: "Split your file or remove columns.",
        })
      );
      return;
    }

    setUploadError(null);
    setSaveProgress(0);
    setSaveStatus("");
    setUploading(true);
    try {
      const result = await api.contacts.upload(userId, file);
      setAvailableFields(result.available_fields || []);
      const data = result.contacts_data ?? result.preview ?? [];
      setContactsData(Array.isArray(data) ? data : []);
      const autoMapping: Record<string, string> = { ...INITIAL_MAPPING };
      for (const dbField of DB_FIELDS) {
        const match = (result.available_fields || []).find(
          (f: string) =>
            f.toLowerCase() === dbField.toLowerCase() ||
            f.toLowerCase().replace(/_/g, "") === dbField.replace(/_/g, "").toLowerCase()
        );
        if (match) autoMapping[dbField] = match;
      }
      setFieldMapping(autoMapping);
      setUploadStep("mapping");
      toast.success(`Parsed ${result.total_rows ?? data.length} contacts`);
    } catch (error: unknown) {
      if (error instanceof ContactUploadError) {
        setUploadError(error);
      } else {
        setUploadError(
          new ContactUploadError({
            code: "UPLOAD_FAILED",
            message: error instanceof Error ? error.message : "Upload failed",
            fix: "Check the file format and try again. Use the example CSV if unsure.",
          })
        );
      }
    } finally {
      setUploading(false);
    }
  };

  const handleSaveContacts = async () => {
    if (!fieldMapping.email || !availableFields.includes(fieldMapping.email)) {
      toast.error("Please map the Email field");
      return;
    }
    if (addToListMode === "existing" && !selectedListId) {
      toast.error("Please select a list");
      return;
    }
    if (addToListMode === "new" && !newListName.trim()) {
      toast.error("Please enter a name for the new list");
      return;
    }

    if (!contactsData.length) {
      toast.error("No contacts to import. Please upload a file again.");
      setUploadStep("select");
      return;
    }

    const validContacts = expandContactsWithValidEmails(contactsData, fieldMapping.email);

    if (!validContacts.length) {
      toast.error("No valid email addresses found. Please check your file and try again.");
      setUploadStep("select");
      return;
    }

    setUploadStep("saving");
    setSaveProgress(0);
    setSaveStatus("Starting import...");

    const total = validContacts.length;
    const batchSize = 100;
    let imported = 0;

    try {
      for (let start = 0; start < total; start += batchSize) {
        const end = Math.min(start + batchSize, total);
        const batch = validContacts.slice(start, end);

        await api.contacts.save(
          userId,
          batch,
          fieldMapping,
          addToListMode === "new" ? newListName.trim() : undefined,
          addToListMode === "existing" ? selectedListId : undefined
        );

        imported = end;
        const percent = Math.round((imported / total) * 100);
        setSaveProgress(percent);
        setSaveStatus(`Imported ${imported} of ${total} contacts...`);
      }

      setSaveProgress(100);
      setSaveStatus(`Imported ${total} of ${total} contacts.`);
      toast.success("Contacts imported successfully!");
      router.push("/contacts");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save contacts");
      setUploadStep("mapping");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/contacts">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Import Contacts</h1>
          <p className="text-muted-foreground">
            Upload a CSV or Excel file to import your contacts
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-8" data-tour="contacts-import-steps">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              uploadStep === "select" ? "bg-primary text-primary-foreground" : "bg-green-500 text-white"
            }`}
          >
            {uploadStep === "select" ? "1" : <CheckCircle className="w-5 h-5" />}
          </div>
          <span className={uploadStep === "select" ? "font-medium" : "text-muted-foreground"}>
            Upload File
          </span>
        </div>
        <div className="flex-1 h-0.5 bg-border mx-4" />
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              uploadStep === "mapping" ? "bg-primary text-primary-foreground" : uploadStep === "saving" ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            {uploadStep === "saving" ? <CheckCircle className="w-5 h-5" /> : "2"}
          </div>
          <span className={uploadStep === "mapping" ? "font-medium" : "text-muted-foreground"}>
            Map Fields
          </span>
        </div>
        <div className="flex-1 h-0.5 bg-border mx-4" />
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              uploadStep === "saving" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            3
          </div>
          <span className={uploadStep === "saving" ? "font-medium" : "text-muted-foreground"}>
            Save
          </span>
        </div>
      </div>

      {uploadStep === "select" && (
        <Card>
          <CardHeader>
            <CardTitle>Step 1: Upload Your File</CardTitle>
            <CardDescription>Choose a CSV or Excel file containing your contacts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10">
                  <AlertCircle className="h-4 w-4 text-warning" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Never use purchased or rented lists</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    These lists often contain Spam Traps—addresses that ISPs use to detect bulk senders. Sending to them can hurt your sender reputation and deliverability.
                  </p>
                </div>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = "";
              }}
            />
            {uploadError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-1 flex-1">
                    <p className="font-medium text-destructive">What happened</p>
                    <p className="text-sm text-foreground">{uploadError.message}</p>
                    <p className="font-medium text-destructive pt-2">What to do</p>
                    <p className="text-sm text-foreground">{uploadError.fix}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    setUploadError(null);
                    fileInputRef.current?.click();
                  }}
                >
                  Try again
                </Button>
              </div>
            )}
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
                uploadError ? "border-destructive/30 hover:border-destructive/50" : "hover:border-primary"
              }`}
              onClick={() => {
                setUploadError(null);
                fileInputRef.current?.click();
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (!file) return;
                const ext = getFileExtension(file.name);
                if (ALLOWED_EXTENSIONS.includes(ext)) handleFileUpload(file);
                else
                  setUploadError(
                    new ContactUploadError({
                      code: "INVALID_FILE_TYPE",
                      message: `"${file.name}" is not a supported file type.`,
                      fix: "Use a CSV (.csv) or Excel (.xlsx, .xls) file.",
                    })
                  );
              }}
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="rounded-full bg-primary/10 p-4" aria-hidden>
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  </div>
                  <p className="text-sm font-medium text-foreground">Processing file...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="w-12 h-12 text-muted-foreground" />
                  <div>
                    <p className="text-lg font-medium">Click to upload or drag and drop</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      CSV, XLSX, or XLS files (max {MAX_FILE_SIZE_MB}MB)
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 pt-4">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Need an example format?</span>
              <Button variant="link" size="sm" className="p-0 h-auto" onClick={handleDownloadExample}>
                <Download className="w-3.5 h-3.5 mr-1" />
                Download Example CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {uploadStep === "mapping" && (
        <Card>
          <CardHeader>
            <CardTitle>Step 2: Map Your Fields</CardTitle>
            <CardDescription>
              Match columns from your file to contact fields. Email is required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              {DB_FIELDS.map((dbField) => (
                <div key={dbField} className="space-y-2">
                  <Label className="flex items-center gap-1">
                    {dbField.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    {dbField === "email" && <span className="text-destructive">*</span>}
                  </Label>
                  <Select
                    value={fieldMapping[dbField] || ""}
                    onValueChange={(v) => setFieldMapping({ ...fieldMapping, [dbField]: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={dbField === "email" ? "Select column" : "Optional"} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFields.map((field) => (
                        <SelectItem key={field} value={field}>
                          {field}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="space-y-4 pt-4 border-t">
              <div>
                <Label className="text-base font-medium">Add to List (Required)</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Contacts must be added to a list. Choose an existing list or create a new one.
                </p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    id="list-existing"
                    checked={addToListMode === "existing"}
                    onChange={() => setAddToListMode("existing")}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="list-existing" className="cursor-pointer font-normal">
                    Add to existing list
                  </Label>
                </div>
                {addToListMode === "existing" && (
                  <div className="ml-6">
                    <Select value={selectedListId} onValueChange={setSelectedListId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a list" />
                      </SelectTrigger>
                      <SelectContent>
                        {contactLists.map((list) => (
                          <SelectItem key={list.id} value={list.id}>
                            {list.name} ({(list as { contact_ids?: string[] }).contact_ids?.length ?? 0} contacts)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    id="list-new"
                    checked={addToListMode === "new"}
                    onChange={() => setAddToListMode("new")}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="list-new" className="cursor-pointer font-normal">
                    Create new list
                  </Label>
                </div>
                {addToListMode === "new" && (
                  <div className="ml-6">
                    <Input
                      placeholder="e.g., Q1 Prospects"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium">Preview</p>
                <Badge variant="secondary">{contactsData.length} contacts</Badge>
              </div>
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="border-b">
                      {fieldMapping.email && <th className="text-left p-2 font-medium">Email</th>}
                      {fieldMapping.first_name && <th className="text-left p-2 font-medium">First Name</th>}
                      {fieldMapping.last_name && <th className="text-left p-2 font-medium">Last Name</th>}
                      {fieldMapping.company && <th className="text-left p-2 font-medium">Company</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {contactsData.slice(0, 20).map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {fieldMapping.email && (
                          <td className="p-2">{(row[fieldMapping.email] as string) || "—"}</td>
                        )}
                        {fieldMapping.first_name && (
                          <td className="p-2">{(row[fieldMapping.first_name] as string) || "—"}</td>
                        )}
                        {fieldMapping.last_name && (
                          <td className="p-2">{(row[fieldMapping.last_name] as string) || "—"}</td>
                        )}
                        {fieldMapping.company && (
                          <td className="p-2">{(row[fieldMapping.company] as string) || "—"}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!fieldMapping.email && (
                <p className="text-sm text-muted-foreground text-center py-4">Map the Email field to see preview</p>
              )}
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setUploadStep("select")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                className="gradient-primary"
                onClick={handleSaveContacts}
                disabled={
                  !fieldMapping.email ||
                  (addToListMode === "existing" && !selectedListId) ||
                  (addToListMode === "new" && !newListName.trim())
                }
              >
                Import contacts
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {uploadStep === "saving" && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-6">
              <div className="rounded-full bg-primary/10 p-4" aria-hidden>
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-foreground">Importing contacts...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {saveStatus || "Please wait while we save your contacts"}
                </p>
              </div>
              <Progress value={saveProgress || 5} className="w-full max-w-md" />
            </div>
          </CardContent>
        </Card>
      )}

      <HelpLinks
        slugs={["import-contacts-csv-excel", "map-columns-when-importing-contacts", "create-manage-contact-lists"]}
        className="mt-6"
      />
    </div>
  );
}
