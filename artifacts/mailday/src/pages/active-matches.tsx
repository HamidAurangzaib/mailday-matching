import { useListMatches, useUpdateMatch, customFetch } from "@workspace/api-client-react";
import type { MatchWithChildren, ChildWithParent } from "@workspace/api-client-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, differenceInDays, differenceInMonths, parseISO } from "date-fns";
import { useLocation } from "wouter";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth";
import { Search, Copy, Check, Mail, MapPin, User, Heart, Pencil, X, Mailbox, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ChildSheet } from "@/components/child-sheet";

type MatchExtras = {
  match_status?: string;
  address_confirmed_a?: boolean | null;
  address_confirmed_b?: boolean | null;
};

function matchDuration(matchDate: string | null | undefined): string {
  if (!matchDate) return "—";
  const start = parseISO(matchDate);
  const now = new Date();
  const months = differenceInMonths(now, start);
  const days = differenceInDays(now, start);
  if (months >= 2) return `${months} months`;
  if (months === 1) return "1 month";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function ChildCard({
  child,
  label,
  onOpenChild,
}: {
  child: ChildWithParent;
  label: string;
  onOpenChild: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <button
        className="flex items-center gap-2 w-full text-left group"
        onClick={() => onOpenChild(child.id)}
      >
        <div className="w-9 h-9 rounded-full bg-[#DD4B39]/10 flex items-center justify-center shrink-0 group-hover:bg-[#DD4B39]/20 transition-colors">
          <User className="w-4 h-4 text-[#DD4B39]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="font-semibold text-base leading-tight group-hover:text-[#DD4B39] transition-colors">
            {child.child_first_name}
          </div>
        </div>
        <span className="text-xs text-muted-foreground group-hover:text-[#DD4B39] opacity-0 group-hover:opacity-100 transition-all">
          View profile →
        </span>
      </button>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full border bg-background text-foreground font-medium">Age {child.age}</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full border bg-background text-foreground font-medium">{child.tier}</span>
        {child.parent.state && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-background text-foreground font-medium">
            <MapPin className="w-3 h-3" />{child.parent.state}
          </span>
        )}
      </div>

      {child.interests && (child.interests as string[]).length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Interests</div>
          <div className="flex flex-wrap gap-1">
            {(child.interests as string[]).map((i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">{i}</Badge>
            ))}
          </div>
        </div>
      )}

      <Separator />

      <div className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Parent</div>
        <div className="text-sm font-medium">{child.parent.first_name} {child.parent.last_name}</div>
        {child.parent.email && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Mail className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{child.parent.email}</span>
            <CopyButton value={child.parent.email} />
          </div>
        )}
      </div>
    </div>
  );
}

function MatchSheet({
  match,
  open,
  onClose,
  isAdmin,
  onCloseMatch,
  onOpenChild,
}: {
  match: MatchWithChildren | null;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onCloseMatch: (id: string) => void;
  onOpenChild: (id: string) => void;
}) {
  const updateMatch = useUpdateMatch();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");

  const resendConfirmation = useMutation({
    mutationFn: (sides: "both" | "a" | "b" | "auto") =>
      customFetch(`/api/matches/${match?.id}/resend-confirmation`, {
        method: "POST",
        body: JSON.stringify({ sides }),
      }),
    onSuccess: () => {
      toast({ title: "Address confirmation email re-sent" });
      void queryClient.invalidateQueries({ queryKey: ["matches"] });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to resend", description: err.message, variant: "destructive" }),
  });

  if (!match) return null;

  const childA = match.child_a as ChildWithParent | null;
  const childB = match.child_b as ChildWithParent | null;
  const matchExtras = match as MatchWithChildren & MatchExtras;
  const isPending = matchExtras.match_status === "Pending";
  const confirmedA = matchExtras.address_confirmed_a === true;
  const confirmedB = matchExtras.address_confirmed_b === true;

  const saveNotes = () => {
    updateMatch.mutate(
      { id: match.id, data: { notes: notesValue } },
      {
        onSuccess: () => {
          toast({ title: "Notes saved" });
          setEditingNotes(false);
        },
        onError: (err) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
      }
    );
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) { setEditingNotes(false); onClose(); } }}>
      <SheetContent className="w-full sm:w-[520px] sm:max-w-[520px] overflow-y-auto bg-white">
        <SheetHeader className="pb-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
              <Heart className="w-6 h-6 text-green-600" />
            </div>
            <div className="space-y-1 flex-1">
              <SheetTitle className="text-xl leading-tight">
                {childA?.child_first_name ?? "?"} &amp; {childB?.child_first_name ?? "?"}
              </SheetTitle>
              <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                {isPending ? (
                  <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-[11px]">
                    <Mailbox className="w-3 h-3 mr-1" />Awaiting Address Confirmation
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-[11px]">
                    Active
                  </Badge>
                )}
                <span className="text-muted-foreground/40">·</span>
                <span>{match.match_date ? format(new Date(match.match_date), "MMM d, yyyy") : "Unknown date"}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className={isPending ? "text-blue-600 font-medium" : "text-green-600 font-medium"}>{matchDuration(match.match_date)}</span>
              </div>
            </div>
          </div>
        </SheetHeader>

        <Separator />

        {/* Pending: address-confirmation status + manual resend */}
        {isPending && (
          <div className="py-4 space-y-3 bg-blue-50/40 -mx-6 px-6 border-y border-blue-200/60">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-900">
              Address Confirmation
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                {confirmedA
                  ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  : <span className="w-3.5 h-3.5 rounded-full border border-blue-400 shrink-0" />}
                <span className={confirmedA ? "" : "text-blue-900"}>
                  {childA?.child_first_name ?? "Child A"}: {confirmedA ? "confirmed" : "awaiting"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {confirmedB
                  ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  : <span className="w-3.5 h-3.5 rounded-full border border-blue-400 shrink-0" />}
                <span className={confirmedB ? "" : "text-blue-900"}>
                  {childB?.child_first_name ?? "Child B"}: {confirmedB ? "confirmed" : "awaiting"}
                </span>
              </div>
            </div>
            {(!confirmedA || !confirmedB) && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 bg-white"
                  disabled={resendConfirmation.isPending}
                  onClick={() => resendConfirmation.mutate("auto")}
                >
                  <Send className="w-3 h-3" />
                  {resendConfirmation.isPending ? "Sending…" : "Resend to unconfirmed sides"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  disabled={resendConfirmation.isPending}
                  onClick={() => resendConfirmation.mutate("both")}
                >
                  Resend to both
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Shared interests */}
        {match.shared_interests && match.shared_interests.length > 0 && (
          <div className="py-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Shared Interests ({match.shared_interests.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {match.shared_interests.map((i) => (
                <Badge key={i} className="bg-[#DD4B39]/10 text-[#DD4B39] border-[#DD4B39]/20 hover:bg-[#DD4B39]/15 text-[11px]">
                  {i}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <Separator />

        {/* Children */}
        <div className="py-4 space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pen Pals</div>
          {childA && <ChildCard child={childA} label="Child A" onOpenChild={onOpenChild} />}
          {childB && <ChildCard child={childB} label="Child B" onOpenChild={onOpenChild} />}
        </div>

        <Separator />

        {/* Internal notes */}
        <div className="py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Internal Notes</div>
            {!editingNotes && (
              <button
                onClick={() => {
                  setNotesValue((match.notes as string | null) ?? "");
                  setEditingNotes(true);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="w-3 h-3" />
                {match.notes ? "Edit" : "Add note"}
              </button>
            )}
          </div>
          {editingNotes ? (
            <div className="space-y-2">
              <Textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                placeholder="Notes about this match — pen pal progress, issues, parent feedback..."
                className="text-sm min-h-[100px]"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={saveNotes}
                  disabled={updateMatch.isPending}
                >
                  <Check className="w-3 h-3 mr-1" />
                  {updateMatch.isPending ? "Saving…" : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setEditingNotes(false)}
                  disabled={updateMatch.isPending}
                >
                  <X className="w-3 h-3 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : match.notes ? (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-900 whitespace-pre-wrap">
              {match.notes as string}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No notes yet.</p>
          )}
        </div>

        {/* Close match — admin only */}
        {isAdmin && (
          <div className="pt-2 pb-4 border-t border-destructive/20 mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 w-full justify-start"
              onClick={() => {
                setEditingNotes(false);
                onClose();
                setTimeout(() => onCloseMatch(match.id), 200);
              }}
            >
              Close this match
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function ActiveMatches() {
  const [search, setSearch] = useState("");
  const { data: allMatches, isLoading, refetch } = useListMatches({ search: search || undefined });
  const [closeMatchId, setCloseMatchId] = useState<string | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [childSheetId, setChildSheetId] = useState<string | null>(null);
  const [childSheetOpen, setChildSheetOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const matches = allMatches?.filter((m) => m.match_status === "Active");
  const selectedMatch = (allMatches?.find((m) => m.id === selectedMatchId) ?? null) as MatchWithChildren | null;

  const openChild = (id: string) => {
    setChildSheetId(id);
    setChildSheetOpen(true);
  };

  const openParentById = (parentId: string) => {
    setChildSheetOpen(false);
    setChildSheetId(null);
    setSelectedMatchId(null);
    setTimeout(() => setLocation(`/parents?id=${parentId}`), 250);
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Active Matches</h1>
          {!isLoading && (
            <p className="text-sm text-muted-foreground mt-1">
              {matches?.length ?? 0} active {(matches?.length ?? 0) === 1 ? "match" : "matches"}
            </p>
          )}
        </div>
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by child name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Matched On</TableHead>
              <TableHead>Child A</TableHead>
              <TableHead>Child B</TableHead>
              <TableHead>Shared Interests</TableHead>
              <TableHead>Duration</TableHead>
              {isAdmin && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={isAdmin ? 6 : 5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : matches?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5} className="h-24 text-center text-muted-foreground">
                  No active matches found.
                </TableCell>
              </TableRow>
            ) : (
              matches?.map((match) => (
                <TableRow
                  key={match.id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    setSelectedMatchId(match.id);
                  }}
                >
                  <TableCell className="font-medium text-sm">
                    {match.match_date ? format(new Date(match.match_date), "MMM d, yyyy") : "Unknown"}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{match.child_a?.child_first_name} ({match.child_a?.age})</div>
                    <div className="text-xs text-muted-foreground">{match.child_a?.parent.state}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{match.child_b?.child_first_name} ({match.child_b?.age})</div>
                    <div className="text-xs text-muted-foreground">{match.child_b?.parent.state}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {match.shared_interests?.slice(0, 3).map((i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{i}</Badge>
                      ))}
                      {(match.shared_interests?.length || 0) > 3 && (
                        <span className="text-xs text-muted-foreground ml-1">
                          +{match.shared_interests!.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium text-green-600">
                      {matchDuration(match.match_date)}
                    </span>
                    <div className="text-[10px] text-muted-foreground">active</div>
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setCloseMatchId(match.id)}>
                        Close
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <MatchSheet
        match={selectedMatch}
        open={!!selectedMatchId}
        onClose={() => setSelectedMatchId(null)}
        isAdmin={isAdmin}
        onCloseMatch={(id) => setCloseMatchId(id)}
        onOpenChild={openChild}
      />

      <ChildSheet
        childId={childSheetId}
        open={childSheetOpen}
        onClose={() => setChildSheetOpen(false)}
        isAdmin={isAdmin}
        onOpenParent={openParentById}
      />

      <CloseMatchDialog
        matchId={closeMatchId}
        onOpenChange={(open) => !open && setCloseMatchId(null)}
        onSuccess={() => {
          setCloseMatchId(null);
          void refetch();
        }}
      />
    </div>
  );
}

function CloseMatchDialog({
  matchId,
  onOpenChange,
  onSuccess,
}: {
  matchId: string | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const updateMatch = useUpdateMatch();
  const { toast } = useToast();

  const handleClose = () => {
    if (!matchId || !reason) return;
    updateMatch.mutate(
      { id: matchId, data: { match_status: "Closed", close_reason: reason } },
      {
        onSuccess: () => {
          toast({ title: "Match closed" });
          onSuccess();
        },
      }
    );
  };

  return (
    <Dialog open={!!matchId} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close Match</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason for closing</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="parent_requested">Parent Requested</SelectItem>
                <SelectItem value="child_aged_out">Child Aged Out</SelectItem>
                <SelectItem value="subscription_cancelled">Subscription Cancelled</SelectItem>
                <SelectItem value="rematch_requested">Rematch Requested</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleClose}
            disabled={!reason || updateMatch.isPending}
            variant="destructive"
          >
            Close Match
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
