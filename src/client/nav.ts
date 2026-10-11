import { CalendarDays, HandCoins, LayoutDashboard, ListTodo, Receipt, Settings, Sun, Target } from "lucide-react";

// Telas do LifeOS. `section` agrupa a barra lateral (finance ganha título); `month` mostra o seletor de mês no cabeçalho.
export const NAV = [
  { view: "today", label: "Hoje", icon: Sun, title: "Hoje", month: false, section: "main" },
  { view: "agenda", label: "Agenda", icon: CalendarDays, title: "Agenda", month: false, section: "main" },
  { view: "tasks", label: "Tarefas", icon: ListTodo, title: "Tarefas", month: false, section: "main" },
  { view: "summary", label: "Resumo", icon: LayoutDashboard, title: "Resumo", month: true, section: "finance" },
  { view: "expenses", label: "Gastos", icon: Receipt, title: "Gastos", month: true, section: "finance" },
  { view: "receivables", label: "Devedores", icon: HandCoins, title: "Devedores", month: false, section: "finance" },
  { view: "goals", label: "Metas", icon: Target, title: "Metas e investimentos", month: true, section: "finance" },
  { view: "settings", label: "Ajustes", icon: Settings, title: "Ajustes", month: false, section: "system" },
] as const;

export type NavItem = (typeof NAV)[number];

const SECTION_LABEL: Record<NavItem["section"], string | null> = { main: null, finance: "Finanças", system: null };

export const NAV_SECTIONS = (["main", "finance", "system"] as const).map((section) => ({
  label: SECTION_LABEL[section],
  items: NAV.filter((n) => n.section === section),
}));

/** Barra inferior do celular: estas telas + botão "+" + "Mais" (o resto). */
export const MOBILE_TABS = ["today", "agenda", "tasks"] as const;
