import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { differenceInDays, parseISO, format } from "date-fns";
import {
  CheckCircle2, ExternalLink, Receipt, Clock, Eye,
} from "lucide-react";

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
  po_box_address?: string;
  po_box_receipt_url?: string;
  receipt_verified: boolean;
  activation_date?: string;
  tremendous_sent: boolean;
}

function daysSince(dateStr: string) {
  try {
    return differenceInDays(new Date(), parseISO(dateStr));
  } catch {
    return 0;
  }
}

export default function GiveAKeyReceipts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"pending" | "verified">("pending");
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);

  const { data: applications = [], isLoading } = useQuery<Application[]>({
    queryKey: ["gak-applications"],
    queryFn: () => customFetch("/api/give-a-key/applications"),
    refetchInterval: 30000,
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

  const withReceipts = applications.filter((a) => !!a.po_box_receipt_url);
  const pending = withReceipts.filter((a) => !a.receipt_verified);
  const verified = withReceipts.filter((a) => a.receipt_verified);
  const displayed = tab === "pending" ? pending : verified;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">PO Box Receipts</h1>
          <p className="text-sm text-muted-foreground">Review submitted receipts and activate approved families</p>
        </div>
        <div className="text-sm text-muted-foreground">
          {pending.length} pending · {verified.length} verified
        </div>
      </div>

      {/* How this works */}
      <div className="rounded-xl border bg-muted/40 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Receipt className="w-3.5 h-3.5" /> How receipt verification works
        </p>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>An approved family receives Tremendous funds and uses them to open a USPS PO Box.</li>
          <li>They visit the PO Box form link and submit their new address + a photo of their USPS receipt.</li>
          <li>Their submission appears here under <strong className="text-foreground">Pending</strong>. Open it, confirm the receipt is valid and the address is correct.</li>
          <li>Click <strong className="text-foreground">Verify &amp; activate membership</strong> — this creates their parent and child records, moves the child into the matching queue, and marks the application Active.</li>
        </ol>
      </div>

      {pending.length > 0 && (
        <Alert className="border-blue-300 bg-blue-50">
          <Receipt className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-800 font-medium">
            {pending.length} {pending.length === 1 ? "receipt" : "receipts"} submitted and waiting for verification.
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as "pending" | "verified")}>
        <TabsList>
          <TabsTrigger value="pending" className="text-xs">
            Pending {pending.length > 0 && <span className="ml-1 opacity-60">({pending.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="verified" className="text-xs">
            Verified {verified.length > 0 && <span className="ml-1 opacity-60">({verified.length})</span>}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Loading receipts…</p>
      ) : displayed.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {tab === "pending" ? (
            <>
              <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No receipts pending</p>
              <p className="text-sm mt-1">Approved families submit via the PO Box form</p>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No verified receipts yet</p>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl border overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Child</th>
                <th className="text-left px-4 py-3 font-medium">Parent</th>
                <th className="text-left px-4 py-3 font-medium">PO Box Address</th>
                <th className="text-left px-4 py-3 font-medium">Submitted</th>
                <th className="text-left px-4 py-3 font-medium">Receipt</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {displayed.map((app, i) => (
                <tr
                  key={app.id}
                  onClick={() => setSelectedApp(app)}
                  className={`border-t cursor-pointer ${i % 2 === 0 ? "bg-background" : "bg-muted/20"} hover:bg-muted/40 transition-colors`}
                >
                  <td className="px-4 py-3 font-medium">{app.child_first_name}</td>
                  <td className="px-4 py-3">
                    <div>
                      <p>{app.parent_first_name} {app.parent_last_name}</p>
                      <p className="text-xs text-muted-foreground">{app.parent_email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[180px] truncate">
                    {app.po_box_address ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {daysSince(app.application_date)}d ago
                  </td>
                  <td className="px-4 py-3">
                    {app.po_box_receipt_url ? (
                      <a
                        href={app.po_box_receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {app.receipt_verified ? (
                      <Badge className="bg-green-100 text-green-800 border-green-200 border text-xs">Verified</Badge>
                    ) : (
                      <Badge className="bg-blue-100 text-blue-800 border-blue-200 border text-xs">Pending</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {!app.receipt_verified && (
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
                          onClick={(e) => { e.stopPropagation(); verifyMutation.mutate(app.id); }}
                          disabled={verifyMutation.isPending}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          Verify &amp; activate
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail sheet */}
      <Sheet open={!!selectedApp} onOpenChange={(open) => { if (!open) setSelectedApp(null); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedApp && (
            <>
              <SheetHeader className="mb-5">
                <SheetTitle className="flex items-center gap-2">
                  {selectedApp.child_first_name}'s Receipt
                  {selectedApp.receipt_verified ? (
                    <Badge className="bg-green-100 text-green-800 border-green-200 border text-xs font-semibold">Verified</Badge>
                  ) : (
                    <Badge className="bg-blue-100 text-blue-800 border-blue-200 border text-xs font-semibold">Pending</Badge>
                  )}
                </SheetTitle>
                <p className="text-sm text-muted-foreground">
                  {selectedApp.parent_first_name} {selectedApp.parent_last_name} · {selectedApp.state}
                </p>
              </SheetHeader>

              <div className="space-y-5">
                {!selectedApp.receipt_verified && (
                  <Alert className="border-blue-300 bg-blue-50">
                    <Receipt className="w-4 h-4 text-blue-600" />
                    <AlertDescription className="text-blue-800">
                      Receipt submitted — verify it to activate this family's membership.
                    </AlertDescription>
                  </Alert>
                )}

                {/* PO Box details */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">PO Box Address</p>
                  <p className="text-sm font-medium">{selectedApp.po_box_address ?? "Not provided"}</p>
                  {selectedApp.po_box_receipt_url && (
                    <a
                      href={selectedApp.po_box_receipt_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open receipt
                    </a>
                  )}
                </div>

                {/* Parent */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Parent</p>
                  <p className="font-medium">{selectedApp.parent_first_name} {selectedApp.parent_last_name}</p>
                  <p className="text-sm text-muted-foreground">{selectedApp.parent_email}</p>
                  {selectedApp.parent_phone && <p className="text-sm text-muted-foreground">{selectedApp.parent_phone}</p>}
                  {selectedApp.mailing_address && <p className="text-sm text-muted-foreground">{selectedApp.mailing_address}</p>}
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

                {/* Statement */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Statement of Need</p>
                  <p className="text-sm leading-relaxed bg-muted/50 rounded-lg p-3">{selectedApp.statement_of_need}</p>
                </div>

                {/* Timeline */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Timeline</p>
                  <div className="text-sm space-y-0.5 text-muted-foreground">
                    <p>Applied: {format(parseISO(selectedApp.application_date), "MMM d, yyyy")}</p>
                    {selectedApp.activation_date && (
                      <p>Activated: {format(parseISO(selectedApp.activation_date), "MMM d, yyyy")}</p>
                    )}
                  </div>
                </div>

                {/* Action */}
                {!selectedApp.receipt_verified && (
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => verifyMutation.mutate(selectedApp.id)}
                    disabled={verifyMutation.isPending}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    {verifyMutation.isPending ? "Verifying…" : "Verify receipt & activate membership"}
                  </Button>
                )}

                {selectedApp.receipt_verified && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    Verified — {selectedApp.child_first_name} is active in the matching queue
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
