import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useMe } from "@/api/session";
import { Toaster } from "@/components/toast";
import { DialogHost } from "@/components/dialog";
import CksCustomerPage from "@/pages/cks/CksCustomerPage";
import CksPage from "@/pages/cks/CksPage";
import ContractPage from "@/pages/contracts/ContractPage";
import ContractsPage from "@/pages/contracts/ContractsPage";
import NewContractPage from "@/pages/contracts/NewContractPage";
import FeedbackPage from "@/pages/feedback/FeedbackPage";
import LoginPage, { OnboardingPage } from "@/pages/auth/LoginPage";
import PartnersPage from "@/pages/partners/PartnersPage";
import PricesPage from "@/pages/prices/PricesPage";
import SettingsPage from "@/pages/settings/SettingsPage";
import ScoringPage from "@/pages/settings/ScoringPage";
import Shell from "./Shell";

/** Signed in with an organisation, or sent where that gets sorted out. */
function Gate() {
  const me = useMe();
  const { pathname, search } = useLocation();
  if (me.isLoading) return <p role="status" className="p-10 text-sm text-dim">Đang tải…</p>;
  if (me.error || !me.data) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  if (!me.data.org) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route element={<Gate />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/contracts" replace />} />
          <Route path="contracts" element={<ContractsPage />} />
          <Route path="contracts/new" element={<NewContractPage />} />
          <Route path="contracts/:id" element={<ContractPage />} />
          <Route path="partners" element={<PartnersPage />} />
          <Route path="prices" element={<PricesPage />} />
          <Route path="cks" element={<CksPage />} />
          <Route path="cks/:id" element={<CksCustomerPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/scoring" element={<ScoringPage />} />
          <Route path="feedback" element={<FeedbackPage />} />
          <Route path="*" element={<Navigate to="/contracts" replace />} />
        </Route>
      </Route>
    </Routes>
    <Toaster />
    <DialogHost />
    </>
  );
}
