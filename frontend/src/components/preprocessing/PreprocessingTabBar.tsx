import { Smartphone, Scissors, Search, Lock } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type PreprocessingTab =
  | "device_detection"
  | "cropping"
  | "phi_detection"
  | "phi_redaction";

interface TabDef {
  id: PreprocessingTab;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const TABS: TabDef[] = [
  { id: "device_detection", label: "Device Detection", icon: Smartphone },
  { id: "cropping", label: "Cropping", icon: Scissors },
  { id: "phi_detection", label: "PHI Detection", icon: Search },
  { id: "phi_redaction", label: "PHI Redaction", icon: Lock },
];

interface PreprocessingTabBarProps {
  activeTab: PreprocessingTab;
  onTabChange: (tab: PreprocessingTab) => void;
  counts?: Partial<Record<PreprocessingTab, number>>;
}

export const PreprocessingTabBar = ({
  activeTab,
  onTabChange,
  counts,
}: PreprocessingTabBarProps) => {
  return (
    <div className="flex border-b border-slate-200 dark:border-slate-700">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors focus-ring ${
            activeTab === tab.id
              ? "border-primary-600 text-primary-600 dark:text-primary-400"
              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600"
          }`}
        >
          <tab.icon className="w-4 h-4" />
          <span>{tab.label}</span>
          {counts?.[tab.id] != null && (
            <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
              {counts[tab.id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
