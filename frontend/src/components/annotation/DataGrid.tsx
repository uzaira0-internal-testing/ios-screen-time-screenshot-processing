import type { HourlyData, Consensus } from '@/types';
import { calculateTotalMinutes } from '@/utils/formatters';
import clsx from 'clsx';

interface DataGridProps {
  data: HourlyData;
  onChange: (hour: number, value: number) => void;
  consensus?: Consensus;
  readOnly?: boolean;
}

export const DataGrid = ({ data, onChange, consensus, readOnly = false }: DataGridProps) => {
  const handleChange = (hour: number, value: string) => {
    const numValue = parseInt(value) || 0;
    if (numValue < 0 || numValue > 60) return;
    onChange(hour, numValue);
  };

  const getDisagreementLevel = (hour: number): 'none' | 'minor' | 'major' | null => {
    if (!consensus) return null;

    const disagreement = consensus.disagreements.find((d) => d.hour === hour);
    if (!disagreement) return 'none';

    const currentValue = data[hour] || 0;
    const consensusValue = disagreement.consensus_value;
    const diff = Math.abs(currentValue - consensusValue);

    if (diff === 0) return 'none';
    if (diff <= 5) return 'minor';
    return 'major';
  };

  const getCellClassName = (hour: number) => {
    const level = getDisagreementLevel(hour);

    return clsx(
      'w-full px-3 py-2 text-center border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 dark:text-slate-200',
      {
        'bg-green-50 border-green-300 focus:ring-green-500 dark:bg-green-900/20 dark:border-green-600': level === 'none',
        'bg-yellow-50 border-yellow-300 focus:ring-yellow-500 dark:bg-yellow-900/20 dark:border-yellow-600': level === 'minor',
        'bg-red-50 border-red-300 focus:ring-red-500 dark:bg-red-900/20 dark:border-red-600': level === 'major',
        'bg-white focus:ring-primary-500 dark:bg-slate-800': level === null,
        'bg-slate-100 cursor-not-allowed dark:bg-slate-700': readOnly,
      }
    );
  };

  const total = calculateTotalMinutes(data);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} className="space-y-1">
            <label htmlFor={`hour-${i}`} className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Hour {i}
            </label>
            <input
              id={`hour-${i}`}
              type="number"
              min="0"
              max="60"
              value={data[i] || 0}
              onChange={(e) => handleChange(i, e.target.value)}
              disabled={readOnly}
              className={getCellClassName(i)}
              aria-label={`Minutes for hour ${i}`}
            />
            {consensus && getDisagreementLevel(i) !== 'none' && getDisagreementLevel(i) !== null && (
              <div className="text-xs text-slate-500">
                Consensus: {consensus.disagreements.find((d) => d.hour === i)?.consensus_value || 0}m
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Total Minutes:</span>
        <span className="text-2xl font-bold text-primary-600">
          {total}m ({Math.floor(total / 60)}h {total % 60}m)
        </span>
      </div>

      {consensus && (
        <div className="flex items-center space-x-4 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-green-100 border border-green-300 rounded"></div>
            <span>Consensus</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-yellow-100 border border-yellow-300 rounded"></div>
            <span>Minor disagreement (1-5m)</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-red-100 border border-red-300 rounded"></div>
            <span>Major disagreement (&gt;5m)</span>
          </div>
        </div>
      )}
    </div>
  );
};
