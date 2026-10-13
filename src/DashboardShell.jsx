import { containDialogFocus } from "./dialogFocus";
import React, { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Building2, HelpCircle, ListChecks, Clock, Bot, MessagesSquare, BarChart3,
  CreditCard, LogOut, Menu, X, CalendarDays, Users, Plug, ArrowUpRight, ChevronRight } from "lucide-react";
import { Logo } from "./shared";
import { STAFF_DASHBOARD_TABS } from "./dashboardNavigation";

const NAV_GROUPS = [
  { label: "Workspace", items: [{ id: "gettingStarted", label: "Getting Started", icon: ListChecks }, { id: "overview", label: "Overview", icon: LayoutDashboard }] },
  { label: "Assistant", items: [{ id: "ai", label: "AI Settings", icon: Bot }, { id: "faqs", label: "FAQs", icon: HelpCircle }] },
  { label: "Customer Operations", items: [{ id: "conversations", label: "Conversations", icon: MessagesSquare }, { id: "bookings", label: "Bookings", icon: CalendarDays }] },
  { label: "Business Management", items: [{ id: "profile", label: "Business Profile", icon: Building2 }, { id: "services", label: "Services & Pricing", icon: ListChecks }, { id: "hours", label: "Hours & Location", icon: Clock }, { id: "staff", label: "Staff", icon: Users }] },
  { label: "Operations", items: [{ id: "integrations", label: "Integrations", icon: Plug }, { id: "analytics", label: "Analytics", icon: BarChart3 }, { id: "billing", label: "Billing", icon: CreditCard }] },
];
const NAV_ITEMS = NAV_GROUPS.flatMap(group => group.items);

function Navigation({ active, selectTab, isStaff }) {
  return <nav className="dash-nav" aria-label="Dashboard">{NAV_GROUPS.map(group => {
    const items = isStaff ? group.items.filter(item => STAFF_DASHBOARD_TABS.includes(item.id)) : group.items;
    return items.length ? <div className="dash-nav-group" key={group.label}><p className="dash-nav-heading">{group.label}</p>
      {items.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={active === id ? "page" : undefined}
        className={`dash-nav-item ${active === id ? "dash-nav-item--active" : ""}`} onClick={() => selectTab(id)}>
        <Icon className="dash-nav-icon" aria-hidden="true" /><span>{label}</span></button>)}</div> : null;
  })}</nav>;
}
export function DashboardShell({ go, active, setActive, children, isStaff = false, user }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawer = useRef(null);
  const content = useRef(null);
  const mounted = useRef(false);
  const current = NAV_ITEMS.find(item => item.id === active);
  const selectTab = tab => { setActive(tab); setMobileOpen(false); };
  useEffect(() => {
    const node = drawer.current;
    if (mobileOpen && !node.open) node.showModal();
    if (!mobileOpen && node.open) node.close();
    const media = window.matchMedia("(min-width: 901px)");
    const closeOnDesktop = () => { if (media.matches) setMobileOpen(false); };
    media.addEventListener("change", closeOnDesktop);
    const previousOverflow = document.body.style.overflow;
    if (mobileOpen) document.body.style.overflow = "hidden";
    return () => { media.removeEventListener("change", closeOnDesktop); document.body.style.overflow = previousOverflow; };
  }, [mobileOpen]);
  useEffect(() => {
    if (mounted.current) {
      content.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    mounted.current = true;
  }, [active]);
  const actions = <div className="dash-sidebar-footer"><button type="button" className="dash-nav-item" onClick={() => go("landing")}><ArrowUpRight className="dash-nav-icon" />Visit website</button>
    <button type="button" className="dash-nav-item" onClick={() => go("login")}><LogOut className="dash-nav-icon" />Log out</button></div>;
  return <div className="dash-shell">
    <a className="skip-link" href="#dashboard-content">Skip to workspace</a>
    <aside className="dash-sidebar"><div className="dash-sidebar-top"><Logo size={21} /><span className="sidebar-caption">BUSINESS WORKSPACE</span></div>
      <Navigation active={active} selectTab={selectTab} isStaff={isStaff} />{actions}</aside>
    <div className="dash-workspace"><header className="workspace-topbar">
      <button type="button" className="dash-mobile-toggle" aria-expanded={mobileOpen} aria-controls="ezeji-dashboard-navigation"
        aria-label="Open dashboard navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
      <div className="workspace-identity"><span className="business-avatar" aria-hidden="true">{user?.business?.slice(0, 1).toUpperCase() || "E"}</span>
        <span className="workspace-business">{user?.business || "Your business"}</span><ChevronRight size={14} aria-hidden="true" />
        <span className="workspace-context">{current?.label}</span></div>
      <span className="badge badge--neutral workspace-role">{isStaff ? "Staff workspace" : user?.plan || "Owner workspace"}</span>
    </header><main id="dashboard-content" ref={content} tabIndex={-1} className="dash-main">{children}</main></div>
    <dialog id="ezeji-dashboard-navigation" className="navigation-drawer" ref={drawer} aria-label="Dashboard navigation" aria-modal="true" onKeyDown={containDialogFocus}
      onCancel={event => { event.preventDefault(); setMobileOpen(false); }}>
      <div className="drawer-header"><Logo size={20} /><button type="button" className="icon-btn" aria-label="Close dashboard navigation" onClick={() => setMobileOpen(false)}><X size={20} /></button></div>
      <Navigation active={active} selectTab={selectTab} isStaff={isStaff} />{actions}</dialog>
  </div>;
}
