import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Mail, Eye, Save, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { format, parseISO } from "date-fns";

interface EmailTemplate {
  template_key: string;
  subject: string;
  from_name: string;
  from_email: string;
  body_html: string;
  body_text: string;
  variables: string[];
  updated_at: string;
  updated_by: string | null;
}

interface PreviewResult {
  template_key: string;
  from: string;
  subject: string;
  body_html: string;
  body_text: string;
  sample_vars: Record<string, string>;
}

// Friendly names for the 5 known templates.
const FRIENDLY_NAMES: Record<string, { name: string; description: string }> = {
  onboarding_nudge: {
    name: "Onboarding nudge",
    description: "Sent if a family paid but hasn't finished the onboarding form after 3 days.",
  },
  match_notification: {
    name: "Match notification (Poppy)",
    description: "Sent the moment a match is approved. Contains the one-click address-confirm link.",
  },
  guarantee_breach: {
    name: "Guarantee breach apology",
    description: "Sent when a child crosses the 21-day match guarantee and billing auto-pauses.",
  },
  address_change_confirm: {
    name: "Address change confirmation",
    description: "Sent whenever someone tries to change a mailing address via the public forms.",
  },
};

function useTemplates() {
  return useQuery<EmailTemplate[]>({
    queryKey: ["email-templates"],
    queryFn: () => customFetch<EmailTemplate[]>("/api/admin/email-templates"),
  });
}

function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: Partial<EmailTemplate> }) =>
      customFetch<EmailTemplate>(`/api/admin/email-templates/${key}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-templates"] }),
  });
}

function usePreview() {
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: Partial<EmailTemplate> }) =>
      customFetch<PreviewResult>(`/api/admin/email-templates/${key}/preview`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}

function TemplateEditor({
  template,
  onPreview,
  onSave,
  isSaving,
}: {
  template: EmailTemplate;
  onPreview: (draft: Partial<EmailTemplate>) => void;
  onSave: (draft: Partial<EmailTemplate>) => void;
  isSaving: boolean;
}) {
  const friendly = FRIENDLY_NAMES[template.template_key] ?? {
    name: template.template_key,
    description: "",
  };

  // Local draft state — only persists on Save.
  const [subject, setSubject] = useState(template.subject);
  const [fromName, setFromName] = useState(template.from_name);
  const [fromEmail, setFromEmail] = useState(template.from_email);
  const [bodyText, setBodyText] = useState(template.body_text);
  const [bodyHtml, setBodyHtml] = useState(template.body_html);

  // If the template prop changes (e.g. after a successful save → refetch), reset
  // the local state to match. Otherwise the editor would show stale local edits.
  useEffect(() => {
    setSubject(template.subject);
    setFromName(template.from_name);
    setFromEmail(template.from_email);
    setBodyText(template.body_text);
    setBodyHtml(template.body_html);
  }, [template]);

  const draft: Partial<EmailTemplate> = {
    subject,
    from_name: fromName,
    from_email: fromEmail,
    body_text: bodyText,
    body_html: bodyHtml,
  };

  const isDirty =
    subject !== template.subject ||
    fromName !== template.from_name ||
    fromEmail !== template.from_email ||
    bodyText !== template.body_text ||
    bodyHtml !== template.body_html;

  return (
    <Card data-testid={`template-card-${template.template_key}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg font-heading">{friendly.name}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{friendly.description}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <code className="px-1.5 py-0.5 bg-muted rounded">{template.template_key}</code>
              {template.updated_at && (
                <span>· Last edit {format(parseISO(template.updated_at), "MMM d, yyyy 'at' h:mma")}{template.updated_by ? ` by ${template.updated_by}` : ""}</span>
              )}
            </div>
          </div>
          {isDirty && <Badge variant="secondary">Unsaved changes</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor={`from-name-${template.template_key}`}>From name</Label>
            <Input
              id={`from-name-${template.template_key}`}
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`from-email-${template.template_key}`}>From email</Label>
            <Input
              id={`from-email-${template.template_key}`}
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor={`subject-${template.template_key}`}>Subject</Label>
          <Input
            id={`subject-${template.template_key}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={`body-text-${template.template_key}`}>Plain-text body</Label>
          <Textarea
            id={`body-text-${template.template_key}`}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={10}
            className="font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor={`body-html-${template.template_key}`}>HTML body</Label>
          <Textarea
            id={`body-html-${template.template_key}`}
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            rows={12}
            className="font-mono text-xs"
          />
        </div>

        {template.variables && template.variables.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Available variables: </span>
            {template.variables.map((v, i) => (
              <code key={v} className="px-1 py-0.5 bg-muted rounded mr-1">
                {`{{${v}}}`}{i < template.variables.length - 1 ? "" : ""}
              </code>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onPreview(draft)}
            data-testid={`preview-button-${template.template_key}`}
          >
            <Eye className="w-4 h-4 mr-2" />
            Preview
          </Button>
          <Button
            type="button"
            onClick={() => onSave(draft)}
            disabled={!isDirty || isSaving}
            data-testid={`save-button-${template.template_key}`}
          >
            {isSaving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewDialog({
  preview,
  open,
  onClose,
}: {
  preview: PreviewResult | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview · {preview?.template_key ?? ""}</DialogTitle>
          <DialogDescription>
            Rendered with sample variables — this is what the recipient would see.
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="space-y-4">
            <div className="text-sm">
              <div><span className="text-muted-foreground">From: </span><strong>{preview.from}</strong></div>
              <div className="mt-1"><span className="text-muted-foreground">Subject: </span><strong>{preview.subject}</strong></div>
            </div>
            <div>
              <Label className="text-xs">Rendered HTML</Label>
              <div
                className="mt-1 border rounded p-4 bg-white"
                // The preview body is rendered server-side from the saved template.
                // We trust the server-rendered output (admin-only flow) and show it
                // verbatim so Courtney sees what recipients will see.
                dangerouslySetInnerHTML={{ __html: preview.body_html }}
              />
            </div>
            <div>
              <Label className="text-xs">Plain text</Label>
              <pre className="mt-1 border rounded p-3 bg-muted/30 text-xs whitespace-pre-wrap font-mono">
                {preview.body_text}
              </pre>
            </div>
            {preview.sample_vars && Object.keys(preview.sample_vars).length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Sample variables used in this preview</summary>
                <pre className="mt-1 p-2 bg-muted/30 rounded">{JSON.stringify(preview.sample_vars, null, 2)}</pre>
              </details>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading preview…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function EmailTemplatesPage() {
  const { data: templates, isLoading, error } = useTemplates();
  const updateMutation = useUpdateTemplate();
  const previewMutation = usePreview();
  const { toast } = useToast();
  const [previewOpen, setPreviewOpen] = useState(false);

  const handlePreview = async (key: string, draft: Partial<EmailTemplate>) => {
    try {
      await previewMutation.mutateAsync({ key, body: draft });
      setPreviewOpen(true);
    } catch (err) {
      toast({
        title: "Preview failed",
        description: err instanceof Error ? err.message : "Could not render preview",
        variant: "destructive",
      });
    }
  };

  const handleSave = async (key: string, draft: Partial<EmailTemplate>) => {
    try {
      await updateMutation.mutateAsync({ key, body: draft });
      toast({
        title: "Saved",
        description: <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Template updated.</span>,
      });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Could not save template",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-black flex items-center gap-2">
          <Mail className="w-7 h-7" />
          Email Templates
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Edit the wording for the four transactional emails MailDay sends. Changes go live immediately.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading templates…</p>}
      {error && (
        <div className="flex items-start gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error instanceof Error ? error.message : "Failed to load templates"}</span>
        </div>
      )}

      {templates && templates.length > 0 && (
        <div className="space-y-6">
          {templates.map((t) => (
            <TemplateEditor
              key={t.template_key}
              template={t}
              onPreview={(draft) => handlePreview(t.template_key, draft)}
              onSave={(draft) => handleSave(t.template_key, draft)}
              isSaving={updateMutation.isPending && updateMutation.variables?.key === t.template_key}
            />
          ))}
        </div>
      )}

      <PreviewDialog
        preview={previewMutation.data ?? null}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
