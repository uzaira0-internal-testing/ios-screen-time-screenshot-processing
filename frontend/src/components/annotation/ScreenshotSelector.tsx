import { useState, useEffect, useRef } from "react";
import type { Screenshot, ScreenshotListResponse } from "@/core/models";
import { PROCESSING_STATUS_LABELS, type ProcessingStatus } from "@/constants/processingStatus";

interface ScreenshotSelectorProps {
  currentScreenshot: Screenshot | null;
  screenshotList: ScreenshotListResponse | null;
  currentIndex: number;
  totalInFilter: number;
  hasNext: boolean;
  hasPrev: boolean;
  onNavigateNext: () => void;
  onNavigatePrev: () => void;
  onSelectScreenshot: (id: number) => void;
  onSearch: (search: string) => void;
  isLoading: boolean;
  currentUsername: string | null;
}

export const ScreenshotSelector = ({
  currentScreenshot,
  screenshotList,
  currentIndex,
  totalInFilter,
  hasNext,
  hasPrev,
  onNavigateNext,
  onNavigatePrev,
  onSelectScreenshot,
  onSearch,
  isLoading,
  currentUsername,
}: ScreenshotSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, onSearch]);

  const handleSelectScreenshot = (id: number) => {
    onSelectScreenshot(id);
    setIsOpen(false);
    setSearchTerm("");
  };

  const getVerificationBadge = (screenshot: Screenshot) => {
    const verifierUsernames = screenshot.verified_by_usernames || [];
    const verifierCount = verifierUsernames.length;
    const isVerifiedByMe =
      currentUsername !== null && verifierUsernames.includes(currentUsername);

    if (verifierCount === 0) {
      return null;
    }

    // Green if verified by current user, yellow if not
    const colorClasses = isVerifiedByMe
      ? "bg-green-100 text-green-700"
      : "bg-yellow-100 text-yellow-700";

    return (
      <span className={`ml-1 px-1.5 py-0.5 text-xs ${colorClasses} rounded font-medium`}>
        {verifierCount}
      </span>
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-600";
      case "failed":
        return "text-red-600";
      case "pending":
        return "text-blue-600";
      case "skipped":
        return "text-gray-500";
      default:
        return "text-gray-600";
    }
  };

  return (
    <div className="flex items-center gap-2" ref={dropdownRef} data-testid="screenshot-selector">
      {/* Previous Button */}
      <button
        onClick={onNavigatePrev}
        disabled={!hasPrev || isLoading}
        className={`p-1.5 rounded transition-colors ${
          hasPrev && !isLoading
            ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
            : "bg-gray-50 text-gray-300 cursor-not-allowed"
        }`}
        title="Previous screenshot (Shift+Left)"
        data-testid="navigate-prev"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>

      {/* Screenshot Selector Dropdown */}
      <div className="relative flex-1 min-w-0">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-2 py-1.5 text-left bg-white border border-gray-300 rounded hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 flex items-center gap-2"
        >
          {currentScreenshot ? (
            <>
              <span className="font-semibold text-gray-900 whitespace-nowrap">
                #{currentScreenshot.id}
              </span>
              <span className="text-xs text-gray-500 truncate">
                {currentScreenshot.participant_id || ""}
                {currentScreenshot.screenshot_date && ` · ${currentScreenshot.screenshot_date}`}
              </span>
              {(() => {
                const verifierUsernames =
                  currentScreenshot.verified_by_usernames || [];
                const verifierCount = verifierUsernames.length;
                if (verifierCount === 0) return null;
                const isVerifiedByMe =
                  currentUsername !== null &&
                  verifierUsernames.includes(currentUsername);
                const colorClasses = isVerifiedByMe
                  ? "bg-green-100 text-green-700"
                  : "bg-yellow-100 text-yellow-700";
                return (
                  <span className={`px-1.5 py-0.5 text-[10px] ${colorClasses} rounded font-medium whitespace-nowrap`}>
                    {verifierCount}
                  </span>
                );
              })()}
              <span className="text-xs text-gray-400 whitespace-nowrap ml-auto" data-testid="navigation-info">
                {currentIndex}/{totalInFilter}
              </span>
            </>
          ) : (
            <span className="text-gray-400 flex-1">Select...</span>
          )}
          <svg
            className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-80 overflow-hidden">
            {/* Search Input */}
            <div className="p-2 border-b border-gray-200">
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by ID or participant..."
                className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            {/* Screenshot List */}
            <div className="max-h-52 overflow-y-auto">
              {screenshotList?.items.map((screenshot: Screenshot) => {
                // Extract filename from file_path
                const filename = screenshot.file_path?.split("/").pop() || "";
                const dateStr = screenshot.screenshot_date || "";
                return (
                  <button
                    key={screenshot.id}
                    onClick={() => handleSelectScreenshot(screenshot.id)}
                    className={`w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center justify-between ${
                      currentScreenshot?.id === screenshot.id
                        ? "bg-primary-50"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium whitespace-nowrap">#{screenshot.id}</span>
                      <span className="text-xs text-gray-600 truncate">
                        {screenshot.participant_id || ""}
                        {dateStr && ` · ${dateStr}`}
                        {filename && ` · ${filename}`}
                      </span>
                      {getVerificationBadge(screenshot)}
                    </div>
                    <span
                      className={`text-xs flex-shrink-0 ml-2 ${getStatusColor(screenshot.processing_status)}`}
                    >
                      {PROCESSING_STATUS_LABELS[screenshot.processing_status as ProcessingStatus] || screenshot.processing_status}
                    </span>
                  </button>
                );
              })}
              {screenshotList?.items.length === 0 && (
                <div className="px-3 py-4 text-center text-gray-500 text-sm">
                  No screenshots found
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Next Button */}
      <button
        onClick={onNavigateNext}
        disabled={!hasNext || isLoading}
        className={`p-1.5 rounded transition-colors ${
          hasNext && !isLoading
            ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
            : "bg-gray-50 text-gray-300 cursor-not-allowed"
        }`}
        title="Next screenshot (Shift+Right)"
        data-testid="navigate-next"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>
    </div>
  );
};
