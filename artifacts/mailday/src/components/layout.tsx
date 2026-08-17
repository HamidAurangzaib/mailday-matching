import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider
} from "@/components/ui/sidebar";
import {
  Home,
  Users,
  UserPlus,
  Activity,
  MapPin,
  History,
  LogOut,
  Mail,
  AlertTriangle,
  ShieldCheck,
  KeyRound,
  Link2,
  Check,
  Gift,
  LayoutDashboard,
  ClipboardList,
  Clock,
  DollarSign,
  Receipt,
  BookOpen,
  Inbox,
  Search,
  Package,
  UserMinus,
  Star,
  RotateCcw,
  Sparkles,
  TrendingUp,
  Settings,
  Menu,
  X,
  Handshake,
} from "lucide-react";
import { useLogout, customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function useChangePassword() {
  return useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      customFetch("/api/auth/me/password", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  });
}

function NavSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="px-2 pt-4 pb-1">
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">
          {Icon && <Icon className="w-3 h-3" />}
          {title}
        </div>
      </div>
      {children}
    </>
  );
}

function NavItem({
  href,
  icon: Icon,
  label,
  badge,
  location,
  onNavigate,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  badge?: number | null;
  location: string;
  onNavigate?: () => void;
}) {
  const isActive = location === href || (href !== "/" && location.startsWith(href));
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <Link href={href} className="flex items-center gap-3" onClick={onNavigate}>
          <Icon className="w-4 h-4 shrink-0" />
          <span className="flex-1 font-normal">{label}</span>
          {badge != null && badge > 0 && (
            <span className="ml-auto text-[11px] font-bold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {badge}
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// Full nav tree — shared between desktop sidebar and mobile overlay
function NavTree({
  location,
  isAdmin,
  isVA,
  totalActionItems,
  copiedGak,
  copiedPoBox,
  onCopyGak,
  onCopyPoBox,
  onNavigate,
}: {
  location: string;
  isAdmin: boolean;
  isVA: boolean;
  totalActionItems: number;
  copiedGak: boolean;
  copiedPoBox: boolean;
  onCopyGak: () => void;
  onCopyPoBox: () => void;
  onNavigate?: () => void;
}) {
  return (
    <SidebarMenu>
      <div className="pt-2">
        <NavItem href="/" icon={Home} label="Dashboard" location={location} onNavigate={onNavigate} />
        <NavItem href="/action-items" icon={Inbox} label="Action Items" badge={totalActionItems} location={location} onNavigate={onNavigate} />
      </div>

      <NavSection title="Matching" icon={Sparkles}>
        <NavItem href="/queue"          icon={Activity}  label="Unmatched Queue" location={location} onNavigate={onNavigate} />
        <NavItem href="/queue?rematch=1" icon={RotateCcw} label="Rematch Queue"   location={location} onNavigate={onNavigate} />
        <NavItem href="/matching"        icon={Sparkles}  label="Match Session"   location={location} onNavigate={onNavigate} />
        <NavItem href="/active-matches"  icon={Users}     label="Active Matches"  location={location} onNavigate={onNavigate} />
        <NavItem href="/history"         icon={History}   label="Match History"   location={location} onNavigate={onNavigate} />
      </NavSection>

      <NavSection title="Members" icon={Users}>
        <NavItem href="/children"  icon={UserPlus}      label="Children"              location={location} onNavigate={onNavigate} />
        <NavItem href="/parents"   icon={Users}         label="Parents"               location={location} onNavigate={onNavigate} />
        {isAdmin && <NavItem href="/incomplete" icon={AlertTriangle} label="Incomplete Onboarding" location={location} onNavigate={onNavigate} />}
      </NavSection>

      <NavSection title="Give a Key" icon={Gift}>
        {isAdmin && <NavItem href="/give-a-key" icon={LayoutDashboard} label="Dashboard" location={location} onNavigate={onNavigate} />}
        <NavItem href="/give-a-key/applications" icon={ClipboardList} label="Applications" location={location} onNavigate={onNavigate} />
        <NavItem href="/give-a-key/waitlist"     icon={Clock}          label="Waitlist"     location={location} onNavigate={onNavigate} />
        {isAdmin && (
          <>
            <NavItem href="/give-a-key/receipts"  icon={Receipt}    label="Receipts"   location={location} onNavigate={onNavigate} />
            <NavItem href="/give-a-key/donations" icon={DollarSign} label="Donations"  location={location} onNavigate={onNavigate} />
          </>
        )}
      </NavSection>

      {(isAdmin || isVA) && (
        <NavSection title="Operations" icon={Settings}>
          <NavItem href="/pack-delivery" icon={Package}   label="Pack Delivery Tracker" location={location} onNavigate={onNavigate} />
          {isAdmin && <NavItem href="/cancellations" icon={UserMinus} label="Cancellation Tracker"  location={location} onNavigate={onNavigate} />}
        </NavSection>
      )}

      {isAdmin && (
        <NavSection title="Growth" icon={TrendingUp}>
          <NavItem href="/influencers" icon={Star} label="Influencer Tracker" location={location} onNavigate={onNavigate} />
        </NavSection>
      )}

      {isAdmin && (
        <NavSection title="Admin" icon={ShieldCheck}>
          <NavItem href="/users" icon={ShieldCheck} label="User Management" location={location} onNavigate={onNavigate} />
          <NavItem href="/admin/email-templates" icon={Mail} label="Email Templates" location={location} onNavigate={onNavigate} />
          <NavItem href="/admin/pending-addresses" icon={MapPin} label="Pending Addresses" location={location} onNavigate={onNavigate} />
          <NavItem href="/admin/consent-status" icon={Handshake} label="Consent Status" location={location} onNavigate={onNavigate} />
          <NavItem href="/admin/audit-log" icon={Activity} label="Audit Log" location={location} onNavigate={onNavigate} />
        </NavSection>
      )}

      <div className="px-2 pt-4 pb-1">
        <div className="h-px bg-border" />
      </div>
      <div className="px-2 py-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1 mb-1.5">Quick Links</div>
        <div className="rounded-lg border overflow-hidden divide-y divide-border">
          {[
            { label: "GAK Application", onClick: onCopyGak,    copied: copiedGak   },
            { label: "PO Box Form",      onClick: onCopyPoBox,  copied: copiedPoBox },
          ].map(({ label, onClick, copied }) => (
            <button
              key={label}
              onClick={onClick}
              className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/30 transition-colors text-left"
            >
              <span className={copied ? "text-green-600 font-medium" : "text-muted-foreground"}>
                {copied ? "Copied!" : label}
              </span>
              {copied
                ? <Check className="w-3 h-3 text-green-600 shrink-0" />
                : <Link2 className="w-3 h-3 text-muted-foreground shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      <SidebarMenuItem className="mt-1 mb-2">
        <SidebarMenuButton asChild isActive={location === "/help"}>
          <Link href="/help" className="flex items-center gap-3" onClick={onNavigate}>
            <BookOpen className="w-4 h-4" />
            <span>Help & Guide</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const logoutMutation = useLogout();
  const changePasswordMutation = useChangePassword();

  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [copiedGak, setCopiedGak] = useState(false);
  const [copiedPoBox, setCopiedPoBox] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const { data: actionItemsData } = useQuery<{
    total: number; gak_tasks: number; urgent: number; warning: number;
    overdue_onboarding: number; pending_apps: number; receipts_pending: number;
  }>({
    queryKey: ["action-items-count"],
    queryFn: () => customFetch("/api/action-items/count"),
    refetchInterval: 30000,
  });
  const totalActionItems = actionItemsData?.total ?? 0;

  const copyLink = (path: string, setter: (v: boolean) => void) => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    void navigator.clipboard.writeText(`${window.location.origin}${base}${path}`).then(() => {
      setter(true);
      setTimeout(() => setter(false), 2000);
    });
  };

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSettled: () => { logout(); setLocation("/login"); }
    });
  };

  const handleChangePassword = () => {
    if (newPw !== confirmPw) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    changePasswordMutation.mutate(
      { current_password: currentPw, new_password: newPw },
      {
        onSuccess: () => {
          toast({ title: "Password updated", description: "Your new password is active." });
          setPwOpen(false); setCurrentPw(""); setNewPw(""); setConfirmPw("");
        },
        onError: (err) => {
          toast({ title: "Failed to update password", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q) {
      setLocation(`/search?q=${encodeURIComponent(q)}`);
      setSearchQuery("");
      setMobileNavOpen(false);
    }
  };

  const isAdmin = user?.role === "admin";
  const isVA = user?.role === "va";

  const canSubmit =
    currentPw.length > 0 && newPw.length >= 8 && newPw === confirmPw && !changePasswordMutation.isPending;

  const navTreeProps = {
    location,
    isAdmin,
    isVA,
    totalActionItems,
    copiedGak,
    copiedPoBox,
    onCopyGak:    () => copyLink("/give-a-key/apply", setCopiedGak),
    onCopyPoBox:  () => copyLink("/give-a-key/po-box", setCopiedPoBox),
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">

        {/* ── Desktop sidebar (hidden on mobile) ── */}
        <Sidebar className="border-r hidden md:flex md:flex-col">
          <SidebarHeader className="p-3 space-y-3 border-b">
            <div className="flex items-center gap-2 px-1">
              <div className="bg-primary text-primary-foreground p-1 rounded-md shrink-0">
                <Mail className="w-5 h-5" />
              </div>
              <span className="font-heading font-bold text-lg leading-tight">MailDay Matching</span>
            </div>
            <form onSubmit={handleSearch} className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search members…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </form>
          </SidebarHeader>

          <SidebarContent className="overflow-y-auto">
            <NavTree {...navTreeProps} />
          </SidebarContent>

          <div className="p-4 border-t mt-auto space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">{user?.email}</span>
                <span className="text-xs text-muted-foreground capitalize">{user?.role}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon"
                  onClick={() => { setPwOpen(true); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }}
                  title="Change password">
                  <KeyRound className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleLogout} title="Log out">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </Sidebar>

        {/* ── Mobile top bar (visible only on mobile) ── */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-background border-b flex items-center gap-2 px-3 h-14">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="p-2 rounded-md hover:bg-muted transition-colors"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1.5 flex-1">
            <div className="bg-primary text-primary-foreground p-1 rounded-md shrink-0">
              <Mail className="w-4 h-4" />
            </div>
            <span className="font-heading font-bold text-base leading-tight">MailDay</span>
          </div>
          {/* Quick access: Dashboard + Action Items always visible on mobile top bar */}
          <Link href="/" className="p-2 rounded-md hover:bg-muted transition-colors" aria-label="Dashboard">
            <Home className="w-4 h-4" />
          </Link>
          <Link href="/action-items" className="relative p-2 rounded-md hover:bg-muted transition-colors" aria-label="Action Items">
            <Inbox className="w-4 h-4" />
            {totalActionItems > 0 && (
              <span className="absolute top-1 right-1 text-[9px] font-bold bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center">
                {totalActionItems > 9 ? "9+" : totalActionItems}
              </span>
            )}
          </Link>
        </div>

        {/* ── Mobile nav overlay ── */}
        {mobileNavOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setMobileNavOpen(false)}
            />
            {/* Drawer */}
            <div className="relative z-10 w-80 max-w-[85vw] bg-background flex flex-col h-full shadow-xl">
              {/* Drawer header */}
              <div className="p-3 space-y-3 border-b">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="bg-primary text-primary-foreground p-1 rounded-md shrink-0">
                      <Mail className="w-4 h-4" />
                    </div>
                    <span className="font-heading font-bold text-base">MailDay Matching</span>
                  </div>
                  <button
                    onClick={() => setMobileNavOpen(false)}
                    className="p-1.5 rounded-md hover:bg-muted transition-colors"
                    aria-label="Close navigation"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <form onSubmit={handleSearch} className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search members…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 pl-8 text-sm"
                  />
                </form>
              </div>

              {/* Drawer nav */}
              <div className="flex-1 overflow-y-auto">
                <NavTree {...navTreeProps} onNavigate={() => setMobileNavOpen(false)} />
              </div>

              {/* Drawer footer */}
              <div className="p-4 border-t">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">{user?.email}</span>
                    <span className="text-xs text-muted-foreground capitalize">{user?.role}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon"
                      onClick={() => { setPwOpen(true); setMobileNavOpen(false); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }}
                      title="Change password">
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleLogout} title="Log out">
                      <LogOut className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Main content ── */}
        <main className="flex-1 overflow-auto md:ml-0 pt-14 md:pt-0">
          {children}
        </main>
      </div>

      {/* Change Password Dialog */}
      <Dialog open={pwOpen} onOpenChange={(open) => { if (!open) setPwOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp-current">Current Password</Label>
              <Input id="cp-current" type="password" value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)} placeholder="Your current password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-new">New Password</Label>
              <Input id="cp-new" type="password" value={newPw}
                onChange={(e) => setNewPw(e.target.value)} placeholder="Min. 8 characters" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-confirm">Confirm New Password</Label>
              <Input id="cp-confirm" type="password" value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)} placeholder="Repeat new password" />
              {confirmPw.length > 0 && newPw !== confirmPw && (
                <p className="text-xs text-destructive mt-1">Passwords don't match</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwOpen(false)}>Cancel</Button>
            <Button onClick={handleChangePassword} disabled={!canSubmit}>
              {changePasswordMutation.isPending ? "Saving..." : "Update Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
