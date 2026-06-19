import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  CheckSquare, Square, Mail, ChevronDown, ChevronRight, ListChecks, ExternalLink,
} from "lucide-react";

interface GakTask {
  id: string;
  application_id: string;
  type: string;
  title: string;
  description?: string;
  parent_name: string;
  parent_email: string;
  completed: boolean;
  completed_at?: string;
  completed_by?: string;
  created_at: string;
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  notify_approved:    { label: "Approval",    color: "bg-blue-100 text-blue-800 border-blue-200" },
  notify_waitlisted:  { label: "Waitlist",    color: "bg-orange-100 text-orange-800 border-orange-200" },
  notify_rejected:    { label: "Rejection",   color: "bg-red-100 text-red-800 border-red-200" },
  verify_receipt:     { label: "Receipt",     color: "bg-purple-100 text-purple-800 border-purple-200" },
  tremendous_followup:{ label: "Follow-up",   color: "bg-purple-100 text-purple-800 border-purple-200" },
  notify_activated:   { label: "Activation",  color: "bg-green-100 text-green-800 border-green-200" },
};

const ALL_TYPES = Object.keys({
  notify_approved: 1, notify_waitlisted: 1, notify_rejected: 1, tremendous_followup: 1, notify_activated: 1,
});

export default function GiveAKeyTasks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCompleted, setShowCompleted] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: tasks = [], isLoading } = useQuery<GakTask[]>({
    queryKey: ["gak-tasks"],
    queryFn: () => customFetch("/api/give-a-key/tasks"),
    refetchInterval: 30000,
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/give-a-key/tasks/${id}/complete`, { method: "PATCH", body: JSON.stringify({}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gak-tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["gak-task-count"] });
      toast({ title: "Marked as done" });
    },
    onError: (err) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const allOpen = tasks.filter((t) => !t.completed);
  const allDone = tasks.filter((t) => t.completed);
  const open = typeFilter === "all" ? allOpen : allOpen.filter((t) => t.type === typeFilter);
  const done = typeFilter === "all" ? allDone : allDone.filter((t) => t.type === typeFilter);

  function mailtoLink(task: GakTask) {
    return `mailto:${task.parent_email}`;
  }

  function TaskCard({ task }: { task: GakTask }) {
    const meta = TYPE_META[task.type] ?? { label: task.type, color: "bg-gray-100 text-gray-700" };
    return (
      <div className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${task.completed ? "bg-muted/30 opacity-60" : "bg-background hover:bg-muted/20"}`}>
        <button
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors"
          onClick={() => !task.completed && completeMutation.mutate(task.id)}
          disabled={task.completed || completeMutation.isPending}
          title={task.completed ? "Done" : "Mark as done"}
        >
          {task.completed
            ? <CheckSquare className="w-5 h-5 text-green-600" />
            : <Square className="w-5 h-5" />}
        </button>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={`border text-xs font-semibold ${meta.color}`}>{meta.label}</Badge>
            <Link
              href={`/give-a-key/applications?open=${task.application_id}`}
              className="font-medium text-sm text-primary hover:underline inline-flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {task.parent_name}
              <ExternalLink className="w-3 h-3" />
            </Link>
            <span className="text-xs text-muted-foreground">
              {format(parseISO(task.created_at), "MMM d, yyyy")}
            </span>
          </div>
          <p className="text-sm text-foreground">{task.title}</p>
          {task.description && (
            <p className="text-xs text-muted-foreground italic">{task.description}</p>
          )}
          {task.completed_at && (
            <p className="text-xs text-green-600">
              Completed {format(parseISO(task.completed_at), "MMM d, yyyy")}
              {task.completed_by && ` by ${task.completed_by}`}
            </p>
          )}
        </div>

        {!task.completed && (
          <a
            href={mailtoLink(task)}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs text-primary border border-primary/30 rounded-md px-2.5 py-1.5 hover:bg-primary/5 transition-colors"
            title={`Email ${task.parent_email}`}
          >
            <Mail className="w-3.5 h-3.5" />
            Email
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Action Items</h1>
          <p className="text-sm text-muted-foreground">
            Family communications to send — auto-generated when statuses change
          </p>
        </div>
        {allOpen.length > 0 && (
          <Badge className="bg-red-100 text-red-800 border-red-200 border text-sm font-semibold px-3 py-1">
            {allOpen.length} open
          </Badge>
        )}
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTypeFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${typeFilter === "all" ? "bg-foreground text-background border-foreground" : "bg-background border-border text-muted-foreground hover:border-foreground/40"}`}
        >
          All ({allOpen.length})
        </button>
        {ALL_TYPES.map((type) => {
          const meta = TYPE_META[type] ?? { label: type, color: "" };
          const count = allOpen.filter((t) => t.type === type).length;
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? "all" : type)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${typeFilter === type ? "bg-foreground text-background border-foreground" : "bg-background border-border text-muted-foreground hover:border-foreground/40"}`}
            >
              {meta.label} ({count})
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Loading…</p>
      ) : open.length === 0 && done.length === 0 ? (
        <div className="rounded-xl border bg-white p-12 text-center space-y-2">
          <ListChecks className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="font-medium text-muted-foreground">All caught up</p>
          <p className="text-sm text-muted-foreground">New tasks appear here automatically when applications change status.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {open.length === 0 ? (
            <div className="rounded-xl border bg-green-50 border-green-200 p-6 text-center space-y-1">
              <CheckSquare className="w-8 h-8 text-green-600 mx-auto" />
              <p className="font-medium text-green-800">All tasks complete!</p>
            </div>
          ) : (
            open.map((task) => <TaskCard key={task.id} task={task} />)
          )}

          {done.length > 0 && (
            <div className="pt-2">
              <button
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
                onClick={() => setShowCompleted((v) => !v)}
              >
                {showCompleted ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {done.length} completed
              </button>
              {showCompleted && (
                <div className="space-y-2">
                  {done.map((task) => <TaskCard key={task.id} task={task} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
