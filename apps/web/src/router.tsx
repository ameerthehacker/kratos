import { createBrowserRouter, Navigate } from "react-router";
import { Layout } from "@/components/layout";
import { HomePage } from "@/pages/home";
import { SessionPage } from "@/pages/session";

/** Kratos routes (React Router, owner request): Home and one URL per session. */
export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "s/:sessionId", element: <SessionPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
