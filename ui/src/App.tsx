import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { ChatPage } from "./pages/ChatPage";
import { TelemetryPage } from "./pages/TelemetryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminPage } from "./pages/AdminPage";
import DiagnosticsPage from "./pages/DiagnosticsPage";
import ProjectsPage from "./pages/ProjectsPage";
import { PlansPage } from "./pages/PlansPage";
import { PlanDetailPage } from "./pages/PlanDetailPage";
import { TaskHistoryPage } from "./pages/TaskHistoryPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<HomePage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/telemetry" element={<TelemetryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/plans" element={<PlansPage />} />
              <Route path="/plans/:id" element={<PlanDetailPage />} />
              <Route path="/task-history" element={<TaskHistoryPage />} />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}


