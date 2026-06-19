import { useGetIncompleteOnboarding } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Mail } from "lucide-react";

export default function Incomplete() {
  const { data: parents, isLoading } = useGetIncompleteOnboarding();

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold text-foreground">Incomplete Onboarding</h1>
        <p className="text-muted-foreground mt-2">
          Parents who have signed up but haven't added any child profiles yet.
        </p>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parent Name</TableHead>
              <TableHead>Email (click to email)</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Join Date</TableHead>
              <TableHead className="text-right">Days Waiting</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ) : parents?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center">
                    <div className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center mb-3">
                      <div className="w-6 h-6 text-green-500">✓</div>
                    </div>
                    <p>All clear! Every parent has at least one child profile.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              parents?.map((parent) => {
                const days = parent.days_since_join || 0;
                const isWarning = days > 7;
                
                return (
                  <TableRow key={parent.id}>
                    <TableCell className="font-medium">
                      {parent.first_name} {parent.last_name}
                    </TableCell>
                    <TableCell>
                      <a
                        href={`mailto:${parent.email}?subject=Complete%20your%20MailDay%20profile`}
                        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {parent.email}
                      </a>
                    </TableCell>
                    <TableCell>{parent.state || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{parent.membership_tier || "Unknown"}</Badge>
                    </TableCell>
                    <TableCell>
                      {parent.join_date ? format(new Date(parent.join_date), "MMM d, yyyy") : "Unknown"}
                    </TableCell>
                    <TableCell className="text-right">
                      {isWarning ? (
                        <div className="flex items-center justify-end text-destructive font-medium">
                          <AlertCircle className="w-4 h-4 mr-1" />
                          {days} days
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{days} days</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
