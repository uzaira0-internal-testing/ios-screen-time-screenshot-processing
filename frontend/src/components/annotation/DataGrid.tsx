import { useState, useEffect } from 'react';
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
  const [localData, setLocalData] = useState<HourlyData>(data);

  useEffect(() => {
    setLocalData(data);
  }, [data]);

  const handleChange = (hour: number, value: string) => {
    const numValue = parseInt(value) || 0;
    if (numValue < 0 || numValue > 60) return;

    setLocalData({ ...localData, [hour]: numValue });
    onChange(hour, numValue);
  };

  const getDisagreementLevel = (hour: number): 'none' | 'minor' | 'major' | null => {
    if (!consensus) return null;

    const disagreement = consensus.disagreements.find((d) => d.hour === hour);
    if (!disagreement) return 'none';

    const currentValue = localData[hour] || 0;
    const consensusValue = disagreement.consensus_value;
    const diff = Math.abs(currentValue - consensusValue);

    if (diff === 0) return 'none';
    if (diff <= 5) return 'minor';
    return 'major';
  };

  const getCellClassName = (hour: number) => {
    const level = getDisagreementLevel(hour);

    return clsx(
      'w-full px-3 py-2 text-center border border-slate-300 rounded-md focus:outline-none focus:ring-2',
      {
        'bg-green-50 border-green-300 focus:ring-green-500': level === 'none',
        'bg-yellow-50 border-yellow-300 focus:ring-yellow-500': level === 'minor',
        'bg-red-50 border-red-300 focus:ring-red-500': level === 'major',
        'bg-white focus:ring-primary-500': level === null,
        'bg-slate-100 cursor-not-allowed': readOnly,
      }
    );
  };

  const total = calculateTotalMinutes(localData);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} className="space-y-1">
            <label htmlFor={`hour-${i}`} className="block text-xs font-medium text-slate-700">
              Hour {i}
            </label>
            <input
              id={`hour-${i}`}
              type="number"
              min="0"
              max="60"
              value={localData[i] || 0}
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

      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
        <span className="text-sm font-medium text-slate-700">Total Minutes:</span>
        <span className="text-2xl font-bold text-primary-600">
          {total}m ({Math.floor(total / 60)}h {total % 60}m)
        </span>
      </div>

      {consensus && (
        <div className="flex items-center space-x-4 text-xs text-slate-600">
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
