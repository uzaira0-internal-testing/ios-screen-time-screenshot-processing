import React from "react";
import { Link } from "react-router-dom";
import type { Group } from "@/core/models";

interface GroupCardProps {
  group: Group;
}

export const GroupCard: React.FC<GroupCardProps> = ({ group }) => {
  const processedPercent =
    group.screenshot_count > 0
      ? Math.round(
          ((group.processing_completed + group.processing_skipped) /
            group.screenshot_count) *
            100,
        )
      : 0;

  return (
    <Link
      to={`/annotate?group=${encodeURIComponent(group.id)}`}
      className="block bg-white border border-gray-200 rounded-lg p-6 hover:border-blue-300 hover:shadow-md transition-all"
    >
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold text-gray-900 truncate">
          {group.name}
        </h3>
        <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
          {new Date(group.created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Total count */}
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100">
        <span className="text-sm text-gray-600">Total Screenshots</span>
        <span className="text-lg font-bold text-gray-900">
          {group.screenshot_count}
        </span>
      </div>

      {/* Processing status grid */}
      <div className="grid grid-cols-2 gap-2 text-center mb-3">
        <div className="bg-blue-50 rounded p-2">
          <div className="text-lg font-bold text-blue-600">
            {group.processing_pending}
          </div>
          <div className="text-xs text-gray-500">Pending</div>
        </div>
        <div className="bg-green-50 rounded p-2">
          <div className="text-lg font-bold text-green-600">
            {group.processing_completed}
          </div>
          <div className="text-xs text-gray-500">Preprocessed</div>
        </div>
        <div className="bg-red-50 rounded p-2">
          <div className="text-lg font-bold text-red-600">
            {group.processing_failed}
          </div>
          <div className="text-xs text-gray-500">Failed</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-lg font-bold text-gray-600">
            {group.processing_skipped}
          </div>
          <div className="text-xs text-gray-500">Skipped</div>
        </div>
      </div>

      {/* Progress bar */}
      {group.screenshot_count > 0 && (
        <div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div className="h-2 flex">
              <div
                className="bg-green-500 transition-all"
                style={{
                  width: `${(group.processing_completed / group.screenshot_count) * 100}%`,
                }}
              />
              <div
                className="bg-gray-400 transition-all"
                style={{
                  width: `${(group.processing_skipped / group.screenshot_count) * 100}%`,
                }}
              />
              <div
                className="bg-red-500 transition-all"
                style={{
                  width: `${(group.processing_failed / group.screenshot_count) * 100}%`,
                }}
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1 text-right">
            {processedPercent}% processed
          </p>
        </div>
      )}
    </Link>
  );
};
