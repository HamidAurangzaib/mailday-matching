import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { Plus, Trash2, Pencil, TrendingUp, DollarSign, Search } from "lucide-react";

interface Donation {
  id: string;
  donor_first_name: string;
  donor_last_name: string;
  donor_email: string;
  donation_amount: number;
  donation_date: string;
  notes?: string;
  source?: string;
  created_at: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

export default function GiveAKeyDonations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editingDonation, setEditingDonation] = useState<Donation | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"donation_date" | "donation_amount">("donation_date");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // Form state (shared between create and edit)
  const [dFirstName, setDFirstName] = useState("");
  const [dLastName, setDLastName] = useState("");
  const [dEmail, setDEmail] = useState("");
  const [dAmount, setDAmount] = useState("");
  const [dDate, setDDate] = useState(new Date().toISOString().split("T")[0]);
  const [dNotes, setDNotes] = useState("");

  const { data: donations = [], isLoading } = useQuery<Donation[]>({
    queryKey: ["gak-donations"],
    queryFn: () => customFetch("/api/give-a-key/donations"),
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      customFetch("/api/give-a-key/donations", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gak-donations"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-fund"] });
      toast({ title: "Donation recorded" });
      resetForm();
      setOpen(false);
    },
    onError: (err) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      customFetch(`/api/give-a-key/donations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gak-donations"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-fund"] });
      toast({ title: "Donation updated" });
      resetForm();
      setEditingDonation(null);
    },
    onError: (err) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/give-a-key/donations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gak-donations"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-fund"] });
      toast({ title: "Donation removed" });
    },
    onError: (err) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  function resetForm() {
    setDFirstName(""); setDLastName(""); setDEmail(""); setDAmount("");
    setDDate(new Date().toISOString().split("T")[0]); setDNotes("");
  }

  function openEdit(d: Donation) {
    setDFirstName(d.donor_first_name);
    setDLastName(d.donor_last_name);
    setDEmail(d.donor_email);
    setDAmount(String(d.donation_amount));
    setDDate(d.donation_date);
    setDNotes(d.notes ?? "");
    setEditingDonation(d);
  }

  const totalDonations = useMemo(
    () => donations.reduce((sum, d) => sum + Number(d.donation_amount), 0),
    [donations]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const result = donations.filter((d) => {
      if (!q) return true;
      return [d.donor_first_name, d.donor_last_name, d.donor_email].some((f) => f?.toLowerCase().includes(q));
    });
    return [...result].sort((a, b) => {
      const av = sortField === "donation_amount" ? Number(a.donation_amount) : new Date(a.donation_date).getTime();
      const bv = sortField === "donation_amount" ? Number(b.donation_amount) : new Date(b.donation_date).getTime();
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [donations, search, sortField, sortDir]);

  const emailValid = dEmail.trim().includes("@") && dEmail.trim().includes(".");
  const canSubmit = dFirstName.trim() && dLastName.trim() && emailValid && Number(dAmount) > 0 && dDate && !createMutation.isPending;

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  // Running total (cumulative from oldest to newest by date)
  const runningTotals = useMemo(() => {
    const sorted = [...donations].sort((a, b) => new Date(a.donation_date).getTime() - new Date(b.donation_date).getTime());
    let running = 0;
    const map = new Map<string, number>();
    sorted.forEach((d) => { running += Number(d.donation_amount); map.set(d.id, running); });
    return map;
  }, [donations]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Donations Log</h1>
          <p className="text-sm text-muted-foreground">Auto-logged from Shopify orders · manually record cash or offline donations</p>
        </div>
        <Button onClick={() => { resetForm(); setOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          Record Donation
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-5 rounded-xl border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <TrendingUp className="w-4 h-4" /> Total Raised
          </div>
          <p className="text-3xl font-bold">{fmt(totalDonations)}</p>
          <p className="text-xs text-muted-foreground mt-1">{donations.length} {donations.length === 1 ? "donation" : "donations"} recorded</p>
        </div>
        <div className="p-5 rounded-xl border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <DollarSign className="w-4 h-4" /> Avg Donation
          </div>
          <p className="text-3xl font-bold">
            {donations.length > 0 ? fmt(totalDonations / donations.length) : "$0"}
          </p>
        </div>
      </div>

      {/* Search + sort */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by donor name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => toggleSort("donation_date")} className="text-xs">
          Date {sortField === "donation_date" ? (sortDir === "desc" ? "↓" : "↑") : ""}
        </Button>
        <Button variant="outline" size="sm" onClick={() => toggleSort("donation_amount")} className="text-xs">
          Amount {sortField === "donation_amount" ? (sortDir === "desc" ? "↓" : "↑") : ""}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-center py-8">Loading donations…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          {search ? "No donations match your search." : "No donations recorded yet."}
        </p>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Donor</th>
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-right px-4 py-3 font-medium">Running Total</th>
                <th className="text-left px-4 py-3 font-medium">Source</th>
                <th className="text-left px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <tr key={d.id} className={`border-t ${i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {format(parseISO(d.donation_date), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3 font-medium">{d.donor_first_name} {d.donor_last_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{d.donor_email}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-700">{fmt(Number(d.donation_amount))}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{fmt(runningTotals.get(d.id) ?? 0)}</td>
                  <td className="px-4 py-3">
                    {d.source === "shopify" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">Auto (Shopify)</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">Manual</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{d.notes || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {d.source !== "shopify" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(d)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { if (confirm("Remove this donation?")) deleteMutation.mutate(d.id); }}
                        disabled={deleteMutation.isPending}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit donation dialog */}
      <Dialog open={!!editingDonation} onOpenChange={(v) => { if (!v) { resetForm(); setEditingDonation(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Donation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>First name <span className="text-destructive">*</span></Label>
                <Input value={dFirstName} onChange={(e) => setDFirstName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Last name <span className="text-destructive">*</span></Label>
                <Input value={dLastName} onChange={(e) => setDLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={dEmail} onChange={(e) => setDEmail(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount ($) <span className="text-destructive">*</span></Label>
                <Input type="number" min={1} step={0.01} value={dAmount} onChange={(e) => setDAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Date <span className="text-destructive">*</span></Label>
                <Input type="date" value={dDate} onChange={(e) => setDDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                value={dNotes}
                onChange={(e) => setDNotes(e.target.value)}
                className="min-h-20 resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setEditingDonation(null); }}>Cancel</Button>
            <Button
              onClick={() => editingDonation && editMutation.mutate({
                id: editingDonation.id,
                body: { donor_first_name: dFirstName.trim(), donor_last_name: dLastName.trim(), donor_email: dEmail.trim().toLowerCase(), donation_amount: Number(dAmount), donation_date: dDate, notes: dNotes.trim() || undefined },
              })}
              disabled={!dFirstName.trim() || !dLastName.trim() || !dEmail.trim().includes("@") || Number(dAmount) <= 0 || !dDate || editMutation.isPending}
            >
              {editMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record donation dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); } setOpen(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Donation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>First name <span className="text-destructive">*</span></Label>
                <Input value={dFirstName} onChange={(e) => setDFirstName(e.target.value)} placeholder="Jane" />
              </div>
              <div className="space-y-1.5">
                <Label>Last name <span className="text-destructive">*</span></Label>
                <Input value={dLastName} onChange={(e) => setDLastName(e.target.value)} placeholder="Smith" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={dEmail} onChange={(e) => setDEmail(e.target.value)} placeholder="jane@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount ($) <span className="text-destructive">*</span></Label>
                <Input type="number" min={1} step={0.01} value={dAmount} onChange={(e) => setDAmount(e.target.value)} placeholder="75.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Date <span className="text-destructive">*</span></Label>
                <Input type="date" value={dDate} onChange={(e) => setDDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                value={dNotes}
                onChange={(e) => setDNotes(e.target.value)}
                placeholder="Any relevant details about this donation…"
                className="min-h-20 resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setOpen(false); }}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ donor_first_name: dFirstName.trim(), donor_last_name: dLastName.trim(), donor_email: dEmail.trim().toLowerCase(), donation_amount: Number(dAmount), donation_date: dDate, notes: dNotes.trim() || undefined })}
              disabled={!canSubmit}
            >
              {createMutation.isPending ? "Saving…" : "Record donation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
