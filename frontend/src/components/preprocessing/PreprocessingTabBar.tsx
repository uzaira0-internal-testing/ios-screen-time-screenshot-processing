export type PreprocessingTab =
  | "device_detection"
  | "cropping"
  | "phi_detection"
  | "phi_redaction";

interface TabDef {
  id: PreprocessingTab;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { id: "device_detection", label: "Device Detection", icon: "📱" },
  { id: "cropping", label: "Cropping", icon: "✂️" },
  { id: "phi_detection", label: "PHI Detection", icon: "🔍" },
  { id: "phi_redaction", label: "PHI Redaction", icon: "🔒" },
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
    <div className="flex border-b border-slate-200">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === tab.id
              ? "border-primary-600 text-primary-600"
              : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
          }`}
        >
          <span>{tab.icon}</span>
          <span>{tab.label}</span>
          {counts?.[tab.id] != null && (
            <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600">
              {counts[tab.id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
