import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import {
  ExternalLink, Plus, Trash2, TrendingUp, Users, DollarSign,
  Link2, ChevronRight, MessageSquare, Star
} from "lucide-react";

interface Influencer {
  id: string;
  first_name: string;
  last_name: string;
  instagram_handle?: string;
  tiktok_handle?: string;
  platform: string;
  follower_count: number;
  tier: string;
  affiliate_code?: string;
  affiliate_link?: string;
  clicks: number;
  conversions: number;
  commission_rate: number;
  revenue_per_conversion: number;
  commission_owed: number;
  commission_paid: number;
  outreach_status: string;
  last_outreach_date?: string;
  last_content_posted_url?: string;
  created_at: string;
  updated_at: string;
}

interface InfluencerDetail extends Influencer {
  notes: Array<{ id: string; note_type: string; content: string; created_at: string }>;
  content: Array<{ id: string; url: string; created_at: string }>;
}

const PLATFORMS = ["Instagram", "TikTok", "Both", "Other"];
const TIERS = ["Nano", "Micro", "Mid", "Macro"];
const OUTREACH_STATUSES = ["Not Contacted", "Contacted", "Active Partner", "Declined", "Inactive"];

const VIEWS = ["All Influencers", "Active Partners", "Top Performers", "Commission Due", "Outreach Queue"];

function tierBadge(tier: string) {
  const map: Record<string, string> = {
    Nano: "bg-slate-100 text-slate-700 border-slate-200",
    Micro: "bg-blue-100 text-blue-700 border-blue-200",
    Mid: "bg-purple-100 text-purple-700 border-purple-200",
    Macro: "bg-amber-100 text-amber-700 border-amber-200",
  };
  return <Badge className={`border text-xs font-semibold ${map[tier] || "bg-gray-100 text-gray-700"}`}>{tier}</Badge>;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    "Not Contacted": "bg-gray-100 text-gray-600 border-gray-200",
    "Contacted": "bg-blue-100 text-blue-700 border-blue-200",
    "Active Partner": "bg-green-100 text-green-700 border-green-200",
    "Declined": "bg-red-100 text-red-700 border-red-200",
    "Inactive": "bg-slate-100 text-slate-500 border-slate-200",
  };
  return <Badge className={`border text-xs font-semibold ${map[status] || "bg-gray-100"}`}>{status}</Badge>;
}

function fmt$(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

const BLANK: Partial<Influencer> = {
  platform: "Instagram", tier: "Nano", outreach_status: "Not Contacted",
  follower_count: 0, clicks: 0, conversions: 0, commission_rate: 10, revenue_per_conversion: 14, commission_paid: 0,
};

export default function Influencers() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState("All Influencers");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterTier, setFilterTier] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selected, setSelected] = useState<InfluencerDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logTarget, setLogTarget] = useState<Influencer | null>(null);
  const [form, setForm] = useState<Partial<Influencer>>(BLANK);
  const [noteText, setNoteText] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [logNote, setLogNote] = useState("");
  const [logStatus, setLogStatus] = useState("Contacted");

  const { data: influencers = [], isLoading } = useQuery<Influencer[]>({
    queryKey: ["influencers", filterPlatform, filterTier, filterStatus],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterPlatform !== "all") params.set("platform", filterPlatform);
      if (filterTier !== "all") params.set("tier", filterTier);
      if (filterStatus !== "all") params.set("outreach_status", filterStatus);
      return customFetch(`/api/influencers?${params}`);
    },
  });

  const openDetail = async (id: string) => {
    const data = await customFetch<InfluencerDetail>(`/api/influencers/${id}`);
    setSelected(data);
    setDetailOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: (body: Partial<Influencer>) => customFetch("/api/influencers", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["influencers"] }); setAddOpen(false); setForm(BLANK); toast({ title: "Influencer added" }); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: Partial<Influencer> & { id: string }) => customFetch<Influencer>(`/api/influencers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ["influencers"] });
      const updated = await customFetch<InfluencerDetail>(`/api/influencers/${data.id}`);
      setSelected(updated);
      toast({ title: "Saved" });
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addNoteMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => customFetch(`/api/influencers/${id}/notes`, { method: "POST", body: JSON.stringify({ content }) }),
    onSuccess: async () => {
      if (selected) {
        const updated = await customFetch<InfluencerDetail>(`/api/influencers/${selected.id}`);
        setSelected(updated);
      }
      setNoteText("");
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addContentMutation = useMutation({
    mutationFn: ({ id, url }: { id: string; url: string }) => customFetch(`/api/influencers/${id}/content`, { method: "POST", body: JSON.stringify({ url }) }),
    onSuccess: async () => {
      if (selected) {
        const updated = await customFetch<InfluencerDetail>(`/api/influencers/${selected.id}`);
        setSelected(updated);
      }
      setNewUrl("");
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteContentMutation = useMutation({
    mutationFn: (contentId: string) => customFetch(`/api/influencers/content/${contentId}`, { method: "DELETE" }),
    onSuccess: async () => {
      if (selected) {
        const updated = await customFetch<InfluencerDetail>(`/api/influencers/${selected.id}`);
        setSelected(updated);
      }
    },
  });

  const logOutreachMutation = useMutation({
    mutationFn: ({ id, outreach_status, note }: { id: string; outreach_status: string; note: string }) =>
      Promise.all([
        customFetch(`/api/influencers/${id}`, { method: "PATCH", body: JSON.stringify({ outreach_status, last_outreach_date: new Date().toISOString().split("T")[0] }) }),
        note.trim() ? customFetch(`/api/influencers/${id}/notes`, { method: "POST", body: JSON.stringify({ content: note }) }) : Promise.resolve(),
      ]),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["influencers"] }); setLogOpen(false); setLogNote(""); toast({ title: "Outreach logged" }); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // View filtering
  const viewed = (() => {
    const all = influencers;
    if (view === "Active Partners") return all.filter((i) => i.outreach_status === "Active Partner");
    if (view === "Top Performers") return [...all].sort((a, b) => b.conversions - a.conversions);
    if (view === "Commission Due") return all.filter((i) => i.commission_owed > 0 && i.commission_paid < i.commission_owed).sort((a, b) => (b.commission_owed - b.commission_paid) - (a.commission_owed - a.commission_paid));
    if (view === "Outreach Queue") return all.filter((i) => i.outreach_status === "Not Contacted" || i.outreach_status === "Contacted").sort((a, b) => b.follower_count - a.follower_count);
    return all;
  })();

  const totalBalanceDue = view === "Commission Due"
    ? viewed.reduce((s, i) => s + Math.max(0, i.commission_owed - i.commission_paid), 0)
    : 0;

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl md:text-3xl font-heading font-bold">Influencer Tracker</h1>
        <Button size="sm" onClick={() => { setForm(BLANK); setAddOpen(true); }}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Influencer
        </Button>
      </div>

      {/* View tabs */}
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="h-9 whitespace-nowrap">
            {VIEWS.map((v) => <TabsTrigger key={v} value={v} className="text-xs px-3">{v}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>

      {/* Filters — All Influencers only */}
      {view === "All Influencers" && (
        <div className="flex flex-wrap gap-2">
          <Select value={filterPlatform} onValueChange={setFilterPlatform}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Platform" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterTier} onValueChange={setFilterTier}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Tier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tiers</SelectItem>
              {TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {OUTREACH_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Commission Due header */}
      {view === "Commission Due" && (
        <div className="rounded-xl border bg-amber-50 border-amber-200 p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-amber-700 font-medium uppercase tracking-widest mb-0.5">Total Balance Due</div>
            <div className="text-3xl font-bold text-amber-900">{fmt$(totalBalanceDue)}</div>
          </div>
          <DollarSign className="w-8 h-8 text-amber-400" />
        </div>
      )}

      {/* Table — Desktop */}
      {isLoading ? (
        <div className="rounded-xl border divide-y divide-border">
          {[1,2,3].map((i) => <div key={i} className="h-14 bg-muted/20 animate-pulse" />)}
        </div>
      ) : viewed.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground text-sm">No influencers found</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Name</th>
                  {view !== "Commission Due" && <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Platform / Tier</th>}
                  {(view === "All Influencers" || view === "Outreach Queue") && <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Followers</th>}
                  {view === "All Influencers" && <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Status</th>}
                  {(view === "Active Partners" || view === "Top Performers" || view === "Commission Due") && <th className="text-right px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Affiliate Code</th>}
                  {(view === "Active Partners" || view === "Top Performers" || view === "Commission Due") && <th className="text-right px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Conv.</th>}
                  {view === "Active Partners" && <th className="text-right px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Clicks</th>}
                  {(view === "Active Partners" || view === "Top Performers" || view === "Commission Due") && <th className="text-right px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Comm. Owed</th>}
                  {view === "Commission Due" && <th className="text-right px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Comm. Paid</th>}
                  {view === "Commission Due" && <th className="text-right px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider font-bold">Balance Due</th>}
                  {view === "Active Partners" && <th className="text-right px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Comm. Paid</th>}
                  {view === "Active Partners" && <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Last Content</th>}
                  {view === "Outreach Queue" && <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Last Outreach</th>}
                  {view === "Outreach Queue" && <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Status</th>}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {viewed.map((inf) => (
                  <tr key={inf.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{inf.first_name} {inf.last_name}</div>
                      {inf.instagram_handle && <div className="text-xs text-muted-foreground">@{inf.instagram_handle}</div>}
                    </td>
                    {view !== "Commission Due" && (
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">{inf.platform}</span>
                          {tierBadge(inf.tier)}
                        </div>
                      </td>
                    )}
                    {(view === "All Influencers" || view === "Outreach Queue") && (
                      <td className="px-4 py-3 text-sm text-muted-foreground">{fmtNum(inf.follower_count)}</td>
                    )}
                    {view === "All Influencers" && <td className="px-4 py-3">{statusBadge(inf.outreach_status)}</td>}
                    {(view === "Active Partners" || view === "Top Performers" || view === "Commission Due") && (
                      <td className="px-4 py-3 text-right">
                        {inf.affiliate_code ? <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{inf.affiliate_code}</code> : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                    )}
                    {(view === "Active Partners" || view === "Top Performers" || view === "Commission Due") && (
                      <td className="px-4 py-3 text-right font-semibold">{inf.conversions}</td>
                    )}
                    {view === "Active Partners" && <td className="px-4 py-3 text-right text-muted-foreground">{inf.clicks}</td>}
                    {(view === "Active Partners" || view === "Top Performers" || view === "Commission Due") && (
                      <td className="px-4 py-3 text-right">{fmt$(Number(inf.commission_owed))}</td>
                    )}
                    {view === "Commission Due" && <td className="px-4 py-3 text-right text-muted-foreground">{fmt$(Number(inf.commission_paid))}</td>}
                    {view === "Commission Due" && (
                      <td className="px-4 py-3 text-right font-bold text-amber-700">{fmt$(Math.max(0, Number(inf.commission_owed) - Number(inf.commission_paid)))}</td>
                    )}
                    {view === "Active Partners" && <td className="px-4 py-3 text-right text-muted-foreground">{fmt$(Number(inf.commission_paid))}</td>}
                    {view === "Active Partners" && (
                      <td className="px-4 py-3">
                        {inf.last_content_posted_url
                          ? <a href={inf.last_content_posted_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" />View</a>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                    )}
                    {view === "Outreach Queue" && (
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {inf.last_outreach_date ? format(parseISO(inf.last_outreach_date), "MMM d, yyyy") : "Never"}
                      </td>
                    )}
                    {view === "Outreach Queue" && <td className="px-4 py-3">{statusBadge(inf.outreach_status)}</td>}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {view === "Outreach Queue" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => { setLogTarget(inf); setLogStatus(inf.outreach_status); setLogNote(""); setLogOpen(true); }}>
                            Log Outreach
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openDetail(inf.id)}>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {viewed.map((inf) => (
              <div key={inf.id} className="rounded-xl border bg-card p-4 cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => openDetail(inf.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{inf.first_name} {inf.last_name}</div>
                    {inf.instagram_handle && <div className="text-xs text-muted-foreground">@{inf.instagram_handle}</div>}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {tierBadge(inf.tier)}
                      {statusBadge(inf.outreach_status)}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </div>
                <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                  <span><span className="font-semibold text-foreground">{inf.conversions}</span> conv.</span>
                  <span><span className="font-semibold text-foreground">{fmtNum(inf.follower_count)}</span> followers</span>
                  {Number(inf.commission_owed) > 0 && (
                    <span className="text-amber-700 font-semibold">{fmt$(Number(inf.commission_owed) - Number(inf.commission_paid))} due</span>
                  )}
                </div>
                {view === "Outreach Queue" && (
                  <Button size="sm" variant="outline" className="mt-3 h-8 text-xs w-full" onClick={(e) => { e.stopPropagation(); setLogTarget(inf); setLogStatus(inf.outreach_status); setLogNote(""); setLogOpen(true); }}>
                    Log Outreach
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Add Influencer Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Influencer</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>First Name</Label><Input value={form.first_name || ""} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Last Name</Label><Input value={form.last_name || ""} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tier</Label>
                <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Instagram Handle</Label><Input placeholder="@handle" value={form.instagram_handle || ""} onChange={(e) => setForm({ ...form, instagram_handle: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>TikTok Handle</Label><Input placeholder="@handle" value={form.tiktok_handle || ""} onChange={(e) => setForm({ ...form, tiktok_handle: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Follower Count</Label><Input type="number" value={form.follower_count ?? 0} onChange={(e) => setForm({ ...form, follower_count: Number(e.target.value) })} /></div>
              <div className="space-y-1.5">
                <Label>Outreach Status</Label>
                <Select value={form.outreach_status} onValueChange={(v) => setForm({ ...form, outreach_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{OUTREACH_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Affiliate Code</Label><Input placeholder="MAILDAY10" value={form.affiliate_code || ""} onChange={(e) => setForm({ ...form, affiliate_code: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Commission Rate (%)</Label><Input type="number" step="0.5" value={form.commission_rate ?? 10} onChange={(e) => setForm({ ...form, commission_rate: Number(e.target.value) })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Affiliate Link</Label><Input placeholder="https://..." value={form.affiliate_link || ""} onChange={(e) => setForm({ ...form, affiliate_link: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Revenue per Conversion ($)</Label><Input type="number" step="0.01" value={form.revenue_per_conversion ?? 14} onChange={(e) => setForm({ ...form, revenue_per_conversion: Number(e.target.value) })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(form)} disabled={!form.first_name || !form.last_name || createMutation.isPending}>
              {createMutation.isPending ? "Adding…" : "Add Influencer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Outreach Dialog */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Log Outreach — {logTarget?.first_name} {logTarget?.last_name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Update Status</Label>
              <Select value={logStatus} onValueChange={setLogStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{OUTREACH_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea placeholder="Add a note about this outreach…" value={logNote} onChange={(e) => setLogNote(e.target.value)} className="min-h-[80px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogOpen(false)}>Cancel</Button>
            <Button onClick={() => logTarget && logOutreachMutation.mutate({ id: logTarget.id, outreach_status: logStatus, note: logNote })} disabled={logOutreachMutation.isPending}>
              {logOutreachMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="right" className="w-full sm:w-[520px] overflow-y-auto p-0">
          {selected && (
            <div className="flex flex-col h-full">
              <SheetHeader className="p-6 border-b">
                <SheetTitle className="text-xl font-heading">{selected.first_name} {selected.last_name}</SheetTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  {tierBadge(selected.tier)}
                  {statusBadge(selected.outreach_status)}
                  <span className="text-xs text-muted-foreground">{selected.platform}</span>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto">
                {/* Performance Summary */}
                <div className="p-6 border-b">
                  <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Performance</div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Clicks", value: selected.clicks },
                      { label: "Conversions", value: selected.conversions },
                      { label: "Conv. Rate", value: selected.clicks > 0 ? `${Math.round((selected.conversions / selected.clicks) * 100)}%` : "—" },
                      { label: "Commission Owed", value: fmt$(Number(selected.commission_owed)) },
                      { label: "Commission Paid", value: fmt$(Number(selected.commission_paid)) },
                      { label: "Balance Owed", value: fmt$(Math.max(0, Number(selected.commission_owed) - Number(selected.commission_paid))) },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-muted/30 rounded-lg p-3">
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="text-lg font-bold">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Editable Fields */}
                <div className="p-6 border-b space-y-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Details</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>First Name</Label><Input defaultValue={selected.first_name} key={`fn-${selected.id}`} onBlur={(e) => { if (e.target.value !== selected.first_name) updateMutation.mutate({ id: selected.id, first_name: e.target.value }); }} /></div>
                    <div className="space-y-1.5"><Label>Last Name</Label><Input defaultValue={selected.last_name} key={`ln-${selected.id}`} onBlur={(e) => { if (e.target.value !== selected.last_name) updateMutation.mutate({ id: selected.id, last_name: e.target.value }); }} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Platform</Label>
                      <Select defaultValue={selected.platform} onValueChange={(v) => updateMutation.mutate({ id: selected.id, platform: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Tier</Label>
                      <Select defaultValue={selected.tier} onValueChange={(v) => updateMutation.mutate({ id: selected.id, tier: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>Instagram</Label><Input defaultValue={selected.instagram_handle || ""} key={`ig-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, instagram_handle: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label>TikTok</Label><Input defaultValue={selected.tiktok_handle || ""} key={`tt-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, tiktok_handle: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>Followers</Label><Input type="number" defaultValue={selected.follower_count} key={`fc-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, follower_count: Number(e.target.value) })} /></div>
                    <div className="space-y-1.5"><Label>Clicks</Label><Input type="number" defaultValue={selected.clicks} key={`cl-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, clicks: Number(e.target.value) })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>Conversions</Label><Input type="number" defaultValue={selected.conversions} key={`cv-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, conversions: Number(e.target.value) })} /></div>
                    <div className="space-y-1.5"><Label>Comm. Rate (%)</Label><Input type="number" step="0.5" defaultValue={selected.commission_rate} key={`cr-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, commission_rate: Number(e.target.value) })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>Rev / Conv ($)</Label><Input type="number" step="0.01" defaultValue={selected.revenue_per_conversion} key={`rv-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, revenue_per_conversion: Number(e.target.value) })} /></div>
                    <div className="space-y-1.5"><Label>Comm. Paid ($)</Label><Input type="number" step="0.01" defaultValue={selected.commission_paid} key={`cp-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, commission_paid: Number(e.target.value) })} /></div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Outreach Status</Label>
                    <Select defaultValue={selected.outreach_status} onValueChange={(v) => updateMutation.mutate({ id: selected.id, outreach_status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{OUTREACH_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Affiliate Code</Label><Input defaultValue={selected.affiliate_code || ""} key={`ac-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, affiliate_code: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Affiliate Link</Label><Input defaultValue={selected.affiliate_link || ""} key={`al-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, affiliate_link: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Last Outreach Date</Label><Input type="date" defaultValue={selected.last_outreach_date || ""} key={`lo-${selected.id}`} onBlur={(e) => updateMutation.mutate({ id: selected.id, last_outreach_date: e.target.value })} /></div>
                </div>

                {/* Content Posted */}
                <div className="p-6 border-b">
                  <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Content Posted</div>
                  {selected.content.length === 0 && <p className="text-sm text-muted-foreground mb-3">No content URLs yet.</p>}
                  <div className="space-y-2 mb-3">
                    {selected.content.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-sm">
                        <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-primary hover:underline">{c.url}</a>
                        <span className="text-xs text-muted-foreground shrink-0">{format(parseISO(c.created_at), "MMM d")}</span>
                        <button onClick={() => deleteContentMutation.mutate(c.id)} className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input placeholder="https://..." value={newUrl} onChange={(e) => setNewUrl(e.target.value)} className="text-sm h-8" onKeyDown={(e) => { if (e.key === "Enter" && newUrl.trim()) { addContentMutation.mutate({ id: selected.id, url: newUrl }); } }} />
                    <Button size="sm" variant="outline" className="h-8" onClick={() => newUrl.trim() && addContentMutation.mutate({ id: selected.id, url: newUrl })}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Notes Timeline */}
                <div className="p-6">
                  <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Notes</div>
                  <div className="flex gap-2 mb-4">
                    <Textarea placeholder="Add a note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} className="text-sm min-h-[60px]" />
                    <Button size="sm" variant="outline" className="shrink-0 self-start" onClick={() => noteText.trim() && addNoteMutation.mutate({ id: selected.id, content: noteText })}>
                      <MessageSquare className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {selected.notes.map((note) => (
                      <div key={note.id} className={`rounded-lg px-3 py-2 text-sm ${note.note_type === "system" ? "bg-muted/40 text-muted-foreground" : "bg-card border"}`}>
                        <div className="flex items-start gap-2">
                          {note.note_type === "system"
                            ? <Star className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
                            : <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />}
                          <div className="flex-1">
                            <p>{note.content}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{format(parseISO(note.created_at), "MMM d, yyyy 'at' h:mm a")}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
