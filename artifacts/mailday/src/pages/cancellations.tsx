import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import {
  UserMinus, Search, Download, RotateCcw, AlertCircle, CheckCircle2,
  Clock, TrendingDown, TrendingUp, Minus, ChevronRight, MessageSquare,
  RefreshCw, XCircle, Users,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Cancellation {
  id: string;
  parent_id: string;
  child_id: string | null;
  recharge_subscription_id: string | null;
  cancellation_date: string;
  tenure_months: number;
  tier: string;
  billing_type: string;
  cancellation_reason_raw: string | null;
  cancellation_reason_category: string | null;
  save_attempted: boolean;
  save_outcome: string | null;
  save_notes: string | null;
  reactivated: boolean;
  reactivated_date: string | null;
  reactivated_by: string | null;
  created_at: string;
  updated_at: string;
  parent_first_name: string | null;
  parent_last_name: string | null;
  parent_email: string | null;
}

interface CancellationNote {
  id: string;
  cancellation_id: string;
  note_type: string;
  content: string;
  created_by: string | null;
  created_at: string;
}

interface CancellationDetail extends Cancellation {
  parent_db_id: string | null;
  notes: CancellationNote[];
}

interface TrendsData {
  by_month: { month: string; count: number }[];
  reasons_90_days: { name: string; value: number }[];
  reasons_12_months: { name: string; value: number }[];
  avg_tenure_by_tier: { tier: string; avg_tenure: number }[];
  net_change_by_month: { month: string; new_members: number; cancellations: number; net: number }[];
}

// ── Constants ──────────────────────────────────────────────────────────────────
const REASON_CATEGORIES = [
  "Price",
  "No pen pal letter exchange",
  "Wrong fit",
  "Moving",
  "Financial hardship",
  "Forgot to cancel",
  "Seasonal",
  "Child aged out",
  "Other",
] as const;

const TIERS = ["Core", "Minis", "Homeschool Core", "Homeschool Minis"];
const BILLING_TYPES = ["Monthly", "Annual"];
const CHART_COLORS = ["#e87060", "#f5a623", "#7ed321", "#4a90e2", "#9013fe", "#50e3c2", "#b8e986", "#f78fb3", "#3c40c4"];
const VIEWS = ["All", "Unprocessed", "Save Opportunities", "Trends"] as const;
type View = (typeof VIEWS)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysSince(d: string) {
  return Math.floor((Date.now() - new Date(d + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24));
}

function memberName(c: Cancellation) {
  const fn = c.parent_first_name ?? "";
  const ln = c.parent_last_name ?? "";
  return `${fn} ${ln}`.trim() || c.parent_email || "Unknown";
}

function ReasonBadge({ category }: { category: string | null }) {
  if (!category) return <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 text-xs">Needs review</Badge>;
  return <Badge variant="secondary" className="text-xs">{category}</Badge>;
}

function SaveBadge({ c }: { c: Cancellation }) {
  if (c.reactivated) return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Reactivated</Badge>;
  if (!c.save_attempted) return <Badge variant="outline" className="text-xs text-muted-foreground">Not attempted</Badge>;
  if (c.save_outcome === "Saved") return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Saved</Badge>;
  if (c.save_outcome === "Not Saved") return <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">Not saved</Badge>;
  return <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-xs">Attempted</Badge>;
}

function NoteTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    system: "bg-muted text-muted-foreground",
    note: "bg-blue-50 text-blue-700 border-blue-200",
    save_attempt: "bg-amber-50 text-amber-700 border-amber-200",
    reactivation: "bg-green-50 text-green-700 border-green-200",
  };
  const label: Record<string, string> = { system: "System", note: "Note", save_attempt: "Save Attempt", reactivation: "Reactivation" };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${map[type] ?? "bg-muted text-muted-foreground"}`}>{label[type] ?? type}</span>;
}

// ── Detail Sheet ──────────────────────────────────────────────────────────────
function CancellationSheet({
  cancellationId, open, onClose,
}: {
  cancellationId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: detail, isLoading } = useQuery<CancellationDetail>({
    queryKey: ["cancellation-detail", cancellationId],
    queryFn: () => customFetch<CancellationDetail>(`/api/cancellations/${cancellationId}`),
    enabled: !!cancellationId && open,
  });

  const [category, setCategory] = useState("");
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState("");
  const [saveNotes, setSaveNotes] = useState("");
  const [newNote, setNewNote] = useState("");

  useEffect(() => {
    if (detail) {
      setCategory(detail.cancellation_reason_category ?? "");
      setSaveAttempted(detail.save_attempted);
      setSaveOutcome(detail.save_outcome ?? "");
      setSaveNotes(detail.save_notes ?? "");
    }
  }, [detail]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cancellations"] });
    void queryClient.invalidateQueries({ queryKey: ["cancellation-detail", cancellationId] });
    void queryClient.invalidateQueries({ queryKey: ["cancellation-tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["action-items-count"] });
  };

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/api/cancellations/${cancellationId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { toast({ title: "Record updated" }); invalidate(); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const noteMutation = useMutation({
    mutationFn: (content: string) =>
      customFetch(`/api/cancellations/${cancellationId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }),
    onSuccess: () => { setNewNote(""); toast({ title: "Note added" }); invalidate(); },
    onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
  });

  const reactivateMutation = useMutation({
    mutationFn: () => customFetch(`/api/cancellations/${cancellationId}/reactivate`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Member reactivated" }); invalidate(); },
    onError: () => toast({ title: "Reactivation failed", variant: "destructive" }),
  });

  function handleSave() {
    const body: Record<string, unknown> = {};
    if (category && category !== (detail?.cancellation_reason_category ?? "")) body["cancellation_reason_category"] = category;
    if (saveAttempted !== detail?.save_attempted) body["save_attempted"] = saveAttempted;
    if (saveOutcome !== (detail?.save_outcome ?? "")) body["save_outcome"] = saveOutcome || null;
    if (saveNotes !== (detail?.save_notes ?? "")) body["save_notes"] = saveNotes || null;
    if (Object.keys(body).length === 0) { toast({ title: "No changes to save" }); return; }
    updateMutation.mutate(body);
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <UserMinus className="w-5 h-5 text-muted-foreground" />
            Cancellation Record
          </SheetTitle>
        </SheetHeader>

        {isLoading || !detail ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Member summary */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Member</div>
                <div className="font-semibold">{memberName(detail)}</div>
                {detail.parent_email && <div className="text-xs text-muted-foreground">{detail.parent_email}</div>}
                {detail.parent_db_id && (
                  <Link href={`/parents?id=${detail.parent_db_id}`} className="text-xs text-primary underline-offset-2 hover:underline">View profile</Link>
                )}
              </div>
              <div className="space-y-1">
                <div className="flex gap-2 text-sm"><span className="text-muted-foreground w-20">Tier</span><span className="font-medium">{detail.tier}</span></div>
                <div className="flex gap-2 text-sm"><span className="text-muted-foreground w-20">Billing</span><span className="font-medium">{detail.billing_type}</span></div>
                <div className="flex gap-2 text-sm"><span className="text-muted-foreground w-20">Tenure</span><span className="font-medium">{detail.tenure_months} month{detail.tenure_months !== 1 ? "s" : ""}</span></div>
                <div className="flex gap-2 text-sm"><span className="text-muted-foreground w-20">Cancelled</span><span className="font-medium">{fmtDate(detail.cancellation_date)}</span></div>
              </div>
            </div>

            {detail.cancellation_reason_raw && (
              <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm">
                <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium block mb-1">Raw Reason (ReCharge)</span>
                {detail.cancellation_reason_raw}
              </div>
            )}

            {detail.reactivated && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm">
                <div className="flex items-center gap-2 text-green-800 font-semibold"><CheckCircle2 className="w-4 h-4" /> Member Reactivated</div>
                {detail.reactivated_date && (
                  <div className="text-xs text-green-700 mt-1">{fmtDate(detail.reactivated_date)} by {detail.reactivated_by ?? "admin"}</div>
                )}
              </div>
            )}

            <Separator />

            {/* Reason category */}
            <div className="space-y-2">
              <label className="text-sm font-semibold">Cancellation Reason</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason category…" />
                </SelectTrigger>
                <SelectContent>
                  {REASON_CATEGORIES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Save attempt */}
            <div className="space-y-3">
              <label className="text-sm font-semibold">Save Attempt</label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={saveAttempted ? "default" : "outline"}
                  onClick={() => { setSaveAttempted(true); }}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Attempted
                </Button>
                <Button
                  size="sm"
                  variant={!saveAttempted ? "outline" : "ghost"}
                  onClick={() => { setSaveAttempted(false); setSaveOutcome(""); }}
                >
                  <XCircle className="w-3 h-3 mr-1" /> Not attempted
                </Button>
              </div>

              {saveAttempted && (
                <div className="space-y-2">
                  <Select value={saveOutcome} onValueChange={setSaveOutcome}>
                    <SelectTrigger>
                      <SelectValue placeholder="Outcome…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Saved">Saved</SelectItem>
                      <SelectItem value="Not Saved">Not Saved</SelectItem>
                      <SelectItem value="No Response">No Response</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Save notes (optional)…"
                    value={saveNotes}
                    onChange={(e) => setSaveNotes(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={updateMutation.isPending} className="flex-1">
                {updateMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
              {saveOutcome === "Saved" && !detail.reactivated && (
                <Button
                  variant="outline"
                  className="border-green-300 text-green-700 hover:bg-green-50"
                  disabled={reactivateMutation.isPending}
                  onClick={() => reactivateMutation.mutate()}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Reactivate Member
                </Button>
              )}
            </div>

            <Separator />

            {/* Notes timeline */}
            <div className="space-y-3">
              <div className="text-sm font-semibold flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                Notes
              </div>

              {detail.notes.length === 0 && (
                <div className="text-sm text-muted-foreground italic">No notes yet.</div>
              )}

              {detail.notes.map((note) => (
                <div key={note.id} className="rounded-lg border bg-muted/20 px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <NoteTypeBadge type={note.note_type} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(note.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {note.created_by && note.created_by !== "system" && ` · ${note.created_by}`}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                </div>
              ))}

              <div className="flex gap-2 pt-1">
                <Input
                  placeholder="Add a note…"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && newNote.trim()) { e.preventDefault(); noteMutation.mutate(newNote.trim()); } }}
                />
                <Button
                  variant="outline"
                  disabled={!newNote.trim() || noteMutation.isPending}
                  onClick={() => noteMutation.mutate(newNote.trim())}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Trends View ───────────────────────────────────────────────────────────────
function TrendsView() {
  const { data: trends, isLoading } = useQuery<TrendsData>({
    queryKey: ["cancellation-trends"],
    queryFn: () => customFetch<TrendsData>("/api/cancellations/trends"),
    refetchInterval: 300000,
  });
  const [reasonWindow, setReasonWindow] = useState<"90" | "12">("90");

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
      </div>
    );
  }

  const reasonData = reasonWindow === "90" ? trends?.reasons_90_days : trends?.reasons_12_months;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Monthly cancellations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Cancellations by Month</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trends?.by_month ?? []} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="count" name="Cancellations" fill="#e87060" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Reason breakdown */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Cancellation Reasons</CardTitle>
          <div className="flex gap-1">
            <Button size="sm" variant={reasonWindow === "90" ? "secondary" : "ghost"} className="h-6 text-xs px-2" onClick={() => setReasonWindow("90")}>90d</Button>
            <Button size="sm" variant={reasonWindow === "12" ? "secondary" : "ghost"} className="h-6 text-xs px-2" onClick={() => setReasonWindow("12")}>12m</Button>
          </div>
        </CardHeader>
        <CardContent>
          {!reasonData?.length ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={reasonData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {reasonData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Net member change */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Net Member Change by Month</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trends?.net_change_by_month ?? []} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="new_members" name="New" stroke="#7ed321" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="cancellations" name="Cancelled" stroke="#e87060" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="net" name="Net" stroke="#4a90e2" strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Avg tenure by tier */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Avg Tenure at Cancellation by Tier</CardTitle>
        </CardHeader>
        <CardContent>
          {!trends?.avg_tenure_by_tier?.length ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trends.avg_tenure_by_tier} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 11 }} unit="mo" />
                <YAxis type="category" dataKey="tier" tick={{ fontSize: 11 }} width={110} />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => [`${v} months`, "Avg tenure"]} />
                <Bar dataKey="avg_tenure" name="Avg tenure (mo)" fill="#4a90e2" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Cancellations() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [view, setView] = useState<View>("All");
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [filterReason, setFilterReason] = useState("all");
  const [filterBilling, setFilterBilling] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const queryClient = useQueryClient();

  // Support direct link from action items: /cancellations?id=<uuid>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) { setSelectedId(id); setSheetOpen(true); }
  }, []);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (filterTier && filterTier !== "all") p.set("tier", filterTier);
    if (filterBilling && filterBilling !== "all") p.set("billing_type", filterBilling);
    if (filterReason && filterReason !== "all" && view === "All") p.set("reason_category", filterReason);
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (view === "Unprocessed") p.set("view", "unprocessed");
    if (view === "Save Opportunities") p.set("view", "save_opportunities");
    return p.toString();
  }, [filterTier, filterBilling, filterReason, dateFrom, dateTo, view]);

  const { data: cancellations, isLoading } = useQuery<Cancellation[]>({
    queryKey: ["cancellations", queryParams],
    queryFn: () => customFetch<Cancellation[]>(`/api/cancellations${queryParams ? "?" + queryParams : ""}`),
    enabled: view !== "Trends",
    refetchInterval: 60000,
    retry: false,
  });

  const filtered = useMemo(() => {
    let rows = cancellations ?? [];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        `${r.parent_first_name ?? ""} ${r.parent_last_name ?? ""} ${r.parent_email ?? ""}`.toLowerCase().includes(q)
      );
    }
    if (view === "Save Opportunities") {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      rows = rows.filter((r) => new Date(r.cancellation_date + "T00:00:00") <= sevenDaysAgo);
    }
    return rows;
  }, [cancellations, search, view]);

  function openRecord(id: string) {
    setSelectedId(id);
    setSheetOpen(true);
  }

  function resetFilters() {
    setSearch("");
    setFilterTier("all");
    setFilterReason("all");
    setFilterBilling("all");
    setDateFrom("");
    setDateTo("");
  }

  function exportCSV() {
    const headers = ["Member Name", "Email", "Tier", "Billing", "Tenure (months)", "Cancellation Date", "Reason Category", "Save Attempted", "Save Outcome", "Reactivated"];
    const rows = filtered.map((r) => [
      memberName(r),
      r.parent_email ?? "",
      r.tier,
      r.billing_type,
      r.tenure_months,
      r.cancellation_date,
      r.cancellation_reason_category ?? "",
      r.save_attempted ? "Yes" : "No",
      r.save_outcome ?? "",
      r.reactivated ? "Yes" : "No",
    ]);
    const csv = [headers, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `cancellations-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  }

  const unprocessedCount = (cancellations ?? []).filter((r) => !r.cancellation_reason_category).length;
  const saveOppsCount = useMemo(() => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return (cancellations ?? []).filter((r) => !r.save_attempted && new Date(r.cancellation_date + "T00:00:00") <= sevenDaysAgo).length;
  }, [cancellations]);

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <UserMinus className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
        <p>Access restricted to admins.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-heading font-bold">Cancellation Tracker</h1>
          <p className="text-sm text-muted-foreground mt-1">Track churn, categorise reasons, and log save attempts.</p>
        </div>
        {view !== "Trends" && (
          <Button variant="outline" size="sm" onClick={exportCSV} className="shrink-0">
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export CSV
          </Button>
        )}
      </div>

      {/* View tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {VIEWS.map((v) => (
          <button
            key={v}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors relative ${view === v ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setView(v)}
          >
            {v}
            {v === "Unprocessed" && unprocessedCount > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unprocessedCount}</span>
            )}
            {v === "Save Opportunities" && saveOppsCount > 0 && (
              <span className="ml-1.5 bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{saveOppsCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Filters (All view only) */}
      {view === "All" && (
        <div className="flex flex-wrap gap-2 items-end">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search member…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 w-48"
            />
          </div>
          <Select value={filterTier} onValueChange={setFilterTier}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="All tiers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              {TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterBilling} onValueChange={setFilterBilling}>
            <SelectTrigger className="h-9 w-32"><SelectValue placeholder="All billing" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All billing</SelectItem>
              {BILLING_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterReason} onValueChange={setFilterReason}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="All reasons" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              <SelectItem value="unset">Needs review</SelectItem>
              {REASON_CATEGORIES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-36" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-36" />
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9">
            <RotateCcw className="w-3 h-3 mr-1" />Reset
          </Button>
        </div>
      )}

      {/* Content area */}
      {view === "Trends" ? (
        <TrendsView />
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-400" />
          <div className="font-medium text-muted-foreground">
            {view === "Unprocessed" ? "All cancellations have been categorised." :
             view === "Save Opportunities" ? "No save opportunities open right now." :
             "No cancellations match your filters."}
          </div>
        </div>
      ) : view === "All" ? (
        /* All view — table */
        <div className="rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Member</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Tier</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Billing</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Tenure</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Cancelled</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Reason</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wide">Save</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => openRecord(c.id)}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{memberName(c)}</div>
                      {c.parent_email && <div className="text-xs text-muted-foreground">{c.parent_email}</div>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap"><Badge variant="secondary" className="text-xs">{c.tier}</Badge></td>
                    <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{c.billing_type}</td>
                    <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{c.tenure_months}mo</td>
                    <td className="px-3 py-3 whitespace-nowrap">{fmtDate(c.cancellation_date)}</td>
                    <td className="px-3 py-3"><ReasonBadge category={c.cancellation_reason_category} /></td>
                    <td className="px-3 py-3"><SaveBadge c={c} /></td>
                    <td className="px-3 py-3"><ChevronRight className="w-4 h-4 text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
            {filtered.length} record{filtered.length !== 1 ? "s" : ""}
          </div>
        </div>
      ) : view === "Unprocessed" ? (
        /* Unprocessed — card list */
        <div className="space-y-2">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-amber-200 bg-amber-50/40 px-4 py-3 flex items-center gap-4 hover:bg-amber-50/80 transition-colors cursor-pointer"
              onClick={() => openRecord(c.id)}
            >
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{memberName(c)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {c.tier} · {c.billing_type} · {c.tenure_months}mo · Cancelled {fmtDate(c.cancellation_date)} ({daysSince(c.cancellation_date)} days ago)
                </div>
                {c.cancellation_reason_raw && (
                  <div className="text-xs text-muted-foreground mt-0.5 italic truncate">"{c.cancellation_reason_raw}"</div>
                )}
              </div>
              <Button size="sm" variant="outline" className="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100">
                Process <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        /* Save Opportunities — card list */
        <div className="space-y-2">
          {filtered.map((c) => {
            const days = daysSince(c.cancellation_date);
            return (
              <div
                key={c.id}
                className="rounded-xl border border-blue-200 bg-blue-50/40 px-4 py-3 flex items-center gap-4 hover:bg-blue-50/80 transition-colors cursor-pointer"
                onClick={() => openRecord(c.id)}
              >
                <Clock className="w-5 h-5 text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{memberName(c)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {c.tier} · {c.billing_type} · Cancelled {fmtDate(c.cancellation_date)} · <span className={`font-semibold ${days >= 21 ? "text-red-600" : "text-blue-700"}`}>{days} days ago</span>
                  </div>
                  {c.cancellation_reason_category && (
                    <div className="text-xs text-muted-foreground mt-0.5">Reason: {c.cancellation_reason_category}</div>
                  )}
                </div>
                <Button size="sm" variant="outline" className="shrink-0 border-blue-300 text-blue-800 hover:bg-blue-100">
                  Log Save <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <CancellationSheet
        cancellationId={selectedId}
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["cancellations"] });
        }}
      />
    </div>
  );
}
