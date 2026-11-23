import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./api/auth.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Spools from "./pages/Spools.jsx";
import SpoolDetail from "./pages/SpoolDetail.jsx";
import SpoolForm from "./pages/SpoolForm.jsx";
import Profiles from "./pages/Profiles.jsx";
import ProfileForm from "./pages/ProfileForm.jsx";
import Locations from "./pages/Locations.jsx";
import Printers from "./pages/Printers.jsx";
import GcodeUpload from "./pages/GcodeUpload.jsx";
import PrintJobs from "./pages/PrintJobs.jsx";
import CostEstimate from "./pages/CostEstimate.jsx";
import ConsumeJob from "./pages/ConsumeJob.jsx";
import SpoolByQr from "./pages/SpoolByQr.jsx";
import Settings from "./pages/Settings.jsx";
import { t } from "./i18n.js";
import { api } from "./api/client.js";
import { useEffect } from "react";
import UpdateToast from "./components/UpdateToast.jsx";
import AppShell from "./components/shell/AppShell.jsx";
import { setLowConfig } from "./utils/spools.js";

function Layout({ children }) {
  return (
    <>
      <UpdateToast />
      <AppShell>{children}</AppShell>
    </>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  // Настройки порога «катушка заканчивается» живут на сервере. Тянем один раз
  // после входа: они нужны в списках, карточках и выборе катушки, а меняются
  // редко. До ответа действуют значения по умолчанию (10 %, 50–200 г).
  useEffect(() => {
    if (!user) return;
    api.get("/api/settings").then(setLowConfig).catch(() => {});
  }, [user?.id]);
  if (loading) return <div style={{ padding: 40 }}>{t("Загрузка…")}</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/spools" element={<Spools />} />
        <Route path="/spools/new" element={<SpoolForm />} />
        <Route path="/spools/:id/edit" element={<SpoolForm />} />
        <Route path="/spools/:id" element={<SpoolDetail />} />
        <Route path="/s/:token" element={<SpoolByQr />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/profiles/new" element={<ProfileForm />} />
        <Route path="/profiles/:id/edit" element={<ProfileForm />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/printers" element={<Printers />} />
        <Route path="/gcode" element={<GcodeUpload />} />
        <Route path="/print-jobs" element={<PrintJobs />} />
        <Route path="/print-jobs/:id/consume" element={<ConsumeJob />} />
        <Route path="/cost" element={<CostEstimate />} />
        <Route path="/cost/:id" element={<CostEstimate />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
