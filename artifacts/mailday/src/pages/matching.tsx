import { useState, useEffect, useRef } from "react";
import { useRunMatching, useApproveMatch } from "@workspace/api-client-react";
import type { MatchSession, MatchSuggestion } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Check, X, Loader2, CheckCircle2, AlertCircle, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LOADING_STEPS = [
  "Reading the unmatched queue…",
  "Analyzing interests and age ranges…",
  "Scoring compatibility pairs…",
  "Evaluating waiting times…",
  "Generating match suggestions…",
];

// Deterministic confetti pieces (no random on each render)
const CONFETTI_PIECES = Array.from({ length: 28 }, (_, i) => ({
  left: `${(i * 3.7 + 2) % 100}%`,
  color: ["#DD4B39", "#4CAF50", "#2196F3", "#FF9800", "#9C27B0", "#FFEB3B", "#00BCD4"][i % 7],
  delay: `${((i * 0.11) % 0.6).toFixed(2)}s`,
  duration: `${(1.8 + (i % 5) * 0.2).toFixed(1)}s`,
  size: `${8 + (i % 4) * 3}px`,
  isCircle: i % 3 !== 0,
  drift: (i % 2 === 0 ? 1 : -1) * (20 + (i % 4) * 15),
}));

const CONFETTI_CSS = `
@keyframes confettiFall {
  0%   { transform: translateY(-20px) rotate(0deg) translateX(0); opacity: 1; }
  100% { transform: translateY(110vh) rotate(600deg) translateX(var(--drift)); opacity: 0; }
}`;

function ConfettiBurst() {
  return (
    <>
      <style>{CONFETTI_CSS}</style>
      <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden" aria-hidden="true">
        {CONFETTI_PIECES.map((p, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.left,
              top: "-12px",
              width: p.size,
              height: p.size,
              borderRadius: p.isCircle ? "50%" : "2px",
              backgroundColor: p.color,
              animation: `confettiFall ${p.duration} ease-in forwards`,
              animationDelay: p.delay,
              ["--drift" as string]: `${p.drift}px`,
            }}
          />
        ))}
      </div>
    </>
  );
}

export default function Matching() {
  const { toast } = useToast();
  const runMatchingMutation = useRunMatching();
  const approveMatchMutation = useApproveMatch();

  const [session, setSession] = useState<MatchSession | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "approved" | "rejected">>({});
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);

  useEffect(() => {
    if (!runMatchingMutation.isPending) { setLoadingStep(0); return; }
    const id = setInterval(() => {
      setLoadingStep((prev) => Math.min(prev + 1, LOADING_STEPS.length - 1));
    }, 2800);
    return () => clearInterval(id);
  }, [runMatchingMutation.isPending]);

  useEffect(() => {
    return () => {
      if (confettiTimer.current) clearTimeout(confettiTimer.current);
    };
  }, []);

  const fireConfetti = () => {
    setShowConfetti(true);
    if (confettiTimer.current) clearTimeout(confettiTimer.current);
    confettiTimer.current = setTimeout(() => setShowConfetti(false), 3000);
  };

  const handleRunMatching = () => {
    runMatchingMutation.mutate(undefined, {
      onSuccess: (data) => {
        setSession(data as MatchSession);
        setDecisions({});
        toast({ title: "Matching complete", description: `Found ${data.suggestions?.length || 0} suggestions.` });
      },
      onError: (err) => {
        toast({ title: "Error running matching", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleApprove = (suggestion: MatchSuggestion) => {
    const key = `${suggestion.child_a_id}-${suggestion.child_b_id}`;

    approveMatchMutation.mutate(
      { data: {
        child_a_id: suggestion.child_a_id,
        child_b_id: suggestion.child_b_id,
        shared_interests: suggestion.shared_interests
      }},
      {
        onSuccess: () => {
          setDecisions(prev => ({ ...prev, [key]: "approved" }));
          fireConfetti();
          toast({ title: "Match approved!", description: `${suggestion.child_a?.child_first_name} & ${suggestion.child_b?.child_first_name} are now pen pals.` });
        },
        onError: (err) => {
          toast({ title: "Failed to approve match", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  const handleReject = (suggestion: MatchSuggestion) => {
    const key = `${suggestion.child_a_id}-${suggestion.child_b_id}`;
    setDecisions(prev => ({ ...prev, [key]: "rejected" }));
  };

  if (!session) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-6 max-w-md mx-auto">
        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center">
          <Bot className="w-10 h-10 text-primary" />
        </div>
        <h1 className="text-3xl font-heading font-bold">AI Match Session</h1>
        <p className="text-muted-foreground">
          Run the intelligent matching algorithm to find optimal pen pal pairings from the current queue. This process evaluates interests, ages, tiers, and waiting times.
        </p>
        <Button
          size="lg"
          onClick={handleRunMatching}
          disabled={runMatchingMutation.isPending}
          className="w-full text-lg h-14"
        >
          {runMatchingMutation.isPending ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Running…
            </>
          ) : (
            "Run AI Matching"
          )}
        </Button>

        {runMatchingMutation.isPending && (
          <div className="w-full space-y-2 pt-2">
            {LOADING_STEPS.map((step, i) => (
              <div
                key={step}
                className={`flex items-center gap-2.5 text-sm transition-all duration-500 ${
                  i < loadingStep ? "text-muted-foreground" :
                  i === loadingStep ? "text-foreground font-medium" :
                  "text-muted-foreground/30"
                }`}
              >
                {i < loadingStep ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                ) : i === loadingStep ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-muted-foreground/20 shrink-0" />
                )}
                {step}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const suggestions = session.suggestions || [];
  const noMatchFound = (session.no_match_found || []) as Array<{ id: string; child_first_name: string; age: number; tier: string; parent: { state?: string | null } }>;
  const reviewedCount = Object.keys(decisions).length;
  const isComplete = suggestions.length > 0 && reviewedCount === suggestions.length;

  // Detect why children couldn't be matched
  const CORE_TIERS = new Set(["Core", "Homeschool Core"]);
  const MINIS_TIERS = new Set(["Minis", "Homeschool Minis"]);
  const getBand = (tier: string) => CORE_TIERS.has(tier) ? "Core" : MINIS_TIERS.has(tier) ? "Minis" : "Unknown";
  const noMatchByBand = noMatchFound.reduce<Record<string, typeof noMatchFound>>((acc, c) => {
    const band = getBand(c.tier);
    if (!acc[band]) acc[band] = [];
    acc[band].push(c);
    return acc;
  }, {});
  const noMatchReason = noMatchFound.length > 0
    ? Object.entries(noMatchByBand)
        .filter(([, kids]) => kids.length === 1)
        .map(([band]) => `only 1 ${band} child in queue`)
        .join(", ") || "all potential partners have been previously matched"
    : null;

  return (
    <>
      {showConfetti && <ConfettiBurst />}

      <div className="p-4 md:p-8 space-y-8 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-heading font-bold">Review Suggestions</h1>
            <p className="text-muted-foreground mt-1">
              {reviewedCount} of {suggestions.length} reviewed
            </p>
          </div>
          {isComplete && (
            <Button onClick={() => setSession(null)}>Start New Session</Button>
          )}
        </div>

        {suggestions.length === 0 ? (
          <div className="space-y-4">
            <Card className="bg-white border-amber-200 border-2">
              <CardContent className="p-8">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                    <AlertCircle className="w-5 h-5 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg text-amber-900 mb-1">No matches found</h3>
                    {noMatchReason ? (
                      <p className="text-sm text-amber-800 mb-4">
                        The AI couldn't pair anyone this session — <span className="font-medium">{noMatchReason}</span>.
                        Children can only be matched within the same age band (Core with Core, Minis with Minis), and can't be re-matched with a previous pen pal.
                      </p>
                    ) : (
                      <p className="text-sm text-amber-800 mb-4">
                        The AI couldn't find any valid pairings this session. This usually means the queue doesn't have enough children in the same age band, or all potential partners have been previously matched.
                      </p>
                    )}
                    {noMatchFound.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Children in queue</p>
                        <div className="grid gap-2">
                          {noMatchFound.map((child) => (
                            <div key={child.id} className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                              <div className="flex-1">
                                <span className="font-medium text-sm text-amber-900">{child.child_first_name}</span>
                                <span className="text-amber-700 text-xs ml-2">age {child.age}</span>
                              </div>
                              <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px]">{child.tier}</Badge>
                              {child.parent?.state && (
                                <span className="flex items-center gap-1 text-xs text-amber-600">
                                  <MapPin className="w-3 h-3" />{child.parent.state}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            <Button variant="outline" onClick={() => setSession(null)} className="w-full">
              Start New Session
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {suggestions.map((sug: MatchSuggestion) => {
              const key = `${sug.child_a_id}-${sug.child_b_id}`;
              const decision = decisions[key];

              if (decision) {
                return (
                  <Card key={key} className={`opacity-60 border-2 ${decision === 'approved' ? 'border-green-500/50' : 'border-destructive/50'}`}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="font-medium">
                        {sug.child_a?.child_first_name} & {sug.child_b?.child_first_name}
                      </div>
                      <Badge variant={decision === 'approved' ? 'default' : 'destructive'} className={decision === 'approved' ? 'bg-green-500' : ''}>
                        {decision.toUpperCase()}
                      </Badge>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <Card key={key} className="overflow-hidden border-2 border-primary/20 shadow-lg">
                  <div className="bg-muted/10 p-4 border-b flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-secondary text-secondary-foreground">
                        Score: {sug.confidence_score}/10
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="text-destructive hover:bg-destructive hover:text-white border-destructive/20"
                        onClick={() => handleReject(sug)}
                      >
                        <X className="w-4 h-4 mr-2" /> Reject
                      </Button>
                      <Button
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleApprove(sug)}
                        disabled={approveMatchMutation.isPending}
                      >
                        <Check className="w-4 h-4 mr-2" /> Approve Match
                      </Button>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
                    <div className="p-6 space-y-4 bg-background">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="text-2xl font-bold">{sug.child_a?.child_first_name}</h3>
                          <p className="text-muted-foreground">{sug.child_a?.age} yrs • {sug.child_a?.parent.state}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {sug.child_a?.days_waiting != null && (
                            <Badge variant="outline">{sug.child_a.days_waiting} days waiting</Badge>
                          )}
                          {((sug.child_a as unknown as Record<string, unknown>)?.rematch_count as number) > 0 && (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-200 border text-xs">
                              Rematch #{(sug.child_a as unknown as Record<string, unknown>).rematch_count as number}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {sug.child_a?.interests?.map((i: string) => <Badge key={i} variant="secondary" className="text-xs">{i}</Badge>)}
                      </div>
                    </div>

                    <div className="p-6 space-y-4 bg-background">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="text-2xl font-bold">{sug.child_b?.child_first_name}</h3>
                          <p className="text-muted-foreground">{sug.child_b?.age} yrs • {sug.child_b?.parent.state}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {sug.child_b?.days_waiting != null && (
                            <Badge variant="outline">{sug.child_b.days_waiting} days waiting</Badge>
                          )}
                          {((sug.child_b as unknown as Record<string, unknown>)?.rematch_count as number) > 0 && (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-200 border text-xs">
                              Rematch #{(sug.child_b as unknown as Record<string, unknown>).rematch_count as number}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {sug.child_b?.interests?.map((i: string) => <Badge key={i} variant="secondary" className="text-xs">{i}</Badge>)}
                      </div>
                    </div>
                  </div>

                  <div className="bg-primary/5 p-6 border-t">
                    <h4 className="font-semibold text-primary mb-2 flex items-center gap-2">
                      <Bot className="w-4 h-4" /> AI Reasoning
                    </h4>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                      {sug.reasoning}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2 items-center">
                      <span className="text-sm font-medium text-muted-foreground mr-2">Shared Interests:</span>
                      {sug.shared_interests.map((i: string) => (
                        <Badge key={i} className="bg-primary/20 text-primary hover:bg-primary/30 border-none">
                          {i}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Children who couldn't be matched — shown when suggestions exist but some were left out */}
        {suggestions.length > 0 && noMatchFound.length > 0 && (
          <Card className="bg-amber-50 border-amber-200">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-sm font-semibold text-amber-900">
                  {noMatchFound.length} {noMatchFound.length === 1 ? "child" : "children"} couldn't be matched
                </span>
                {noMatchReason && (
                  <span className="text-xs text-amber-700">— {noMatchReason}</span>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {noMatchFound.map((child) => (
                  <div key={child.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-white border border-amber-200">
                    <div className="flex-1">
                      <span className="font-medium text-sm">{child.child_first_name}</span>
                      <span className="text-muted-foreground text-xs ml-2">age {child.age}</span>
                    </div>
                    <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px]">{child.tier}</Badge>
                    {child.parent?.state && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" />{child.parent.state}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
