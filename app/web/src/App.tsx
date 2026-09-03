import { Navigate, Route, Routes } from "react-router-dom";
import { AgendaPage } from "./pages/AgendaPage";
import { CoordinatorDashboard } from "./pages/CoordinatorDashboard";
import { SupervisorPage } from "./pages/SupervisorPage";
import { TeacherPlanner } from "./pages/TeacherPlanner";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/planejamento" replace />} />
      <Route path="/planejamento" element={<TeacherPlanner />} />
      <Route path="/coordenacao" element={<CoordinatorDashboard />} />
      <Route path="/agenda/:lessonWeekId" element={<AgendaPage />} />
      <Route path="/supervisor/:lessonWeekId" element={<SupervisorPage />} />
    </Routes>
  );
}
