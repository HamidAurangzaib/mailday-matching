import { useGetStatsSummary } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Users, CalendarCheck, CheckCircle2, Info } from "lucide-react";

interface StatsWithExtras {
  total_matched: number;
  total_active_matches: number;
  matches_this_week: number;
  matches_this_month: number;
}

interface ActivityEvent {
  id: string;
  type: string;
  description: string;
  child_a_name: string;
  child_b_name: string;
  status: string;
  timestamp: string;
}

export default function VAPerformance() {
  const { data: rawStats, isLoading: statsLoading } = useGetStatsSummary();
  const stats = rawStats as StatsWithExtras | undefined;

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => customFetch<User[]>("/api/users"),
  });

  const { data: recentActivity, isLoading: activityLoading } = useQuery<ActivityEvent[]>({
    queryKey: ["activity"],
    queryFn: () => customFetch<ActivityEvent[]>("/api/activity?limit=50"),
  });

  const isLoading = statsLoading || usersLoading || activityLoading;

  // Count matches by status from activity
  const closedCount = recentActivity?.filter((e) => e.type === "match_closed").length ?? 0;
  const activeCount = stats?.total_active_matches ?? 0;
  const totalAll = stats?.total_matched ?? 0;

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 space-y-6">
        <h1 className="text-3xl font-heading font-bold">Team Performance</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-heading font-bold">Team Performance</h1>
        <p className="text-muted-foreground mt-1">Matching output across the whole team</p>
      </div>

      {/* Top stats */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Overall Matching</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Total Matches Made" value={String(totalAll)} icon={CheckCircle2} description="All time" />
          <StatCard title="Active Matches" value={String(activeCount)} icon={TrendingUp} description="Currently running" />
          <StatCard title="This Week" value={String(stats?.matches_this_week ?? 0)} icon={CalendarCheck} description="Matches approved" />
          <StatCard title="This Month" value={String(stats?.matches_this_month ?? 0)} icon={CalendarCheck} description="Matches approved" />
        </div>
      </section>

      {/* Team members */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Team Members</h2>
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {(users ?? []).map((u: User) => (
                <div key={u.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="font-medium text-sm">{u.email}</div>
                    <Badge variant="outline" className="text-[10px] mt-1 capitalize">{u.role}</Badge>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Per-match attribution</div>
                    <div className="text-xs text-muted-foreground mt-0.5">available after migration</div>
                  </div>
                </div>
              ))}
              {(!users || users.length === 0) && (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">No team members found.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Migration note */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="p-4 flex gap-3 items-start">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-800">
            <strong>Enable per-VA attribution:</strong> Run the database migration in{" "}
            <code className="font-mono bg-blue-100 px-1 rounded">supabase-migration-v2.sql</code> to track which team member approved each match. Once done, this page will show individual match counts and activity per VA.
          </div>
        </CardContent>
      </Card>

      {/* Recent match log */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Recent Match Log</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{recentActivity?.length ?? 0} recent events</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y max-h-80 overflow-y-auto">
              {recentActivity?.length === 0 && (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">No matches yet.</div>
              )}
              {recentActivity?.map((event) => (
                <div key={event.id} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <div className="text-sm font-medium">{event.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(event.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  </div>
                  <Badge
                    variant={event.status === "Active" ? "default" : "outline"}
                    className={event.status === "Active" ? "bg-green-500 text-white" : "text-muted-foreground"}
                  >
                    {event.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, description }: {
  title: string; value: string; icon: React.ElementType; description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}

interface User {
  id: string;
  email: string;
  role: string;
}
