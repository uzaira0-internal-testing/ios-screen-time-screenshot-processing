import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { useAuth } from "@/hooks/useAuth";
import { api, GroupVerificationSummary } from "@/services/apiClient";
import type { Group } from "@/types";
import toast from "react-hot-toast";
import { config } from "@/config";

// Map group ID to verification tier data
type VerificationTiersMap = Record<string, GroupVerificationSummary>;

export const HomePage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [verificationTiers, setVerificationTiers] = useState<VerificationTiersMap>({});
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Group | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadGroups = async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const groupsData = await api.groups.list();
      setGroups(groupsData ?? []);
    } catch (error) {
      if (config.isDev) {
        console.error("Failed to load groups:", error);
      }
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  const loadVerificationTiers = async () => {
    try {
      const tiers = await api.consensus.getGroupsWithTiers();
      const tiersMap: VerificationTiersMap = {};
      tiers.forEach((t) => {
        tiersMap[t.id] = t;
      });
      setVerificationTiers(tiersMap);
    } catch (error) {
      if (config.isDev) {
        console.error("Failed to load verification tiers:", error);
      }
    }
  };

  useEffect(() => {
    loadGroups(true);
    loadVerificationTiers();

    // Poll for updates every 5 seconds
    const interval = setInterval(() => {
      loadGroups(false);
      loadVerificationTiers();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleGroupClick = (groupId: string, processingStatus?: string) => {
    if (isAuthenticated) {
      const params = new URLSearchParams();
      params.set("group", groupId);
      if (processingStatus) {
        params.set("processing_status", processingStatus);
      }
      navigate(`/annotate?${params.toString()}`);
    } else {
      navigate("/login");
    }
  };

  const handleVerificationTierClick = (groupId: string, tier: "single_verified" | "agreed" | "disputed") => {
    if (isAuthenticated) {
      navigate(`/consensus?group=${encodeURIComponent(groupId)}&tier=${tier}`);
    } else {
      navigate("/login");
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const csvUrl = api.export.getCSVUrl();
      const response = await fetch(csvUrl, {
        headers: {
          "X-Username": localStorage.getItem("username") || "",
          "X-Site-Password": localStorage.getItem("sitePassword") || "",
        },
      });

      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const filename = `annotations_export_${timestamp}.csv`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Exported as CSV");
    } catch (error) {
      if (config.isDev) {
        console.error("Export failed:", error);
      }
      toast.error("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteGroup = async (group: Group) => {
    setIsDeleting(true);
    try {
      const result = await api.admin.deleteGroup(group.id);
      toast.success(
        `Deleted "${group.name}" (${result.screenshots_deleted} screenshots, ${result.annotations_deleted} annotations)`,
      );
      setDeleteConfirm(null);
      loadGroups(false);
    } catch (error) {
      if (config.isDev) {
        console.error("Delete failed:", error);
      }
      toast.error(
        error instanceof Error ? error.message : "Failed to delete group",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-8 py-8">
        {/* Groups Section */}
        <div
          className="bg-white border border-gray-200 rounded-lg p-6"
          data-testid="groups-section"
        >
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              Study Groups
            </h2>
            <div className="flex items-center gap-3">
              {isAuthenticated && groups.length > 0 && (
                <button
                  onClick={handleExport}
                  disabled={isExporting}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                  aria-label="Export CSV"
                >
                  {isExporting ? (
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : (
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
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                  )}
                  Export CSV
                </button>
              )}
              {!isAuthenticated && (
                <Link
                  to="/login"
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
                >
                  Login to Annotate
                </Link>
              )}
            </div>
          </div>

          {loading && initialLoad ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
              <p className="text-gray-500 mt-2">Loading groups...</p>
            </div>
          ) : groups.length === 0 ? (
            <div
              className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300"
              data-testid="empty-groups-state"
            >
              <div className="text-4xl mb-4">📁</div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No Groups Yet
              </h3>
              <p className="text-gray-600 max-w-md mx-auto">
                Groups are automatically created when screenshots are uploaded
                via the API. Use the API endpoint to upload screenshots with a
                group_id.
              </p>
              <div className="mt-4 text-left max-w-lg mx-auto bg-gray-100 rounded p-4">
                <p className="text-sm font-mono text-gray-700">
                  POST /api/screenshots/api-upload
                </p>
                <pre className="text-xs text-gray-600 mt-2 overflow-x-auto">
                  {`{
  "screenshot": "<base64_image>",
  "participant_id": "P001",
  "group_id": "study-2024",
  "image_type": "screen_time"
}`}
                </pre>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-md transition-all"
                  data-testid="group-card"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">
                        {group.name}
                      </h3>
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${
                          group.image_type === "battery"
                            ? "bg-green-100 text-green-700"
                            : "bg-purple-100 text-purple-700"
                        }`}
                      >
                        {group.image_type === "battery"
                          ? "Battery"
                          : "Screen Time"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">
                        {new Date(group.created_at).toLocaleDateString()}
                      </span>
                      {isAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(group);
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete group"
                          aria-label={`Delete group ${group.name}`}
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
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Total count - clicking goes to all screenshots */}
                  <div
                    onClick={() => handleGroupClick(group.id)}
                    className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100 cursor-pointer hover:bg-gray-50 rounded px-2 -mx-2 py-1"
                    data-testid="total-screenshots"
                  >
                    <span className="text-sm text-gray-600">
                      Total Screenshots
                    </span>
                    <span className="text-lg font-bold text-gray-900">
                      {group.screenshot_count}
                    </span>
                  </div>

                  {/* Processing status grid - each is clickable */}
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div
                      onClick={() => handleGroupClick(group.id, "pending")}
                      className="bg-blue-50 rounded p-2 cursor-pointer hover:bg-blue-100 transition-colors"
                      data-testid="status-pending"
                    >
                      <div className="text-lg font-bold text-blue-600">
                        {group.processing_pending}
                      </div>
                      <div className="text-xs text-gray-500">Pending</div>
                    </div>
                    <div
                      onClick={() => handleGroupClick(group.id, "completed")}
                      className="bg-green-50 rounded p-2 cursor-pointer hover:bg-green-100 transition-colors"
                      data-testid="status-completed"
                    >
                      <div className="text-lg font-bold text-green-600">
                        {group.processing_completed}
                      </div>
                      <div className="text-xs text-gray-500">Preprocessed</div>
                    </div>
                    <div
                      onClick={() => handleGroupClick(group.id, "failed")}
                      className="bg-red-50 rounded p-2 cursor-pointer hover:bg-red-100 transition-colors"
                      data-testid="status-failed"
                    >
                      <div className="text-lg font-bold text-red-600">
                        {group.processing_failed}
                      </div>
                      <div className="text-xs text-gray-500">Failed</div>
                    </div>
                    <div
                      onClick={() => handleGroupClick(group.id, "skipped")}
                      className="bg-gray-100 rounded p-2 cursor-pointer hover:bg-gray-200 transition-colors"
                      data-testid="status-skipped"
                    >
                      <div className="text-lg font-bold text-gray-600">
                        {group.processing_skipped}
                      </div>
                      <div className="text-xs text-gray-500">Skipped</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  {group.screenshot_count > 0 && (
                    <div className="mt-3">
                      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div className="h-2 flex">
                          <div
                            className="bg-green-500 transition-all"
                            style={{
                              width: `${(group.processing_completed / group.screenshot_count) * 100}%`,
                            }}
                          ></div>
                          <div
                            className="bg-gray-400 transition-all"
                            style={{
                              width: `${(group.processing_skipped / group.screenshot_count) * 100}%`,
                            }}
                          ></div>
                          <div
                            className="bg-red-500 transition-all"
                            style={{
                              width: `${(group.processing_failed / group.screenshot_count) * 100}%`,
                            }}
                          ></div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 text-right">
                        {Math.round(
                          ((group.processing_completed +
                            group.processing_skipped) /
                            group.screenshot_count) *
                            100,
                        )}
                        % processed
                      </p>
                    </div>
                  )}

                  {/* Verification Status Section */}
                  {(() => {
                    const tier = verificationTiers[group.id];
                    if (!tier || tier.total_verified === 0) return null;
                    return (
                      <div className="mt-4 pt-3 border-t border-gray-200">
                        <div className="text-xs text-gray-500 mb-2 font-medium">Verification Status</div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleVerificationTierClick(group.id, "single_verified");
                            }}
                            className="bg-yellow-50 rounded p-2 cursor-pointer hover:bg-yellow-100 transition-colors"
                            data-testid="tier-verified-once"
                          >
                            <div className="text-lg font-bold text-yellow-600">
                              {tier.single_verified}
                            </div>
                            <div className="text-xs text-gray-500">Once</div>
                          </div>
                          <div
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleVerificationTierClick(group.id, "agreed");
                            }}
                            className="bg-green-50 rounded p-2 cursor-pointer hover:bg-green-100 transition-colors"
                            data-testid="tier-verified-multiple"
                          >
                            <div className="text-lg font-bold text-green-600">
                              {tier.agreed}
                            </div>
                            <div className="text-xs text-gray-500">Multiple</div>
                          </div>
                          <div
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleVerificationTierClick(group.id, "disputed");
                            }}
                            className="bg-red-50 rounded p-2 cursor-pointer hover:bg-red-100 transition-colors"
                            data-testid="tier-disputed"
                          >
                            <div className="text-lg font-bold text-red-600">
                              {tier.disputed}
                            </div>
                            <div className="text-xs text-gray-500">Disputed</div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Login prompt for unauthenticated users */}
        {!isAuthenticated && (
          <div className="text-center">
            <p className="text-gray-600 mb-4">
              Login to start annotating screenshots
            </p>
            <Link
              to="/login"
              className="inline-block px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white text-lg font-semibold rounded-lg transition-colors shadow-lg hover:shadow-xl"
            >
              Login
            </Link>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Delete Group
            </h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete{" "}
              <span className="font-semibold">"{deleteConfirm.name}"</span>?
            </p>
            <p className="text-sm text-red-600 mb-4">
              This will permanently delete {deleteConfirm.screenshot_count}{" "}
              screenshots and all associated annotations. This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteGroup(deleteConfirm)}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Deleting...
                  </>
                ) : (
                  "Delete Group"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};
