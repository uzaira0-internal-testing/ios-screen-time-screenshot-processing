import {
  PROCESSING_STATUSES,
  PROCESSING_STATUS_LABELS,
  type ProcessingStatus,
} from "@/constants/processingStatus";

interface ProcessingStatusFilterProps {
  value: ProcessingStatus | "all";
  onChange: (value: ProcessingStatus | "all") => void;
}

const filterOptions: { value: ProcessingStatus | "all"; label: string }[] = [
  { value: "all", label: "All Statuses" },
  ...PROCESSING_STATUSES.map((status) => ({
    value: status,
    label: PROCESSING_STATUS_LABELS[status],
  })),
];

export const ProcessingStatusFilter = ({
  value,
  onChange,
}: ProcessingStatusFilterProps) => {
  return (
    <div className="flex gap-1 flex-wrap">
      {filterOptions.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            value === option.value
              ? "bg-primary-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};
