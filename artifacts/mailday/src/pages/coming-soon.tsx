import { Construction } from "lucide-react";

export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="p-4 md:p-8">
      <h1 className="text-2xl md:text-3xl font-heading font-bold mb-8">{title}</h1>
      <div className="rounded-xl border-2 border-dashed border-border bg-muted/20 flex flex-col items-center justify-center py-20 text-center px-6">
        <Construction className="w-10 h-10 text-muted-foreground mb-4" />
        <div className="text-lg font-semibold text-foreground mb-1">Coming soon</div>
        <p className="text-sm text-muted-foreground max-w-xs">
          {description ?? "This section is on the roadmap and will be built in an upcoming session."}
        </p>
      </div>
    </div>
  );
}
