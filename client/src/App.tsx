import { BrowserRouter, Routes, Route } from "react-router-dom";
import NavMenu from "./components/NavMenu";
import AddJobPage from "./pages/AddJobPage";
import JobsListPage from "./pages/JobsListPage";
import JobViewPage from "./pages/JobViewPage";
import UrlResolutionTracePage from "./pages/UrlResolutionTracePage";
import ApplicationDashboardPage from "./pages/ApplicationDashboardPage";
import ContainersListPage from "./pages/ContainersListPage";
import ContainerViewPage from "./pages/ContainerViewPage";
import ApplicationProfilesPage from "./pages/ApplicationProfilesPage";
import JobAttemptsPage from "./pages/JobAttemptsPage";
import ApplicationAttemptDetailPage from "./pages/ApplicationAttemptDetailPage";

/**
 * Root application component that sets up routing and the navigation menu.
 * Routes:
 *   / — Add a new job listing
 *   /jobs — View all job listings
 *   /jobs/:id — View a single job listing
 *   /jobs/:id/url-resolution — Admin-facing live trace of the application-URL resolver
 *   /jobs/:id/attempts — Per-job application attempts history
 *   /applications/:id — Read-only per-attempt detail (screenshot + step log). Requires ?jobId=N query param.
 *   /apply — Application dashboard for applying to jobs
 *   /profiles — CRUD UI for ApplicationProfile rows
 *   /containers — List + spawn managed Docker containers (create is inline)
 *   /containers/:id — View a single managed container with health-check ping
 */
function App() {
  return (
    <BrowserRouter>
      <NavMenu />
      <Routes>
        <Route path="/" element={<AddJobPage />} />
        <Route path="/jobs" element={<JobsListPage />} />
        <Route path="/jobs/:id" element={<JobViewPage />} />
        <Route path="/jobs/:id/url-resolution" element={<UrlResolutionTracePage />} />
        <Route path="/jobs/:id/attempts" element={<JobAttemptsPage />} />
        <Route path="/applications/:id" element={<ApplicationAttemptDetailPage />} />
        <Route path="/apply" element={<ApplicationDashboardPage />} />
        <Route path="/profiles" element={<ApplicationProfilesPage />} />
        <Route path="/containers" element={<ContainersListPage />} />
        <Route path="/containers/:id" element={<ContainerViewPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
