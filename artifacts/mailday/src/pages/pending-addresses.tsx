import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, ArrowRight } from "lucide-react";

interface PendingAddressChange {
  parent_name: string | null;
  email: string | null;
  target: string;
  current_address: string | null;
  new_address: string | null;
  requested_at: string;
  expires_at: string;
}

export default function PendingAddresses() {
  const { data, isLoading } = useQuery<PendingAddressChange[]>({
    queryKey: ["pending-address-changes"],
    queryFn: () => customFetch<PendingAddressChange[]>("/api/admin/pending-address-changes"),
    refetchInterval: 60000,
  });

  const rows = data ?? [];

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-heading font-bold">Pending Address Changes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Address changes that have been requested but <strong>not yet applied</strong>. Each one
          stays pending until the parent clicks the confirmation link we email to the address on
          file — so nothing here has taken effect. Links expire 24 hours after they're requested.
        </p>
      </div>

      <div className="rounded-xl border bg-green-50/50 border-green-200 px-4 py-3 flex items-center gap-2 text-sm text-green-800">
        <ShieldCheck className="w-4 h-4 shrink-0" />
        A change only takes effect after the parent confirms by email — so an unwanted redirect
        can't be applied without access to the family's inbox.
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parent</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Current address</TableHead>
              <TableHead>Proposed new address</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Expires</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No pending address changes — everything on file is confirmed.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">
                    {r.parent_name || "—"}
                    {r.target === "gak_application" && (
                      <Badge variant="outline" className="ml-2 text-[10px]">Give a Key</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.email || "—"}</TableCell>
                  <TableCell className="text-sm max-w-[200px]">
                    <span className="text-muted-foreground">{r.current_address || "—"}</span>
                  </TableCell>
                  <TableCell className="text-sm max-w-[220px]">
                    <span className="inline-flex items-start gap-1.5">
                      <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-[#DD4B39] shrink-0" />
                      <span className="font-medium">{r.new_address || "—"}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {r.requested_at ? format(new Date(r.requested_at), "MMM d, h:mm a") : "—"}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                    {r.expires_at ? format(new Date(r.expires_at), "MMM d, h:mm a") : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
