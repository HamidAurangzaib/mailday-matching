import { Switch, Route, Router as WouterRouter, useLocation, Link } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";

import Login from "@/pages/login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Dashboard from "@/pages/dashboard";
import Queue from "@/pages/queue";
import Matching from "@/pages/matching";
import History from "@/pages/history";
import ActiveMatches from "@/pages/active-matches";
import Incomplete from "@/pages/incomplete";
import Children from "@/pages/children";
import Parents from "@/pages/parents";
import Users from "@/pages/users";
import EmailTemplates from "@/pages/email-templates";
import AuditLog from "@/pages/audit-log";
import PendingAddresses from "@/pages/pending-addresses";
import ConsentStatus from "@/pages/consent-status";
import Onboarding from "@/pages/onboarding";
import Enroll from "@/pages/enroll";
import AddressChange from "@/pages/address-change";
import VAPerformance from "@/pages/va-performance";
import GiveAKeyApply from "@/pages/give-a-key-apply";
import GiveAKeyPoBox from "@/pages/give-a-key-po-box";
import GiveAKeyDashboard from "@/pages/give-a-key-dashboard";
import GiveAKeyApplications from "@/pages/give-a-key-applications";
import GiveAKeyWaitlist from "@/pages/give-a-key-waitlist";
import GiveAKeyDonations from "@/pages/give-a-key-donations";
import GiveAKeyReceipts from "@/pages/give-a-key-receipts";
import GiveAKeyTasks from "@/pages/give-a-key-tasks";
import ActionItems from "@/pages/action-items";
import Help from "@/pages/help";
import { ComingSoon } from "@/pages/coming-soon";
import Influencers from "@/pages/influencers";
import PackDelivery from "@/pages/pack-delivery";
import Cancellations from "@/pages/cancellations";
import SearchPage from "@/pages/search";

const queryClient = new QueryClient();

function AccessDenied() {
  return (
    <AppLayout>
      <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4 min-h-[60vh]">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <ShieldOff className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-heading font-bold">Access Restricted</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          This page is only available to admin accounts. Contact an admin if you need access.
        </p>
        <Link href="/">
          <Button variant="outline">Back to Dashboard</Button>
        </Link>
      </div>
    </AppLayout>
  );
}

function ProtectedRoute({ component: Component, adminOnly = false }: { component: React.ComponentType; adminOnly?: boolean }) {
  const { user, token } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!token) setLocation("/login");
  }, [token, setLocation]);

  if (!token) return null;
  if (adminOnly && user?.role !== "admin") return <AccessDenied />;

  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function makePage(Component: React.ComponentType, adminOnly = false) {
  return function Page() {
    return <ProtectedRoute component={Component} adminOnly={adminOnly} />;
  };
}

const DashboardPage = makePage(Dashboard);
const CancellationsPage = makePage(Cancellations, true);
const ActionItemsPage = makePage(ActionItems);
const QueuePage = makePage(Queue);
const MatchingPage = makePage(Matching, true);
const HistoryPage = makePage(History);
const IncompletePage = makePage(Incomplete, true);
const ChildrenPage = makePage(Children);
const ParentsPage = makePage(Parents);
const UsersPage = makePage(Users, true);
const EmailTemplatesPage = makePage(EmailTemplates, true);
const AuditLogPage = makePage(AuditLog, true);
const PendingAddressesPage = makePage(PendingAddresses, true);
const ConsentStatusPage = makePage(ConsentStatus, true);
const VAPerformancePage = makePage(VAPerformance);
const GiveAKeyDashboardPage = makePage(GiveAKeyDashboard, true);
const GiveAKeyApplicationsPage = makePage(GiveAKeyApplications);
const GiveAKeyWaitlistPage = makePage(GiveAKeyWaitlist);
const GiveAKeyDonationsPage = makePage(GiveAKeyDonations, true);
const GiveAKeyReceiptsPage = makePage(GiveAKeyReceipts, true);
const GiveAKeyTasksPage = makePage(GiveAKeyTasks);

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/" component={DashboardPage} />
      <Route path="/action-items" component={ActionItemsPage} />
      <Route path="/queue" component={QueuePage} />
      <Route path="/matching" component={MatchingPage} />
      <Route path="/history" component={HistoryPage} />
      <Route path="/active-matches" component={() => <ProtectedRoute component={ActiveMatches} />} />
      <Route path="/incomplete" component={IncompletePage} />
      <Route path="/children" component={ChildrenPage} />
      <Route path="/parents" component={ParentsPage} />
      <Route path="/users" component={UsersPage} />
      <Route path="/admin/email-templates" component={EmailTemplatesPage} />
      <Route path="/admin/audit-log" component={AuditLogPage} />
      <Route path="/admin/pending-addresses" component={PendingAddressesPage} />
      <Route path="/admin/consent-status" component={ConsentStatusPage} />
      <Route path="/performance" component={VAPerformancePage} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/enroll" component={Enroll} />
      <Route path="/address-change" component={AddressChange} />
      <Route path="/give-a-key/apply" component={GiveAKeyApply} />
      <Route path="/give-a-key/po-box" component={GiveAKeyPoBox} />
      <Route path="/give-a-key" component={GiveAKeyDashboardPage} />
      <Route path="/give-a-key/applications" component={GiveAKeyApplicationsPage} />
      <Route path="/give-a-key/waitlist" component={GiveAKeyWaitlistPage} />
      <Route path="/give-a-key/receipts" component={GiveAKeyReceiptsPage} />
      <Route path="/give-a-key/donations" component={GiveAKeyDonationsPage} />
      <Route path="/give-a-key/tasks" component={GiveAKeyTasksPage} />
      <Route path="/search" component={() => <ProtectedRoute component={SearchPage} />} />
      <Route path="/help" component={() => <ProtectedRoute component={Help} />} />
      <Route path="/pack-delivery" component={() => <ProtectedRoute component={PackDelivery} />} />
      <Route path="/cancellations" component={CancellationsPage} />
      <Route path="/influencers" component={() => <ProtectedRoute component={Influencers} adminOnly />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
