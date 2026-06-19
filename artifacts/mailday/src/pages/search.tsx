import { useState } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { ChildSheet } from "@/components/child-sheet";
import { ParentSheet } from "@/components/parent-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { User, Baby, ChevronRight, SearchX } from "lucide-react";

interface ParentResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  subscription_status: string | null;
}

interface ChildResult {
  id: string;
  child_first_name: string;
  age: number | null;
  tier: string;
  match_status: string;
  parent_id: string;
}

export default function SearchPage() {
  const searchStr = useSearch();
  const query = new URLSearchParams(searchStr).get("q")?.trim() ?? "";
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [, setLocation] = useLocation();

  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [childSheetOpen, setChildSheetOpen] = useState(false);

  const { data: parents, isLoading: parentsLoading } = useQuery<ParentResult[]>({
    queryKey: ["search-parents"],
    queryFn: () => customFetch<ParentResult[]>("/api/parents"),
    staleTime: 30000,
  });

  const { data: children, isLoading: childrenLoading } = useQuery<ChildResult[]>({
    queryKey: ["search-children"],
    queryFn: () => customFetch<ChildResult[]>("/api/children"),
    staleTime: 30000,
  });

  const q = query.toLowerCase();

  const matchedParents = q
    ? (parents ?? []).filter(
        (p) =>
          p.first_name?.toLowerCase().includes(q) ||
          p.last_name?.toLowerCase().includes(q) ||
          p.email?.toLowerCase().includes(q) ||
          `${p.first_name} ${p.last_name}`.toLowerCase().includes(q)
      )
    : [];

  const matchedChildren = q
    ? (children ?? []).filter((c) =>
        c.child_first_name?.toLowerCase().includes(q)
      )
    : [];

  const isLoading = parentsLoading || childrenLoading;
  const hasResults = matchedParents.length > 0 || matchedChildren.length > 0;

  const openParent = (id: string) => setSelectedParentId(id);
  const openChild = (id: string) => {
    setSelectedChildId(id);
    setChildSheetOpen(true);
  };
  const openParentById = (parentId: string) => {
    setChildSheetOpen(false);
    setSelectedChildId(null);
    setTimeout(() => setLocation(`/parents?id=${parentId}`), 250);
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-heading font-bold">Search Results</h1>
        {query && (
          <p className="text-sm text-muted-foreground mt-1">
            {isLoading
              ? "Searching…"
              : hasResults
              ? `${matchedParents.length + matchedChildren.length} results for "${query}"`
              : `No results for "${query}"`}
          </p>
        )}
      </div>

      {!query && (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground text-sm">
          Use the search bar in the sidebar to find members and children.
        </div>
      )}

      {query && isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      )}

      {query && !isLoading && !hasResults && (
        <div className="rounded-xl border border-dashed p-12 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <SearchX className="w-8 h-8" />
          <div>
            <div className="font-medium">No results found</div>
            <p className="text-sm mt-0.5">Try a different name or email address.</p>
          </div>
        </div>
      )}

      {matchedParents.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest px-1">
            <User className="w-3.5 h-3.5" />
            Parents / Families ({matchedParents.length})
          </div>
          <div className="rounded-xl border divide-y overflow-hidden">
            {matchedParents.map((p) => (
              <button
                key={p.id}
                onClick={() => openParent(p.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {p.first_name} {p.last_name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{p.email}</div>
                </div>
                {p.subscription_status && (
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {p.subscription_status}
                  </Badge>
                )}
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {matchedChildren.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest px-1">
            <Baby className="w-3.5 h-3.5" />
            Children ({matchedChildren.length})
          </div>
          <div className="rounded-xl border divide-y overflow-hidden">
            {matchedChildren.map((c) => (
              <button
                key={c.id}
                onClick={() => openChild(c.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                  <Baby className="w-4 h-4 text-violet-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{c.child_first_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.age != null ? `Age ${c.age}` : "Age unknown"} · {c.tier}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${
                    c.match_status === "Matched"
                      ? "border-green-300 text-green-700"
                      : c.match_status === "Rematch Requested"
                      ? "border-amber-300 text-amber-700"
                      : "border-muted-foreground/30"
                  }`}
                >
                  {c.match_status}
                </Badge>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      <ParentSheet
        parentId={selectedParentId}
        open={!!selectedParentId}
        onClose={() => setSelectedParentId(null)}
        isAdmin={isAdmin}
        onOpenChild={openChild}
      />

      <ChildSheet
        childId={selectedChildId}
        open={childSheetOpen}
        onClose={() => setChildSheetOpen(false)}
        isAdmin={isAdmin}
        onOpenParent={openParentById}
      />
    </div>
  );
}
