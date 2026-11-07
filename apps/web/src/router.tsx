import { createBrowserRouter, Navigate } from "react-router";
import { Layout, Shell } from "@/components/layout";
import { HomePage } from "@/pages/home";
import { ReviewPage } from "@/pages/review";
import { SessionPage } from "@/pages/session";

/** Kratos routes (React Router, owner request): Home, one URL per session, and its review (3v2). */
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
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
