import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Handshake, Check, Clock } from "lucide-react";

interface ConsentSide {
  child_first_name: string | null;
  parent_name: string | null;
  email: string | null;
  consented: boolean;
  consented_at: string | null;
}

interface ConsentStatusRow {
  match_id: string;
  created_at: string;
  days_elapsed: number;
  side_a: ConsentSide;
  side_b: ConsentSide;
  reminder_1_sent_at: string | null;
  reminder_2_sent_at: string | null;
  both_consented: boolean;
  next_step: string;
}

function SideCell({ side }: { side: ConsentSide }) {
  return (
    <div className="space-y-1">
      <div className="font-medium">{side.child_first_name || "—"}</div>
      <div className="text-xs text-muted-foreground">{side.parent_name || side.email || "—"}</div>
      {side.consented ? (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200 gap-1">
          <Check className="w-3 h-3" />
          Consented{side.consented_at ? ` · ${format(new Date(side.consented_at), "MMM d")}` : ""}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-amber-700 border-amber-300 gap-1">
          <Clock className="w-3 h-3" />
          Waiting
        </Badge>
      )}
    </div>
  );
}

export default function ConsentStatus() {
  const { data, isLoading } = useQuery<ConsentStatusRow[]>({
    queryKey: ["consent-status"],
    queryFn: () => customFetch<ConsentStatusRow[]>("/api/admin/consent-status"),
    refetchInterval: 60000,
  });

  const rows = data ?? [];

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-heading font-bold">Address Consent Status</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every match waiting on address consent. Both families must say yes before any address is
          shared or a letter travels. The system nudges the family we're waiting on at 48 hours and
          again on day 7, and winds the match down safely on day 14 if consent still hasn't come —
          so this list is where things stand right now, not something you have to chase by hand.
        </p>
      </div>

      <div className="rounded-xl border bg-[#FFF5E6] border-[#F0D9A8] px-4 py-3 flex items-center gap-2 text-sm text-[#8a6d3b]">
        <Handshake className="w-4 h-4 shrink-0" />
        Nothing here has had an address released yet — a match only goes live once <strong>both</strong> sides consent.
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>First family</TableHead>
              <TableHead>Second family</TableHead>
              <TableHead>Reminders sent</TableHead>
              <TableHead>Matched</TableHead>
              <TableHead>Next step</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}><Skeleton className="h-12 w-full" /></TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No matches are waiting on consent right now.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.match_id}>
                  <TableCell className="align-top"><SideCell side={r.side_a} /></TableCell>
                  <TableCell className="align-top"><SideCell side={r.side_b} /></TableCell>
                  <TableCell className="align-top text-sm whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={r.reminder_1_sent_at ? "secondary" : "outline"} className="text-[10px]">
                        48h {r.reminder_1_sent_at ? "✓" : "—"}
                      </Badge>
                      <Badge variant={r.reminder_2_sent_at ? "secondary" : "outline"} className="text-[10px]">
                        Day 7 {r.reminder_2_sent_at ? "✓" : "—"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-sm whitespace-nowrap">
                    <div>{r.created_at ? format(new Date(r.created_at), "MMM d") : "—"}</div>
                    <div className="text-xs text-muted-foreground">day {r.days_elapsed} of 14</div>
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    <span className={r.both_consented ? "text-green-700 font-medium" : "text-[#DD4B39] font-medium"}>
                      {r.next_step}
                    </span>
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
