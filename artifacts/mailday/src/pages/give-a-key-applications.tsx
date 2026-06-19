import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { differenceInDays, parseISO } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2, Clock, XCircle, AlertTriangle, Send,
  Eye, ExternalLink, Receipt,
} from "lucide-react";

interface Application {
  id: string;
  parent_first_name: string;
  parent_last_name: string;
  parent_email: string;
  parent_phone?: string;
  state: string;
  mailing_address: string;
  address_type: string;
  child_first_name: string;
  child_age: number;
  child_interests: string[];
  statement_of_need: string;
  po_box_acknowledgment: boolean;
  subscription_acknowledgment: boolean;
  application_status: string;
  application_date: string;
  rejection_reason?: string;
  tremendous_sent: boolean;
  amount_disbursed?: number;
  internal_notes?: string;
  activation_date?: string;
  po_box_address?: string;
  po_box_receipt_url?: string;
  receipt_verified: boolean;
  tremendous_sent_at?: string;
}

const STATUS_TABS = ["All", "Pending", "Approved", "Waitlisted", "Active", "Rejected"];

function statusBadge(status: string) {
  const map: Record<string, string> = {
    Pending: "bg-amber-100 text-amber-800 border-amber-200",
    Approved: "bg-blue-100 text-blue-800 border-blue-200",
    Waitlisted: "bg-orange-100 text-orange-800 border-orange-200",
    Active: "bg-green-100 text-green-800 border-green-200",
    Rejected: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <Badge className={`border text-xs font-semibold ${map[status] || "bg-gray-100 text-gray-700"}`}>
      {status}
    </Badge>
  );
}

function daysSince(dateStr: string) {
  try {
    return differenceInDays(new Date(), parseISO(dateStr));
  } catch {
    return 0;
  }
}

export default function GiveAKeyApplications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState("All");
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmWaitlist, setConfirmWaitlist] = useState(false);
  const [search, setSearch] = useState("");
  const [disbursedOpen, setDisbursedOpen] = useState(false);
  const [disbursedAmount, setDisbursedAmount] = useState("");
  const [notesValue, setNotesValue] = useState("");

  const queryString = useSearch();
  const openId = new URLSearchParams(queryString).get("open");

  const { data: applications = [], isLoading } = useQuery<Application[]>({
    queryKey: ["gak-applications"],
    queryFn: () => customFetch("/api/give-a-key/applications"),
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (openId && applications.length > 0 && !selectedApp) {
      const match = applications.find((a) => a.id === openId);
      if (match) {
        setSelectedApp(match);
        setNotesValue(match.internal_notes ?? "");
      }
    }
  }, [openId, applications]);

  const statusMutation = useMutation({
    mutationFn: ({ id, action, rejection_reason }: { id: string; action: string; rejection_reason?: string }) =>
      customFetch(`/api/give-a-key/applications/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ action, rejection_reason }),
      }),
    onSuccess: (data: { status: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["gak-applications"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-fund"] });
      const wasAutoWaitlisted = data.status === "Waitlisted";
      toast({
        title: wasAutoWaitlisted ? "Moved to waitlist" : `Application ${data.status.toLowerCase()}`,
        description: wasAutoWaitlisted ? "Insufficient fund balance — application waitlisted automatically." : undefined,
      });
      if (selectedApp?.id) {
        setSelectedApp((prev) => prev ? { ...prev, application_status: data.status } : null);
      }
      setRejectOpen(false);
      setRejectReason("");
    },
    onError: (err) => toast({ title: "Action failed", description: err.message, variant: "destructive" }),
  });

  const notesMutation = useMutation({
    mutationFn: ({ id, internal_notes }: { id: string; internal_notes: string }) =>
      customFetch(`/api/give-a-key/applications/${id}/notes`, {
        method: "PATCH",
        body: JSON.stringify({ internal_notes }),
      }),
    onSuccess: (_, { internal_notes }) => {
      void queryClient.invalidateQueries({ queryKey: ["gak-applications"] });
      toast({ title: "Notes saved" });
      setSelectedApp((prev) => prev ? { ...prev, internal_notes } : null);
    },
    onError: (err) => toast({ title: "Failed to save notes", description: err.message, variant: "destructive" }),
  });

  const setStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      customFetch(`/api/give-a-key/applications/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ action: "set", status }),
      }),
    onSuccess: (_, { status }) => {
      void queryClient.invalidateQueries({ queryKey: ["gak-applications"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-fund"] });
      toast({ title: `Status set to ${status}` });
      setSelectedApp((prev) => prev ? { ...prev, application_status: status } : null);
    },
    onError: (err) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const tremendousMutation = useMutation({
    mutationFn: ({ id, amount_disbursed }: { id: string; amount_disbursed?: number }) =>
      customFetch(`/api/give-a-key/applications/${id}/tremendous-sent`, {
        method: "PATCH",
        body: JSON.stringify({ amount_disbursed }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gak-applications"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-fund"] });
      toast({ title: "Marked as sent", description: "Amount recorded — dashboard dispersed total updated." });
      setSelectedApp((prev) => prev ? { ...prev, tremendous_sent: true } : null);
      setDisbursedOpen(false);
      setDisbursedAmount("");
    },
    onError: (err) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/give-a-key/applications/${id}/verify-receipt`, { method: "PATCH", body: JSON.stringify({}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gak-applications"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-fund"] });
      toast({ title: "Receipt verified — family activated!", description: "Parent and child records have been created." });
      setSelectedApp((prev) => prev ? { ...prev, receipt_verified: true, application_status: "Active" } : null);
    },
    onError: (err) => toast({ title: "Verification failed", description: err.message, variant: "destructive" }),
  });

  const filtered = applications.filter((a) => {
    const matchesTab = activeTab === "All" || a.application_status === activeTab;
    const q = search.toLowerCase();
    const matchesSearch = !q || [a.parent_first_name, a.parent_last_name, a.parent_email, a.child_first_name, a.state]
      .some((f) => f?.toLowerCase().includes(q));
    return matchesTab && matchesSearch;
  });

  const isPending = statusMutation.isPending || tremendousMutation.isPending || verifyMutation.isPending;

  const doApprove = () => selectedApp && statusMutation.mutate({ id: selectedApp.id, action: "approve" });
  const doWaitlist = () => selectedApp && statusMutation.mutate({ id: selectedApp.id, action: "waitlist" });
  const doReject = () => {
    if (!rejectReason.trim() || !selectedApp) return;
    statusMutation.mutate({ id: selectedApp.id, action: "reject", rejection_reason: rejectReason.trim() });
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Applications</h1>
          <p className="text-sm text-muted-foreground">Review and action Give a Key applications</p>
        </div>
        <div className="text-sm text-muted-foreground shrink-0">
          {filtered.length} {filtered.length === 1 ? "app" : "apps"}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {/* Scrollable tab strip on mobile */}
        <div className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-max">
              {STATUS_TABS.map((t) => {
                const count = t === "All" ? applications.length : applications.filter((a) => a.application_status === t).length;
                return (
                  <TabsTrigger key={t} value={t} className="text-xs">
                    {t} {count > 0 && <span className="ml-1 text-xs opacity-60">({count})</span>}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>
        <Input
          placeholder="Search by name, email, state…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 text-sm"
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Loading applications…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">No applications found.</p>
      ) : (
        <>
          {/* Desktop table — hidden on mobile */}
          <div className="hidden md:block rounded-xl border overflow-x-auto">
            <table className="w-full text-sm min-w-[780px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Child</th>
                  <th className="text-left px-4 py-3 font-medium">Parent</th>
                  <th className="text-left px-4 py-3 font-medium">State</th>
                  <th className="text-left px-4 py-3 font-medium">Age</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Days</th>
                  <th className="text-left px-4 py-3 font-medium">Flags</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((app, i) => {
                  const days = daysSince(app.application_date);
                  const hasReceipt = !!app.po_box_receipt_url && !app.receipt_verified;
                  const needsTremendous = app.application_status === "Approved" && !app.tremendous_sent;
                  return (
                    <tr key={app.id} onClick={() => { setSelectedApp(app); setNotesValue(app.internal_notes ?? ""); }} className={`border-t cursor-pointer ${i % 2 === 0 ? "bg-background" : "bg-muted/20"} hover:bg-muted/40 transition-colors`}>
                      <td className="px-4 py-3 font-medium">{app.child_first_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{app.parent_first_name} {app.parent_last_name}</td>
                      <td className="px-4 py-3">{app.state}</td>
                      <td className="px-4 py-3">{app.child_age}</td>
                      <td className="px-4 py-3">{statusBadge(app.application_status)}</td>
                      <td className="px-4 py-3">
                        <span className={days > 7 ? "text-red-600 font-semibold" : days > 3 ? "text-amber-600" : "text-muted-foreground"}>
                          {days}d
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {needsTremendous && <Badge className="bg-amber-100 text-amber-800 border border-amber-200 text-xs">Send funds</Badge>}
                          {hasReceipt && <Badge className="bg-blue-100 text-blue-800 border border-blue-200 text-xs">Receipt in</Badge>}
                          {app.tremendous_sent && !app.receipt_verified && !app.po_box_receipt_url && (() => {
                            const sentAt = app.tremendous_sent_at ?? app.application_date;
                            const d = daysSince(sentAt);
                            const cls = d >= 14 ? "bg-red-100 text-red-800 border-red-200" : d >= 7 ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-gray-100 text-gray-600 border-gray-200";
                            return <Badge className={`border text-xs ${cls}`}>Awaiting receipt {d}d</Badge>;
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedApp(app)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list — hidden on desktop */}
          <div className="md:hidden space-y-3">
            {filtered.map((app) => {
              const days = daysSince(app.application_date);
              const hasReceipt = !!app.po_box_receipt_url && !app.receipt_verified;
              const needsTremendous = app.application_status === "Approved" && !app.tremendous_sent;
              return (
                <button
                  key={app.id}
                  onClick={() => { setSelectedApp(app); setNotesValue(app.internal_notes ?? ""); }}
                  className="w-full text-left rounded-xl border bg-background p-4 space-y-2.5 active:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm">{app.child_first_name} · age {app.child_age}</div>
                      <div className="text-xs text-muted-foreground truncate">{app.parent_first_name} {app.parent_last_name}</div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {statusBadge(app.application_status)}
                      <span className={`text-xs font-medium ${days > 7 ? "text-red-600" : days > 3 ? "text-amber-600" : "text-muted-foreground"}`}>
                        {days}d ago
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{app.state} · {app.address_type}</div>
                  {(needsTremendous || hasReceipt) && (
                    <div className="flex flex-wrap gap-1.5">
                      {needsTremendous && <Badge className="bg-amber-100 text-amber-800 border border-amber-200 text-xs">Send funds</Badge>}
                      {hasReceipt && <Badge className="bg-blue-100 text-blue-800 border border-blue-200 text-xs">Receipt in</Badge>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Application detail sheet */}
      <Sheet open={!!selectedApp} onOpenChange={(open) => { if (!open) setSelectedApp(null); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedApp && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="flex items-center gap-2">
                  {selectedApp.child_first_name}'s Application
                  {statusBadge(selectedApp.application_status)}
                </SheetTitle>
                <p className="text-sm text-muted-foreground">
                  Submitted {daysSince(selectedApp.application_date)} days ago · {selectedApp.state}
                </p>
              </SheetHeader>

              <div className="space-y-5">
                {/* Banners */}
                {selectedApp.application_status === "Approved" && !selectedApp.tremendous_sent && (
                  <Alert className="border-amber-300 bg-amber-50">
                    <Send className="w-4 h-4 text-amber-600" />
                    <AlertDescription className="text-amber-800">
                      <strong>Send funds via Tremendous before notifying family.</strong> Once sent, mark it below.
                    </AlertDescription>
                  </Alert>
                )}
                {selectedApp.po_box_receipt_url && !selectedApp.receipt_verified && (
                  <Alert className="border-blue-300 bg-blue-50">
                    <Receipt className="w-4 h-4 text-blue-600" />
                    <AlertDescription className="text-blue-800">
                      Receipt submitted — pending verification.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Status changer */}
                {isAdmin && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</p>
                    <Select
                      value={selectedApp.application_status}
                      onValueChange={(status) => setStatusMutation.mutate({ id: selectedApp.id, status })}
                      disabled={setStatusMutation.isPending}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Pending", "Approved", "Waitlisted", "Active", "Rejected"].map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Parent */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Parent</p>
                  <p className="font-medium">{selectedApp.parent_first_name} {selectedApp.parent_last_name}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-muted-foreground">{selectedApp.parent_email}</p>
                    <button
                      onClick={() => void navigator.clipboard.writeText(selectedApp.parent_email)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy email"
                    >
                      <span className="text-xs border rounded px-1.5 py-0.5 hover:bg-muted/50">Copy</span>
                    </button>
                  </div>
                  {selectedApp.parent_phone && <p className="text-sm text-muted-foreground">{selectedApp.parent_phone}</p>}
                  <p className="text-sm text-muted-foreground">{selectedApp.mailing_address}</p>
                </div>

                {/* Child */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Child</p>
                  <p className="font-medium">{selectedApp.child_first_name}, age {selectedApp.child_age}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(selectedApp.child_interests || []).map((interest) => (
                      <Badge key={interest} variant="secondary" className="text-xs">{interest}</Badge>
                    ))}
                  </div>
                </div>

                {/* Statement */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Statement of Need</p>
                  <p className="text-sm leading-relaxed bg-muted/50 rounded-lg p-3">{selectedApp.statement_of_need}</p>
                </div>

                {/* PO Box details (if submitted) */}
                {selectedApp.po_box_address && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">PO Box Address</p>
                    <p className="text-sm font-medium">{selectedApp.po_box_address}</p>
                    {selectedApp.po_box_receipt_url && (
                      <a
                        href={selectedApp.po_box_receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View receipt
                      </a>
                    )}
                  </div>
                )}

                {/* Rejection reason */}
                {selectedApp.rejection_reason && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rejection Reason</p>
                    <p className="text-sm bg-red-50 text-red-800 rounded-lg p-3">{selectedApp.rejection_reason}</p>
                  </div>
                )}

                {/* Actions */}
                {["Pending"].includes(selectedApp.application_status) && (
                  <div className="space-y-3 pt-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</p>
                    <div className="grid grid-cols-3 gap-2">
                      <Button className="bg-green-600 hover:bg-green-700 text-white h-11 text-sm" onClick={doApprove} disabled={isPending}>
                        <CheckCircle2 className="w-4 h-4 mr-1.5 shrink-0" />
                        Approve
                      </Button>
                      <Button className="bg-orange-500 hover:bg-orange-600 text-white h-11 text-sm" onClick={() => setConfirmWaitlist(true)} disabled={isPending}>
                        <Clock className="w-4 h-4 mr-1.5 shrink-0" />
                        Waitlist
                      </Button>
                      <Button className="bg-red-600 hover:bg-red-700 text-white h-11 text-sm" onClick={() => setRejectOpen(true)} disabled={isPending}>
                        <XCircle className="w-4 h-4 mr-1.5 shrink-0" />
                        Reject
                      </Button>
                    </div>
                  </div>
                )}

                {/* Tremendous tracking */}
                {selectedApp.application_status === "Approved" && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5" /> Tremendous
                    </p>
                    {selectedApp.tremendous_sent ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                          <CheckCircle2 className="w-4 h-4" /> Funds sent
                        </div>
                        {selectedApp.amount_disbursed ? (
                          <p className="text-sm font-semibold">${selectedApp.amount_disbursed.toFixed(2)} disbursed</p>
                        ) : (
                          <p className="text-xs text-amber-600">Amount not recorded — dashboard uses estimate</p>
                        )}
                        {selectedApp.tremendous_sent_at && (
                          <p className="text-xs text-muted-foreground">
                            Sent {daysSince(selectedApp.tremendous_sent_at)}d ago
                            {!selectedApp.receipt_verified && !selectedApp.po_box_receipt_url && (() => {
                              const d = daysSince(selectedApp.tremendous_sent_at!);
                              if (d >= 14) return <span className="ml-1.5 font-semibold text-red-600">— no receipt yet (overdue)</span>;
                              if (d >= 7) return <span className="ml-1.5 font-medium text-amber-600">— no receipt yet</span>;
                              return null;
                            })()}
                          </p>
                        )}
                      </div>
                    ) : (
                      <Button
                        className="w-full"
                        variant="outline"
                        size="sm"
                        onClick={() => { setDisbursedAmount(""); setDisbursedOpen(true); }}
                        disabled={isPending}
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Mark funds sent &amp; record amount
                      </Button>
                    )}
                  </div>
                )}

                {isAdmin && selectedApp.po_box_receipt_url && !selectedApp.receipt_verified && (
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => verifyMutation.mutate(selectedApp.id)}
                    disabled={isPending}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Verify receipt &amp; activate membership
                  </Button>
                )}

                {selectedApp.application_status === "Active" && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    Active — {selectedApp.child_first_name} is in the matching queue
                  </div>
                )}

                {/* Internal notes */}
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Internal Notes</p>
                  <Textarea
                    rows={4}
                    placeholder="Add private notes — rejection reasons, context, follow-up reminders…"
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    className="text-sm resize-none"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => notesMutation.mutate({ id: selectedApp.id, internal_notes: notesValue })}
                    disabled={notesMutation.isPending || notesValue === (selectedApp.internal_notes ?? "")}
                  >
                    {notesMutation.isPending ? "Saving…" : "Save notes"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Disbursed amount dialog */}
      <Dialog open={disbursedOpen} onOpenChange={(open) => { if (!open) { setDisbursedOpen(false); setDisbursedAmount(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record amount sent via Tremendous</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Enter the exact amount you sent to <strong>{selectedApp?.parent_first_name} {selectedApp?.parent_last_name}</strong>. This is used to track actual funds dispersed on the dashboard.
            </p>
            <div className="space-y-1.5">
              <Label>Amount sent ($) <span className="text-destructive">*</span></Label>
              <Input
                type="number"
                min={1}
                step={0.01}
                value={disbursedAmount}
                onChange={(e) => setDisbursedAmount(e.target.value)}
                placeholder="75.00"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDisbursedOpen(false); setDisbursedAmount(""); }}>Cancel</Button>
            <Button
              onClick={() => selectedApp && tremendousMutation.mutate({ id: selectedApp.id, amount_disbursed: Number(disbursedAmount) })}
              disabled={!disbursedAmount || Number(disbursedAmount) <= 0 || tremendousMutation.isPending}
            >
              <Send className="w-4 h-4 mr-2" />
              {tremendousMutation.isPending ? "Saving…" : "Confirm & mark sent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waitlist confirmation dialog */}
      <Dialog open={confirmWaitlist} onOpenChange={(open) => { if (!open) setConfirmWaitlist(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Waitlist?</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              This family will be notified that they're approved but waiting for fund availability. They'll be activated when the fund balance allows.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmWaitlist(false)}>Cancel</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => { setConfirmWaitlist(false); doWaitlist(); }}
              disabled={statusMutation.isPending}
            >
              <Clock className="w-4 h-4 mr-2" />
              Confirm Waitlist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={(open) => { if (!open) { setRejectOpen(false); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Application</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Rejection is only for fraudulent or clearly ineligible applications. Fund shortfalls should use Waitlist instead.
            </p>
            <div className="space-y-1.5">
              <Label>Rejection reason <span className="text-destructive">*</span></Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Briefly explain why this application is being rejected…"
                className="min-h-24 resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={doReject}
              disabled={!rejectReason.trim() || statusMutation.isPending}
            >
              {statusMutation.isPending ? "Rejecting…" : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
