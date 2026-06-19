import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Child } from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { User, AlertTriangle, Clock, PauseCircle, Pencil, Check, X, ChevronRight, Cake, Trash2, Copy, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type PenPalPartner = {
  id: string;
  match_id: string;
  match_date: string;
  child_first_name: string;
  age: number;
  tier: string;
  interests: string[];
  parent: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    state?: string | null;
    membership_tier?: string | null;
  } | null;
};

type ChildDetail = Child & {
  date_of_birth?: string | null;
  parent: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string | null;
    state?: string | null;
    membership_tier?: string | null;
    give_a_key_recipient?: boolean | null;
  };
  days_waiting?: number | null;
  guarantee_status?: "ok" | "warning" | "urgent" | null;
  pen_pal?: PenPalPartner | null;
  pen_pal_missing?: boolean;
};

function daysToBirthday(dob: string): number {
  const today = new Date();
  const birth = new Date(dob);
  let next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
  return Math.ceil((next.getTime() - today.getTime()) / 86400000);
}

function turningAge(dob: string): number {
  const today = new Date();
  const birth = new Date(dob);
  const age = today.getFullYear() - birth.getFullYear();
  const alreadyThisYear = new Date(today.getFullYear(), birth.getMonth(), birth.getDate()) <= today;
  return alreadyThisYear ? age + 1 : age;
}

// Date limits for DOB picker
const DOB_MIN = new Date(new Date().getFullYear() - 18, 0, 1).toISOString().split("T")[0];
const DOB_MAX = new Date(new Date().getFullYear() - 1, 11, 31).toISOString().split("T")[0];

const INTEREST_COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-purple-100 text-purple-800",
  "bg-green-100 text-green-800",
  "bg-orange-100 text-orange-800",
  "bg-pink-100 text-pink-800",
  "bg-teal-100 text-teal-800",
];

function interestColor(interest: string): string {
  let hash = 0;
  for (let i = 0; i < interest.length; i++) {
    hash = interest.charCodeAt(i) + ((hash << 5) - hash);
  }
  return INTEREST_COLORS[Math.abs(hash) % INTEREST_COLORS.length];
}

const MATCH_STATUS_STYLES: Record<string, { badge: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  Matched:             { badge: "bg-green-500 hover:bg-green-600 text-white border-transparent", variant: "default" },
  Unmatched:           { badge: "", variant: "secondary" },
  "Rematch Requested": { badge: "bg-orange-100 text-orange-800 border-orange-200", variant: "outline" },
  Paused:              { badge: "bg-yellow-100 text-yellow-800 border-yellow-200", variant: "outline" },
  Cancelled:           { badge: "bg-red-100 text-red-800 border-red-200", variant: "outline" },
};

interface ChildSheetProps {
  childId: string | null;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onOpenParent?: (parentId: string) => void;
  onOpenChild?: (childId: string) => void;
  onDeleted?: () => void;
}

export function ChildSheet({ childId, open, onClose, isAdmin, onOpenParent, onOpenChild, onDeleted }: ChildSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [editingDob, setEditingDob] = useState(false);
  const [dobValue, setDobValue] = useState("");

  const { data: child, isLoading } = useQuery({
    queryKey: ["child", childId],
    queryFn: () => customFetch<ChildDetail>(`/api/children/${childId}`),
    enabled: !!childId && open,
  });

  const saveNotes = useMutation({
    mutationFn: (notes: string) =>
      customFetch(`/api/children/${childId}`, {
        method: "PATCH",
        body: JSON.stringify({ internal_notes: notes }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["child", childId] });
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      setEditingNotes(false);
    },
  });

  const saveDob = useMutation({
    mutationFn: (dob: string) =>
      customFetch(`/api/children/${childId}`, {
        method: "PATCH",
        body: JSON.stringify({ date_of_birth: dob || null }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["child", childId] });
      setEditingDob(false);
    },
  });

  const deleteChild = useMutation({
    mutationFn: () =>
      customFetch(`/api/children/${childId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      void queryClient.invalidateQueries({ queryKey: ["unmatched"] });
      onClose();
      onDeleted?.();
    },
  });

  const readyToRematch = useMutation({
    mutationFn: () =>
      customFetch(`/api/children/${childId}`, {
        method: "PATCH",
        body: JSON.stringify({ match_status: "Unmatched" }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["child", childId] });
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      void queryClient.invalidateQueries({ queryKey: ["unmatched"] });
      void queryClient.invalidateQueries({ queryKey: ["action-items-count"] });
      toast({ title: "Moved to queue", description: `${child?.child_first_name} is now in the unmatched queue and will be picked up in the next match session.` });
      onClose();
    },
    onError: (err) => toast({ title: "Failed to update", description: err.message, variant: "destructive" }),
  });

  const handleClose = () => {
    setEditingNotes(false);
    setEditingDob(false);
    onClose();
  };

  const statusStyle = MATCH_STATUS_STYLES[child?.match_status ?? ""] ?? { badge: "", variant: "outline" as const };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <SheetContent className="w-full sm:w-[460px] sm:max-w-[460px] overflow-y-auto bg-white">
        {isLoading || !child ? (
          <div className="space-y-4 pt-6">
            <SheetHeader className="sr-only">
              <SheetTitle>Loading child profile</SheetTitle>
            </SheetHeader>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-32 w-full mt-4" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="pb-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-[#DD4B39]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-6 h-6 text-[#DD4B39]" />
                </div>
                <div className="space-y-1 flex-1">
                  <SheetTitle className="text-xl leading-tight">
                    {child.child_first_name}
                    {child.safety_flag && (
                      <Badge variant="destructive" className="ml-2 text-[10px] align-middle">Safety Flag</Badge>
                    )}
                  </SheetTitle>
                  <SheetDescription asChild>
                    <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                      <span>Age {child.age}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border border-border bg-background text-foreground">{child.tier}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusStyle.badge || "bg-muted text-muted-foreground border-border"}`}>
                        {child.match_status}
                      </span>
                      {child.parent.give_a_key_recipient && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#DD4B39] text-white border-transparent border">Give a Key</span>
                      )}
                    </div>
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <Separator />

            {/* Status alerts */}
            <div className="py-3 space-y-2">
              {child.guarantee_status && child.guarantee_status !== "ok" && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${child.guarantee_status === "urgent" ? "bg-red-50 border border-red-200 text-red-800" : "bg-yellow-50 border border-yellow-200 text-yellow-800"}`}>
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    {child.days_waiting} days in queue —{" "}
                    {child.guarantee_status === "urgent" ? "billing paused (21-day guarantee)" : "approaching guarantee window"}
                  </span>
                </div>
              )}
              {child.billing_paused && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-orange-50 border border-orange-200 text-orange-800">
                  <PauseCircle className="w-4 h-4 shrink-0" />
                  Billing is currently paused
                </div>
              )}
              {child.date_of_birth && (() => {
                const days = daysToBirthday(child.date_of_birth!);
                if (days > 30) return null;
                const age = turningAge(child.date_of_birth!);
                return (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-pink-50 border border-pink-200 text-pink-800">
                    <Cake className="w-4 h-4 shrink-0" />
                    <span>
                      {days === 0 ? `Happy Birthday! Turning ${age} today!` : `Turning ${age} in ${days} day${days === 1 ? "" : "s"}`}
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Details grid */}
            <div className="py-2 px-4 bg-muted/40 rounded-lg text-sm grid grid-cols-2 gap-y-3 gap-x-4">
              <div>
                <div className="text-xs text-muted-foreground">Rematch Count</div>
                <div className="font-medium">{child.rematch_count ?? 0}</div>
              </div>
              {child.match_guarantee_start_date && (
                <div>
                  <div className="text-xs text-muted-foreground">Queue Since</div>
                  <div className="font-medium">
                    {new Date(child.match_guarantee_start_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                </div>
              )}
              {child.days_waiting != null && (
                <div>
                  <div className="text-xs text-muted-foreground">Days Waiting</div>
                  <div className="font-medium flex items-center gap-1.5">
                    {child.days_waiting}d
                    {child.guarantee_status && child.guarantee_status !== "ok" && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${child.guarantee_status === "urgent" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}`}>
                        <Clock className="w-2.5 h-2.5" />
                        {child.guarantee_status}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {child.homeschool_edition && (
                <>
                  <div>
                    <div className="text-xs text-muted-foreground">HS Approach</div>
                    <div className="font-medium">{child.homeschool_approach ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">HS Tier</div>
                    <div className="font-medium">{child.homeschool_tier ?? "—"}</div>
                  </div>
                </>
              )}
            </div>

            {/* Date of Birth — editable */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Cake className="w-3 h-3" /> Date of Birth
                </span>
                {!editingDob && (
                  <button
                    onClick={() => {
                      setDobValue(child.date_of_birth ?? "");
                      setEditingDob(true);
                    }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    {child.date_of_birth ? "Edit" : "Add"}
                  </button>
                )}
              </div>
              {editingDob ? (
                <div className="space-y-2">
                  <Input
                    type="date"
                    value={dobValue}
                    onChange={(e) => setDobValue(e.target.value)}
                    min={DOB_MIN}
                    max={DOB_MAX}
                    className="text-sm w-48"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => saveDob.mutate(dobValue)}
                      disabled={saveDob.isPending}
                    >
                      <Check className="w-3 h-3 mr-1" />
                      {saveDob.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setEditingDob(false)}
                      disabled={saveDob.isPending}
                    >
                      <X className="w-3 h-3 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : child.date_of_birth ? (
                <div className="text-sm font-medium">
                  {new Date(child.date_of_birth).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  <span className="ml-2 text-xs text-muted-foreground">(Age {child.age})</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No birthday on file.</p>
              )}
            </div>

            {/* Interests */}
            <div className="mt-5">
              <h3 className="font-semibold text-sm mb-2">Interests ({child.interests?.length ?? 0})</h3>
              {child.interests && child.interests.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {child.interests.map((interest) => (
                    <span key={interest} className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${interestColor(interest)}`}>
                      {interest}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No interests recorded.</p>
              )}
            </div>

            {/* Internal notes — editable for admins */}
            {isAdmin && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Internal Notes</span>
                  {!editingNotes && (
                    <button
                      onClick={() => {
                        setNotesValue(child.internal_notes ?? "");
                        setEditingNotes(true);
                      }}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      {child.internal_notes ? "Edit" : "Add note"}
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
                ) : child.internal_notes ? (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-900">
                    {child.internal_notes}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No notes yet.</p>
                )}
              </div>
            )}

            <Separator className="my-4" />

            {/* Pen Pal Match */}
            {(child.pen_pal || child.pen_pal_missing) && (
              <>
                <Separator className="my-4" />
                <div>
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    Pen Pal
                    {child.pen_pal?.match_date && (
                      <span className="text-xs font-normal text-muted-foreground">
                        matched {new Date(child.pen_pal.match_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                  </h3>
                  {child.pen_pal ? (
                    <button
                      type="button"
                      className="w-full text-left border rounded-lg p-3 space-y-1.5 hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => {
                        onClose();
                        setTimeout(() => onOpenChild?.(child.pen_pal!.id), 200);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-sm">
                          {child.pen_pal.child_first_name}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">Age {child.pen_pal.age} · {child.pen_pal.tier}</span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                      {child.pen_pal.parent && (
                        <div className="text-xs text-muted-foreground">
                          {child.pen_pal.parent.first_name} {child.pen_pal.parent.last_name} · {child.pen_pal.parent.email}
                          {child.pen_pal.parent.state && ` · ${child.pen_pal.parent.state}`}
                        </div>
                      )}
                      {child.pen_pal.interests && child.pen_pal.interests.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {child.pen_pal.interests.slice(0, 4).map((i) => (
                            <span key={i} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${interestColor(i)}`}>{i}</span>
                          ))}
                          {child.pen_pal.interests.length > 4 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">+{child.pen_pal.interests.length - 4}</span>
                          )}
                        </div>
                      )}
                    </button>
                  ) : (
                    <div className="border rounded-lg p-3 text-sm text-muted-foreground italic">
                      Match record not found — this child may have been matched outside the system. Check the Matches page for details.
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Parent */}
            <div>
              <h3 className="font-semibold text-sm mb-3">Parent</h3>
              <div
                onClick={() => onOpenParent?.(child.parent.id)}
                className={`border rounded-lg p-3 space-y-1.5 transition-colors ${onOpenParent ? "hover:bg-muted/50 cursor-pointer" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">
                    {child.parent.first_name} {child.parent.last_name}
                  </div>
                  {onOpenParent && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{child.parent.email}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(child.parent.email); }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy email"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                {child.parent.phone && <div className="text-xs text-muted-foreground">{child.parent.phone}</div>}
                {child.parent.state && <div className="text-xs text-muted-foreground">{child.parent.state}</div>}
                {child.parent.membership_tier && (
                  <Badge variant="outline" className="text-[10px] mt-0.5">{child.parent.membership_tier}</Badge>
                )}
              </div>
            </div>

            {/* Ready to Rematch — admin only, shown when status is Rematch Requested */}
            {isAdmin && child.match_status === "Rematch Requested" && (
              <div className="mt-6 pt-4 border-t">
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <RotateCcw className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-sm font-semibold text-amber-900">Needs a new pen pal</div>
                      <p className="text-xs text-amber-700 mt-0.5">
                        Once you've confirmed with the family that they're ready, move {child.child_first_name} into the unmatched queue so they can be paired in the next match session.
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => readyToRematch.mutate()}
                    disabled={readyToRematch.isPending}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                    {readyToRematch.isPending ? "Moving to queue…" : "Ready to Rematch — Move to Queue"}
                  </Button>
                </div>
              </div>
            )}

            {/* Delete — admin only */}
            {isAdmin && (
              <div className="mt-6 pt-4 border-t border-destructive/20">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 w-full justify-start"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete child record
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {child.child_first_name}'s record?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes {child.child_first_name}'s profile and any associated match records from the database. This cannot be undone.
                        <br /><br />
                        Use this for COPPA deletion requests or duplicate records.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive hover:bg-destructive/90 text-white"
                        onClick={() => deleteChild.mutate()}
                        disabled={deleteChild.isPending}
                      >
                        {deleteChild.isPending ? "Deleting…" : "Yes, delete permanently"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
