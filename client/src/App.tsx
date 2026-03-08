import { BrowserRouter, Routes, Route } from "react-router-dom";
import NavMenu from "./components/NavMenu";
import AddJobPage from "./pages/AddJobPage";
import JobsListPage from "./pages/JobsListPage";
import JobViewPage from "./pages/JobViewPage";

/**
 * Root application component that sets up routing and the navigation menu.
 * Routes:
 *   / — Add a new job listing
 *   /jobs — View all job listings
 *   /jobs/:id — View a single job listing
 */
function App() {
  return (
    <BrowserRouter>
      <NavMenu />
      <Routes>
        <Route path="/" element={<AddJobPage />} />
        <Route path="/jobs" element={<JobsListPage />} />
        <Route path="/jobs/:id" element={<JobViewPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
