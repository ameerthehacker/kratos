import { createBrowserRouter, Navigate } from "react-router";
import { Layout, Shell } from "@/components/layout";
import { HomePage } from "@/pages/home";
import { PlanPage } from "@/pages/plan";
import { ReviewPage } from "@/pages/review";
import { SessionPage } from "@/pages/session";

/** Kratos routes (React Router, owner request): Home, one URL per session, its review (3v2), and
 * the plans: a feature's and a session's (4p1b). */
export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "s/:sessionId/review", element: <ReviewPage /> },
      {
        element: <Layout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "s/:sessionId", element: <SessionPage /> },
          { path: "s/:sessionId/plan", element: <PlanPage kind="session" /> },
          { path: "f/:featureId/plan", element: <PlanPage kind="feature" /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
