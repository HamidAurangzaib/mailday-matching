import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Parent, Child } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Mail, Phone, MapPin, Calendar, User, Pencil, Check, X, ChevronRight, Link, Copy,
  CircleDot, Pause, ShieldAlert, Trash2, CalendarPlus,
} from "lucide-react";

type ParentWithExtras = Parent & {
  children?: Child[];
  pause_type?: "voluntary" | "guarantee" | null;
  at_risk?: boolean | null;
  coppa_erase_requested_at?: string | null;
  coppa_erase_requested_by?: string | null;
  coppa_erased_at?: string | null;
  created_at?: string | null;
};
type ParentWithChildren = ParentWithExtras;

const STATUS_COLORS: Record<string, string> = {
  Active: "bg-green-100 text-green-800",
  Paused: "bg-yellow-100 text-yellow-800",
  Cancelled: "bg-red-100 text-red-800",
};

const MATCH_STATUS_COLORS: Record<string, string> = {
  Matched: "bg-green-100 text-green-800",
  Unmatched: "bg-gray-100 text-gray-700",
  "Rematch Requested": "bg-orange-100 text-orange-800",
  Paused: "bg-yellow-100 text-yellow-800",
  Cancelled: "bg-red-100 text-red-800",
};

interface ParentSheetProps {
  parentId: string | null;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onOpenChild?: (childId: string) => void;
}

export function ParentSheet({ parentId, open, onClose, isAdmin, onOpenChild }: ParentSheetProps) {
  const queryClient = useQueryClient();
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [extended, setExtended] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const copyEmail = (email: string) => {
    void navigator.clipboard.writeText(email).then(() => {
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    });
  };

  const copyOnboardingLink = (token: string) => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const url = `${window.location.origin}${base}/onboarding?token=${token}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  // A family who missed their 30-day window (ours or theirs) can be given more
  // time without falsifying their join date. The token is unchanged, so any link
  // already sitting in their inbox keeps working.
  const extendLink = useMutation({
    mutationFn: () =>
      customFetch<{ expires_at: string }>(`/api/parents/${parentId}/onboarding-link`, {
        method: "PATCH",
        body: JSON.stringify({ days: 30 }),
      }),
    onSuccess: () => {
      setExtended(true);
      setTimeout(() => setExtended(false), 3000);
      void queryClient.invalidateQueries({ queryKey: ["parent", parentId] });
    },
  });

  const { data: parent, isLoading } = useQuery({
    queryKey: ["parent", parentId],
    queryFn: () => customFetch<ParentWithChildren>(`/api/parents/${parentId}`),
    enabled: !!parentId && open,
  });

  const saveNotes = useMutation({
    mutationFn: (notes: string) =>
      customFetch(`/api/parents/${parentId}`, {
        method: "PATCH",
        body: JSON.stringify({ internal_notes: notes }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parent", parentId] });
      void queryClient.invalidateQueries({ queryKey: ["parents"] });
      setEditingNotes(false);
    },
  });

  const requestCoppa = useMutation({
    mutationFn: (reason: string) =>
      customFetch(`/api/admin/coppa/parents/${parentId}/request`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parent", parentId] });
      void queryClient.invalidateQueries({ queryKey: ["action-items-count"] });
      void queryClient.invalidateQueries({ queryKey: ["lifecycle-tasks-action-items"] });
    },
  });

  const cancelCoppa = useMutation({
    mutationFn: () =>
      customFetch(`/api/admin/coppa/parents/${parentId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parent", parentId] });
      void queryClient.invalidateQueries({ queryKey: ["action-items-count"] });
      void queryClient.invalidateQueries({ queryKey: ["lifecycle-tasks-action-items"] });
    },
  });

  const handleClose = () => {
    setEditingNotes(false);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <SheetContent className="w-full sm:w-[480px] sm:max-w-[480px] overflow-y-auto bg-white">
        {isLoading || !parent ? (
          <div className="space-y-4 pt-6">
            <SheetHeader className="sr-only">
              <SheetTitle>Loading parent profile</SheetTitle>
            </SheetHeader>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-32 w-full mt-6" />
          </div>
        ) : (
          <>
            <SheetHeader className="pb-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-[#DD4B39]/10 flex items-center justify-center shrink-0 mt-1">
                  <User className="w-6 h-6 text-[#DD4B39]" />
                </div>
                <div>
                  <SheetTitle className="text-xl">
                    {parent.first_name} {parent.last_name}
                    {parent.at_risk && (
                      <Badge variant="destructive" className="ml-2 text-[10px] align-middle">At Risk</Badge>
                    )}
                    {parent.pause_type && (
                      <Badge
                        variant="outline"
                        className={`ml-2 text-[10px] align-middle ${parent.pause_type === "voluntary" ? "bg-purple-100 text-purple-800 border-purple-200" : "bg-amber-100 text-amber-800 border-amber-200"}`}
                      >
                        <Pause className="w-2.5 h-2.5 mr-0.5" />
                        {parent.pause_type === "voluntary" ? "Voluntary Pause" : "Guarantee Pause"}
                      </Badge>
                    )}
                  </SheetTitle>
                  <SheetDescription className="mt-0.5 flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[parent.subscription_status ?? ""] ?? "bg-gray-100 text-gray-700"}`}>
                      {parent.subscription_status ?? "Unknown"}
                    </span>
                    <span className="text-muted-foreground">{parent.membership_tier}</span>
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <Separator />

            {/* Contact */}
            <div className="py-4 space-y-2.5">
              <div className="flex items-center gap-2.5 text-sm">
                <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                <a href={`mailto:${parent.email}`} className="hover:underline">{parent.email}</a>
                <button
                  onClick={() => copyEmail(parent.email)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy email"
                >
                  {copiedEmail ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              {parent.phone && (
                <div className="flex items-center gap-2.5 text-sm">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>{parent.phone}</span>
                </div>
              )}
              {parent.state && (
                <div className="flex items-center gap-2.5 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>{parent.state}</span>
                </div>
              )}
              {isAdmin && parent.mailing_address && (
                <div className="flex items-start gap-2.5 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{parent.mailing_address}</span>
                </div>
              )}
              {parent.join_date && (
                <div className="flex items-center gap-2.5 text-sm">
                  <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>Joined {format(new Date(parent.join_date), "MMMM d, yyyy")}</span>
                </div>
              )}
            </div>

            {/* Onboarding link — admin only */}
            {isAdmin && (parent as ParentWithChildren & { onboarding_token?: string }).onboarding_token && (
              <div className="mb-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-8 text-xs gap-1.5"
                  onClick={() => copyOnboardingLink(
                    (parent as ParentWithChildren & { onboarding_token: string }).onboarding_token
                  )}
                >
                  {copiedLink ? (
                    <><Check className="w-3.5 h-3.5 text-green-600" /> Link copied!</>
                  ) : (
                    <><Link className="w-3.5 h-3.5" /> Copy onboarding link</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 shrink-0"
                  title="Give this family another 30 days to complete their form. The link itself doesn't change."
                  disabled={extendLink.isPending}
                  onClick={() => extendLink.mutate()}
                >
                  {extended ? (
                    <><Check className="w-3.5 h-3.5 text-green-600" /> +30 days</>
                  ) : (
                    <><CalendarPlus className="w-3.5 h-3.5" /> Extend</>
                  )}
                </Button>
              </div>
            )}

            {/* Membership details */}
            <div className="py-3 px-4 bg-muted/40 rounded-lg text-sm grid grid-cols-2 gap-y-2 gap-x-4">
              <div>
                <div className="text-xs text-muted-foreground">Billing</div>
                <div className="font-medium">{parent.billing_type ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Referral</div>
                <div className="font-medium">{parent.referral_source ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Community</div>
                <div className="font-medium">{parent.community_status ?? "—"}</div>
              </div>
              {parent.give_a_key_recipient && (
                <div>
                  <div className="text-xs text-muted-foreground">Give-a-Key</div>
                  <Badge variant="outline" className="text-[10px]">Recipient</Badge>
                </div>
              )}
            </div>

            {/* Internal notes — editable for admins */}
            {isAdmin && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Internal Notes</span>
                  {!editingNotes && (
                    <button
                      onClick={() => {
                        setNotesValue(parent.internal_notes ?? "");
                        setEditingNotes(true);
                      }}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      {parent.internal_notes ? "Edit" : "Add note"}
                    </button>
                  )}
                </div>
                {editingNotes ? (
                  <div className="space-y-2">
                    <Textarea
                      value={notesValue}
                      onChange={(e) => setNotesValue(e.target.value)}
                      placeholder="Add an internal note..."
                      className="text-sm min-h-[80px]"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => saveNotes.mutate(notesValue)}
                        disabled={saveNotes.isPending}
                      >
                        <Check className="w-3 h-3 mr-1" />
                        {saveNotes.isPending ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setEditingNotes(false)}
                        disabled={saveNotes.isPending}
                      >
                        <X className="w-3 h-3 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : parent.internal_notes ? (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-900">
                    {parent.internal_notes}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No notes yet.</p>
                )}
              </div>
            )}

            <Separator className="my-4" />

            {/* Lifecycle timeline */}
            <div className="mb-4">
              <h3 className="font-semibold text-sm mb-3">Lifecycle</h3>
              <LifecycleTimeline parent={parent} />
            </div>

            {/* COPPA controls — admin only */}
            {isAdmin && (
              <div className="mb-4">
                <CoppaControls
                  parent={parent}
                  onRequest={(reason) => requestCoppa.mutate(reason)}
                  onCancel={() => cancelCoppa.mutate()}
                  requestPending={requestCoppa.isPending}
                  cancelPending={cancelCoppa.isPending}
                />
              </div>
            )}

            <Separator className="my-4" />

            {/* Children */}
            <div>
              <h3 className="font-semibold text-sm mb-3">Children ({parent.children?.length ?? 0})</h3>
              {!parent.children || parent.children.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No children on file yet.</p>
              ) : (
                <div className="space-y-2">
                  {parent.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => onOpenChild?.(child.id)}
                      className={`w-full text-left border rounded-lg p-3 space-y-2 transition-colors ${onOpenChild ? "hover:bg-muted/50 cursor-pointer" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-sm">
                          {child.child_first_name}
                          {child.safety_flag && (
                            <Badge variant="destructive" className="ml-2 text-[10px]">Safety Flag</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${MATCH_STATUS_COLORS[child.match_status] ?? "bg-gray-100 text-gray-700"}`}>
                            {child.match_status}
                          </span>
                          {onOpenChild && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Age {child.age}</span>
                        <span>·</span>
                        <Badge variant="outline" className="text-[10px] h-5">{child.tier}</Badge>
                      </div>
                      {child.interests && child.interests.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {child.interests.slice(0, 5).map((interest) => (
                            <span key={interest} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-[#DD4B39]/10 text-[#DD4B39] font-medium">
                              {interest}
                            </span>
                          ))}
                          {child.interests.length > 5 && (
                            <span className="text-[10px] text-muted-foreground">+{child.interests.length - 5}</span>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function LifecycleTimeline({ parent }: { parent: ParentWithExtras }) {
  const subscribedAt = parent.created_at ?? parent.join_date ?? null;
  const hasChild = (parent.children?.length ?? 0) > 0;
  const hasMatchedChild = (parent.children ?? []).some((c) => c.match_status === "Matched");
  const isPaused = !!parent.pause_type;
  const isAtRisk = !!parent.at_risk;
  const isCoppaPending = !!parent.coppa_erase_requested_at && !parent.coppa_erased_at;
  const isCoppaErased = !!parent.coppa_erased_at;

  const steps: { label: string; done: boolean; detail?: string; tone: "default" | "warning" | "danger" }[] = [
    {
      label: "Subscribed",
      done: !!subscribedAt,
      detail: subscribedAt ? format(new Date(subscribedAt), "MMM d, yyyy") : undefined,
      tone: "default",
    },
    {
      label: "Child added",
      done: hasChild,
      detail: hasChild ? `${parent.children?.length ?? 0} on file` : "not yet",
      tone: "default",
    },
    {
      label: "First match",
      done: hasMatchedChild,
      detail: hasMatchedChild ? "matched" : "waiting",
      tone: "default",
    },
  ];
  if (isPaused) {
    steps.push({
      label: parent.pause_type === "voluntary" ? "Voluntary pause" : "Guarantee pause",
      done: true,
      detail: parent.pause_type === "voluntary" ? "family-requested" : "auto: 21-day breach",
      tone: "warning",
    });
  }
  if (isAtRisk) {
    steps.push({ label: "At-risk flag", done: true, detail: "engagement dropped", tone: "warning" });
  }
  if (isCoppaPending) {
    steps.push({
      label: "COPPA erase pending",
      done: true,
      detail: parent.coppa_erase_requested_at ? `requested ${format(new Date(parent.coppa_erase_requested_at), "MMM d")}` : undefined,
      tone: "danger",
    });
  }
  if (isCoppaErased) {
    steps.push({
      label: "COPPA erased",
      done: true,
      detail: parent.coppa_erased_at ? format(new Date(parent.coppa_erased_at), "MMM d, yyyy") : undefined,
      tone: "danger",
    });
  }

  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <div key={step.label} className="flex items-center gap-2.5 text-sm">
          <CircleDot
            className={`w-3.5 h-3.5 shrink-0 ${
              !step.done ? "text-muted-foreground/40" :
              step.tone === "danger" ? "text-red-600" :
              step.tone === "warning" ? "text-amber-600" : "text-green-600"
            }`}
          />
          <span className={step.done ? "font-medium" : "text-muted-foreground"}>{step.label}</span>
          {step.detail && <span className="text-xs text-muted-foreground ml-auto">{step.detail}</span>}
        </div>
      ))}
    </div>
  );
}

function CoppaControls({
  parent, onRequest, onCancel, requestPending, cancelPending,
}: {
  parent: ParentWithExtras;
  onRequest: (reason: string) => void;
  onCancel: () => void;
  requestPending: boolean;
  cancelPending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  if (parent.coppa_erased_at) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        <div className="flex items-center gap-2 font-medium">
          <ShieldAlert className="w-4 h-4" /> Erased {format(new Date(parent.coppa_erased_at), "MMM d, yyyy")}
        </div>
        <p className="text-xs text-red-700 mt-1">All personal data has been removed under COPPA.</p>
      </div>
    );
  }

  if (parent.coppa_erase_requested_at) {
    const requestedAt = new Date(parent.coppa_erase_requested_at);
    const executeAt = new Date(requestedAt.getTime() + 7 * 86400000);
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
        <div className="flex items-center gap-2 font-medium">
          <ShieldAlert className="w-4 h-4" /> COPPA erasure pending
        </div>
        <p className="text-xs text-amber-800">
          Requested {format(requestedAt, "MMM d")} by {parent.coppa_erase_requested_by ?? "unknown"} —
          will execute on or after {format(executeAt, "MMM d, yyyy")}.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => onCancel()}
          disabled={cancelPending}
        >
          <X className="w-3 h-3 mr-1" />
          {cancelPending ? "Cancelling…" : "Cancel erasure"}
        </Button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50/60 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-red-900">
          <ShieldAlert className="w-4 h-4" /> Initiate COPPA erasure?
        </div>
        <p className="text-xs text-red-800">
          7-day cooling-off period starts now. You can cancel before then. After 7 days, all of this family's
          personal data is permanently deleted.
        </p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional — e.g. parent emailed Apr 12)"
          className="text-xs min-h-[60px]"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs"
            onClick={() => onRequest(reason)}
            disabled={requestPending}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            {requestPending ? "Requesting…" : "Confirm — start 7-day clock"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setConfirming(false)}
            disabled={requestPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full h-8 text-xs gap-1.5 text-red-700 hover:text-red-800 hover:bg-red-50 border-red-200"
      onClick={() => setConfirming(true)}
    >
      <ShieldAlert className="w-3.5 h-3.5" /> Initiate COPPA erase
    </Button>
  );
}
