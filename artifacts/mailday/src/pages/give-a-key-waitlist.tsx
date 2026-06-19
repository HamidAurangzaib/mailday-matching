import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { differenceInDays, parseISO, format } from "date-fns";
import { CheckCircle2, TrendingUp, Clock, Eye } from "lucide-react";

interface Application {
  id: string;
  parent_first_name: string;
  parent_last_name: string;
  parent_email: string;
  parent_phone?: string;
  state: string;
  mailing_address?: string;
  address_type?: string;
  child_first_name: string;
  child_age: number;
  child_interests: string[];
  statement_of_need: string;
  application_status: string;
  application_date: string;
  po_box_acknowledgment?: boolean;
  subscription_acknowledgment?: boolean;
}

interface FundStats {
  fund_balance?: number;
  waitlisted_count: number;
  can_activate_from_waitlist: boolean;
  reimbursement_amount: number;
}

function daysSince(dateStr: string) {
  try {
    return differenceInDays(new Date(), parseISO(dateStr));
  } catch {
    return 0;
  }
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(n);
}

export default function GiveAKeyWaitlist() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);

  const { data: applications = [], isLoading } = useQuery<Application[]>({
    queryKey: ["gak-waitlist"],
    queryFn: () => customFetch("/api/give-a-key/applications?status=Waitlisted"),
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<FundStats>({
    queryKey: ["gak-fund"],
    queryFn: () => customFetch("/api/give-a-key/fund"),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/give-a-key/applications/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ action: "approve" }),
      }),
    onSuccess: (data: { status: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["gak-waitlist"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-applications"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-fund"] });
      toast({
        title: data.status === "Approved" ? "Application approved!" : "Moved to waitlist",
        description: data.status === "Approved"
          ? "Send funds via Tremendous, then notify the family."
          : "Insufficient fund balance.",
      });
      setSelectedApp(null);
    },
    onError: (err) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const canActivate = stats?.can_activate_from_waitlist ?? false;
  const fundBalance = stats?.fund_balance;
  const reimbursementAmount = stats?.reimbursement_amount ?? 75;

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Waitlist</h1>
        <p className="text-sm text-muted-foreground">Approved applicants waiting for fund availability — approve oldest first.</p>
      </div>

      {/* Fund status */}
      {fundBalance !== undefined && (
        <div className={`flex items-center justify-between p-4 rounded-xl border ${canActivate ? "bg-green-50 border-green-200" : "bg-muted/50"}`}>
          <div>
            <p className="text-sm font-medium">Current fund balance</p>
            <p className={`text-2xl font-bold ${canActivate ? "text-green-700" : fundBalance < 0 ? "text-destructive" : "text-foreground"}`}>
              {fmt(fundBalance)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{fmt(reimbursementAmount)} per PO Box reimbursement</p>
          </div>
          {canActivate ? (
            <div className="flex items-center gap-2 text-green-700 font-semibold text-sm">
              <TrendingUp className="w-5 h-5" />
              Fund ready — approve next family
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Clock className="w-5 h-5" />
              Awaiting donations
            </div>
          )}
        </div>
      )}

      {canActivate && (
        <Alert className="border-green-300 bg-green-50">
          <TrendingUp className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-800">
            The fund can cover the next reimbursement. Approve the oldest waitlisted family below.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Loading waitlist…</p>
      ) : applications.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No families on the waitlist</p>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((app, i) => {
            const days = daysSince(app.application_date);
            const isFirst = i === 0;
            return (
              <div
                key={app.id}
                className={`p-4 rounded-xl border ${isFirst && canActivate ? "border-green-300 bg-green-50/50" : "bg-background"}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      {isFirst && <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">Next in line</Badge>}
                      <span className="font-semibold">{app.child_first_name}</span>
                      <span className="text-muted-foreground text-sm">age {app.child_age} · {app.state}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {app.parent_first_name} {app.parent_last_name} · {app.parent_email}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(app.child_interests || []).map((interest) => (
                        <Badge key={interest} variant="secondary" className="text-xs">{interest}</Badge>
                      ))}
                    </div>
                    <p className="text-sm text-foreground/80 line-clamp-2 bg-muted/50 rounded p-2">{app.statement_of_need}</p>
                    <p className="text-xs text-muted-foreground">
                      Applied {format(parseISO(app.application_date), "MMM d, yyyy")} · {days} {days === 1 ? "day" : "days"} ago
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedApp(app)}
                    >
                      <Eye className="w-4 h-4 mr-1.5" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      className={canActivate && isFirst ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                      variant={canActivate && isFirst ? "default" : "outline"}
                      onClick={() => approveMutation.mutate(app.id)}
                      disabled={approveMutation.isPending}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1.5" />
                      Approve
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Application detail sheet */}
      <Sheet open={!!selectedApp} onOpenChange={(open) => { if (!open) setSelectedApp(null); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedApp && (
            <>
              <SheetHeader className="mb-5">
                <SheetTitle className="flex items-center gap-2">
                  {selectedApp.child_first_name}'s Application
                  <Badge className="bg-orange-100 text-orange-800 border-orange-200 border text-xs font-semibold">Waitlisted</Badge>
                </SheetTitle>
                <p className="text-sm text-muted-foreground">
                  Applied {format(parseISO(selectedApp.application_date), "MMM d, yyyy")} · {daysSince(selectedApp.application_date)} days ago · {selectedApp.state}
                </p>
              </SheetHeader>

              <div className="space-y-5">
                {/* Parent */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Parent / Guardian</p>
                  <p className="font-medium">{selectedApp.parent_first_name} {selectedApp.parent_last_name}</p>
                  <p className="text-sm text-muted-foreground">{selectedApp.parent_email}</p>
                  {selectedApp.parent_phone && <p className="text-sm text-muted-foreground">{selectedApp.parent_phone}</p>}
                  {selectedApp.mailing_address && (
                    <p className="text-sm text-muted-foreground">
                      {selectedApp.address_type && <span className="capitalize">{selectedApp.address_type} — </span>}
                      {selectedApp.mailing_address}
                    </p>
                  )}
                </div>

                {/* Child */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Child</p>
                  <p className="font-medium">{selectedApp.child_first_name}, age {selectedApp.child_age}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedApp.child_interests || []).map((interest) => (
                      <Badge key={interest} variant="secondary" className="text-xs">{interest}</Badge>
                    ))}
                  </div>
                </div>

                {/* Statement of need */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Statement of Need</p>
                  <p className="text-sm leading-relaxed bg-muted/50 rounded-lg p-3">{selectedApp.statement_of_need}</p>
                </div>

                {/* Acknowledgments */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Acknowledgments</p>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className={`w-4 h-4 ${selectedApp.po_box_acknowledgment ? "text-green-600" : "text-muted-foreground"}`} />
                      PO Box responsibility acknowledged
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className={`w-4 h-4 ${selectedApp.subscription_acknowledgment ? "text-green-600" : "text-muted-foreground"}`} />
                      Subscription terms acknowledged
                    </div>
                  </div>
                </div>

                {/* Approve action */}
                <div className="pt-2">
                  <Button
                    className={`w-full ${canActivate ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                    variant={canActivate ? "default" : "outline"}
                    onClick={() => approveMutation.mutate(selectedApp.id)}
                    disabled={approveMutation.isPending}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    {approveMutation.isPending ? "Approving…" : canActivate ? "Approve & send Tremendous funds" : "Approve (fund may be insufficient)"}
                  </Button>
                  {!canActivate && (
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      Current fund balance may not cover the {fmt(reimbursementAmount)} reimbursement.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
