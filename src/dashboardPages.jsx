import { lazy } from "react";

// Pages load only when selected; permissions still come from the account and server.
export const DASHBOARD_PAGES = {
  gettingStarted: lazy(() => import("./gettingStarted").then(module => ({ default: module.GettingStartedPage }))),
  overview: lazy(() => import("./pages/OverviewPage").then(module => ({ default: module.OverviewPage }))),
  profile: lazy(() => import("./pages/BusinessProfilePage").then(module => ({ default: module.BusinessProfilePage }))),
  faqs: lazy(() => import("./pages/FAQsPage").then(module => ({ default: module.FAQsPage }))),
  services: lazy(() => import("./pages/ServicesPage").then(module => ({ default: module.ServicesPage }))),
  hours: lazy(() => import("./pages/HoursLocationPage").then(module => ({ default: module.HoursLocationPage }))),
  ai: lazy(() => import("./pages/AISettingsPage").then(module => ({ default: module.AISettingsPage }))),
  staff: lazy(() => import("./pages/StaffPage").then(module => ({ default: module.StaffPage }))),
  bookings: lazy(() => import("./pages/BookingsPage").then(module => ({ default: module.BookingsPage }))),
  conversations: lazy(() => import("./pages/ConversationsPage").then(module => ({ default: module.ConversationsPage }))),
  analytics: lazy(() => import("./pages/AnalyticsPage").then(module => ({ default: module.AnalyticsPage }))),
  billing: lazy(() => import("./pages/BillingPage").then(module => ({ default: module.BillingPage }))),
  integrations: lazy(() => import("./pages/IntegrationsPage").then(module => ({ default: module.IntegrationsPage }))),
};
