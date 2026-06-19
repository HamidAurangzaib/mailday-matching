import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign, Users, Clock, CheckCircle2, AlertTriangle,
  Send, Settings, TrendingUp, Gift, ArrowDownToLine, ListMinus,
} from "lucide-react";
import { Link } from "wouter";

interface FundStats {
  fund_balance: number;
  total_donations: number;
  total_dispersed: number;
  is_dispersed_estimated: boolean;
  active_count: number;
  pending_count: number;
  waitlisted_count: number;
  receipts_pending: number;
  tremendous_pending: number;
  can_activate_from_waitlist: boolean;
  reimbursement_amount: number;
}

interface GakSettings {
  po_box_reimbursement_amount: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export default function GiveAKeyDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newAmount, setNewAmount] = useState("");

  const { data: stats, isLoading } = useQuery<FundStats>({
    queryKey: ["gak-fund"],
    queryFn: () => customFetch("/api/give-a-key/fund"),
    refetchInterval: 30000,
  });

  const { data: settings } = useQuery<GakSettings>({
    queryKey: ["gak-settings"],
    queryFn: () => customFetch("/api/give-a-key/settings"),
  });

  const saveSettings = useMutation({
    mutationFn: (amount: number) =>
      customFetch("/api/give-a-key/settings", {
        method: "PATCH",
        body: JSON.stringify({ po_box_reimbursement_amount: amount }),
      }),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      void queryClient.invalidateQueries({ queryKey: ["gak-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-fund"] });
      setSettingsOpen(false);
    },
    onError: (err) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-48 text-muted-foreground">
        Loading fund stats…
      </div>
    );
  }

  const s = stats!;
  const totalDispersed = s.total_dispersed ?? s.active_count * s.reimbursement_amount;
  const isEstimated = s.is_dispersed_estimated ?? true;
  const fundsNeeded = s.waitlisted_count * s.reimbursement_amount;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Gift className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Give a Key Dashboard</h1>
            <p className="text-sm text-muted-foreground">Sponsored PO Box program</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setNewAmount(String(settings?.po_box_reimbursement_amount ?? 75)); setSettingsOpen(true); }}>
          <Settings className="w-4 h-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* Banners */}
      {s.tremendous_pending > 0 && (
        <Alert className="border-amber-300 bg-amber-50">
          <Send className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-800 font-medium">
            {s.tremendous_pending} approved {s.tremendous_pending === 1 ? "application" : "applications"} need{s.tremendous_pending === 1 ? "s" : ""} Tremendous funds sent. Go to Applications to mark them as sent after disbursing.
          </AlertDescription>
        </Alert>
      )}

      {s.can_activate_from_waitlist && (
        <Alert className="border-green-300 bg-green-50">
          <TrendingUp className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-800 font-medium">
            Fund updated — {s.waitlisted_count} waitlisted {s.waitlisted_count === 1 ? "family" : "families"} may now be eligible for activation. Review the Waitlist to approve in order.
          </AlertDescription>
        </Alert>
      )}

      {/* Fund hero — 3-column breakdown */}
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardContent className="pt-6 pb-6">
          <div className="grid grid-cols-3 divide-x divide-primary/20 gap-0">
            <div className="pr-6">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> Total Raised
              </p>
              <p className="text-4xl font-black tracking-tight">{fmt(s.total_donations)}</p>
              <p className="text-xs text-muted-foreground mt-1.5">all donations received</p>
            </div>
            <div className="px-6">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <ArrowDownToLine className="w-3.5 h-3.5" /> Total Dispersed
                {isEstimated && (
                  <span className="text-[10px] font-normal normal-case tracking-normal bg-amber-100 text-amber-700 border border-amber-200 rounded px-1 py-px">est.</span>
                )}
              </p>
              <p className="text-4xl font-black tracking-tight">{fmt(totalDispersed)}</p>
              <p className="text-xs text-muted-foreground mt-1.5">
                {isEstimated
                  ? `${s.active_count} active × ${fmt(s.reimbursement_amount)} avg`
                  : `actual amounts recorded`}
              </p>
            </div>
            <div className="pl-6">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5" /> Current Balance
              </p>
              <p className={`text-4xl font-black tracking-tight ${s.fund_balance < 0 ? "text-destructive" : s.fund_balance < s.reimbursement_amount ? "text-amber-600" : "text-primary"}`}>
                {fmt(s.fund_balance)}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">available to spend</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" /> Active Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{s.active_count}</p>
            <p className="text-xs text-muted-foreground mt-1">sponsored via Give a Key</p>
          </CardContent>
        </Card>

        <Link href="/give-a-key/applications" className="block">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="w-4 h-4" /> Pending Review
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{s.pending_count}</p>
              <p className="text-xs text-muted-foreground mt-1">applications awaiting action</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/give-a-key/waitlist" className="block">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Waitlisted
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <p className="text-3xl font-bold">{s.waitlisted_count}</p>
                {s.can_activate_from_waitlist && (
                  <Badge className="bg-green-100 text-green-800 border-green-200">fund ready</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">approved, awaiting funds</p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ListMinus className="w-4 h-4" /> Funds Needed (Waitlist)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${fundsNeeded > s.fund_balance ? "text-amber-600" : "text-foreground"}`}>
              {fmt(fundsNeeded)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {s.waitlisted_count > 0
                ? `${s.waitlisted_count} waitlisted × ${fmt(s.reimbursement_amount)}`
                : "no one on waitlist"}
            </p>
          </CardContent>
        </Card>

        <Link href="/give-a-key/receipts" className="block">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Receipts Pending
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{s.receipts_pending}</p>
              <p className="text-xs text-muted-foreground mt-1">submitted, not yet verified</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/give-a-key/applications" className="block">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Send className="w-4 h-4" /> Tremendous Pending
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <p className="text-3xl font-bold">{s.tremendous_pending}</p>
                {s.tremendous_pending > 0 && <Badge variant="destructive">action needed</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">funds not yet sent</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Public application link */}
      <Card className="border-dashed">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Send className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Public Application Link</p>
              <p className="text-sm font-mono text-foreground/80 truncate">
                {window.location.origin}/give-a-key/apply
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Share this URL with families to let them apply for the sponsored PO Box program.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/give-a-key/apply`)}
              className="shrink-0"
            >
              Copy link
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Give a Key Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="reimb-amount">Average PO Box reimbursement amount ($)</Label>
              <p className="text-sm text-muted-foreground">Used to calculate the fund balance and determine when waitlisted families can be activated.</p>
              <Input
                id="reimb-amount"
                type="number"
                min={1}
                step={1}
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="75"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveSettings.mutate(Number(newAmount))}
              disabled={!newAmount || Number(newAmount) <= 0 || saveSettings.isPending}
            >
              {saveSettings.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
