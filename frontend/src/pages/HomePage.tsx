import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { Layout } from "@/components/layout/Layout";
import { useAuth } from "@/hooks/useAuth";
import {
  useScreenshotService,
  useConsensusService,
  useFeatures,
} from "@/core/hooks/useServices";
import type { Group, ImageType } from "@/types";
import type { GroupVerificationSummary, VerificationTier } from "@/core/interfaces";
import toast from "react-hot-toast";
import { config } from "@/config";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Download, Trash2, FolderOpen } from "lucide-react";
import { parseRelativePath, isImageFile } from "@/utils/filePathParser";
import { FolderStructureHint } from "@/components/common/FolderStructureHint";
import { DuplicateScreenshotError } from "@/core/errors";

// Map group ID to verification tier data
type VerificationTiersMap = Record<string, GroupVerificationSummary>;

export const HomePage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const screenshotService = useScreenshotService();
  const consensusService = useConsensusService();
  const features = useFeatures();

  const [groups, setGroups] = useState<Group[]>([]);
  const [verificationTiers, setVerificationTiers] =
    useState<VerificationTiersMap>({});
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Group | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0 });
  const [imageType, setImageType] = useState<ImageType>("screen_time");
  const [groupName, setGroupName] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLoadFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter(isImageFile);
      if (imageFiles.length === 0) {
        toast.error("No image files found in selection");
        return;
      }

      setIsLoadingFiles(true);
      setLoadProgress({ current: 0, total: imageFiles.length });
      const results = { loaded: 0, failed: 0, duplicates: 0 };

      const BATCH_SIZE = 5;
      for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
        const batch = imageFiles.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (file) => {
            try {
              const parsed = parseRelativePath(file);
              const groupId = groupName.trim() || parsed.root_folder || undefined;

              await screenshotService.addScreenshots(file, imageType, {
                groupId,
                participantId: parsed.participant_id !== "unknown" ? parsed.participant_id : undefined,
                screenshotDate: parsed.screenshot_date || undefined,
                originalFilepath: parsed.original_filepath,
              });
              results.loaded++;
            } catch (error) {
              if (error instanceof DuplicateScreenshotError) {
                results.duplicates++;
              } else {
                results.failed++;
                console.error(`Failed to load ${file.name}:`, error);
              }
            }
          }),
        );
        setLoadProgress({ current: Math.min(i + BATCH_SIZE, imageFiles.length), total: imageFiles.length });
      }

      setIsLoadingFiles(false);
      setLoadProgress({ current: 0, total: 0 });
      const { loaded, failed, duplicates } = results;

      // Always show summary with all counts
      const parts: string[] = [];
      if (loaded > 0) parts.push(`${loaded} loaded`);
      if (duplicates > 0) parts.push(`${duplicates} duplicates skipped`);
      if (failed > 0) parts.push(`${failed} failed`);

      if (parts.length > 0) {
        const msg = parts.join(", ");
        if (failed > 0) {
          toast.error(msg);
        } else if (loaded > 0) {
          toast.success(msg);
        } else {
          toast(msg, { icon: "⏭️" });
        }
      }

      if (loaded > 0) {
        screenshotService.getGroups()
          .then((g) => setGroups(g ?? []))
          .catch((err) => console.error("Failed to refresh groups:", err));
      }
    },
    [screenshotService, imageType, groupName],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleLoadFiles(e.dataTransfer.files);
    },
    [handleLoadFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const loadGroups = async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const groupsData = await screenshotService.getGroups();
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
      const tiers = await consensusService.getGroupsWithTiers();
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

    // Poll for updates in server mode (other users may add data).
    // Skip in local mode — data only changes from user actions.
    if (!config.isLocalMode) {
      const interval = setInterval(() => {
        loadGroups(false);
        loadVerificationTiers();
      }, 5000);
      return () => clearInterval(interval);
    }
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

  const handleVerificationTierClick = (
    groupId: string,
    tier: VerificationTier,
  ) => {
    if (isAuthenticated) {
      navigate(
        `/consensus?group=${encodeURIComponent(groupId)}&tier=${tier}`,
      );
    } else {
      navigate("/login");
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const csvData = await screenshotService.exportCSV();
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const filename = `annotations_export_${timestamp}.csv`;

      const blob = new Blob([csvData], { type: "text/csv" });
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
    if (!config.isLocalMode && !(features.admin && isAdmin)) return;
    setIsDeleting(true);
    try {
      const result = await screenshotService.deleteGroup(group.id);
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
        <Card padding="lg" data-testid="groups-section">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Study Groups
            </h2>
            <div className="flex items-center gap-3">
              {isAuthenticated && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    webkitdirectory=""
                    directory=""
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) handleLoadFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="primary"
                    onClick={() => fileInputRef.current?.click()}
                    loading={isLoadingFiles}
                    icon={<FolderOpen className="h-4 w-4" />}
                  >
                    {isLoadingFiles ? "Loading..." : config.isLocalMode ? "Load Folder" : "Add Folder"}
                  </Button>
                </>
              )}
              {isAuthenticated && groups.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={handleExport}
                  loading={isExporting}
                  icon={<Download className="h-4 w-4" />}
                  aria-label="Export CSV"
                >
                  Export CSV
                </Button>
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

          {/* Progress bar during folder loading */}
          {isLoadingFiles && loadProgress.total > 0 && (
            <div className="mb-6 space-y-2">
              <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                <span>Loading screenshots...</span>
                <span>{loadProgress.current} / {loadProgress.total}</span>
              </div>
              <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-600 rounded-full transition-all duration-200"
                  style={{ width: `${(loadProgress.current / loadProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {loading && initialLoad ? (
            <div className="space-y-4">
              <Skeleton height="1.5rem" width="40%" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="border border-slate-200 dark:border-slate-700 rounded-lg p-5 space-y-3"
                  >
                    <Skeleton height="1.25rem" width="60%" />
                    <Skeleton height="0.875rem" count={3} />
                    <div className="grid grid-cols-2 gap-2">
                      <Skeleton height="3rem" />
                      <Skeleton height="3rem" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : groups.length === 0 ? (
            <div
              className={`text-center py-12 rounded-lg border-2 border-dashed transition-colors ${
                isDragOver
                  ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
                  : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50"
              }`}
              data-testid="empty-groups-state"
              onDrop={isAuthenticated ? handleDrop : undefined}
              onDragOver={isAuthenticated ? handleDragOver : undefined}
              onDragLeave={isAuthenticated ? handleDragLeave : undefined}
            >
              <FolderOpen className="h-12 w-12 text-slate-400 dark:text-slate-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">
                No Groups Yet
              </h3>
              {isAuthenticated ? (
                <div className="max-w-sm mx-auto space-y-3">
                  <p className="text-slate-600 dark:text-slate-400 text-sm">
                    Drop a folder here or use the button above.
                  </p>
                  <FolderStructureHint />
                  <div className="flex items-center gap-2 justify-center">
                    <input
                      type="text"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="Group name override (optional)"
                      className="text-sm border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 w-52"
                    />
                    <select
                      value={imageType}
                      onChange={(e) => setImageType(e.target.value as ImageType)}
                      className="text-sm border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                    >
                      <option value="screen_time">Screen Time</option>
                      <option value="battery">Battery</option>
                    </select>
                  </div>
                </div>
              ) : (
                <p className="text-slate-600 dark:text-slate-400">
                  Log in to load screenshots and start annotating.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 hover:shadow-md transition-all"
                  data-testid="group-card"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {group.name}
                      </h3>
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${
                          group.image_type === "battery"
                            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                            : "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400"
                        }`}
                      >
                        {group.image_type === "battery"
                          ? "Battery"
                          : "Screen Time"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(group.created_at).toLocaleDateString()}
                      </span>
                      {(config.isLocalMode || (features.admin && isAdmin)) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(group);
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors focus-ring"
                          aria-label={`Delete group ${group.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Total count - clicking goes to all screenshots */}
                  <div
                    onClick={() => handleGroupClick(group.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        handleGroupClick(group.id);
                    }}
                    className="flex justify-between items-center mb-3 pb-2 border-b border-slate-100 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 rounded px-2 -mx-2 py-1 focus-ring"
                    data-testid="total-screenshots"
                  >
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      Total Screenshots
                    </span>
                    <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {group.screenshot_count}
                    </span>
                  </div>

                  {/* Processing status grid - each is clickable */}
                  <div className="grid grid-cols-2 gap-2 text-center">
                    {(
                      [
                        {
                          status: "pending",
                          label: "Pending",
                          bg: "bg-primary-50 dark:bg-primary-900/20",
                          hoverBg:
                            "hover:bg-primary-100 dark:hover:bg-primary-800/30",
                          text: "text-primary-600 dark:text-primary-400",
                        },
                        {
                          status: "completed",
                          label: "Preprocessed",
                          bg: "bg-green-50 dark:bg-green-900/20",
                          hoverBg:
                            "hover:bg-green-100 dark:hover:bg-green-800/30",
                          text: "text-green-600 dark:text-green-400",
                        },
                        {
                          status: "failed",
                          label: "Failed",
                          bg: "bg-red-50 dark:bg-red-900/20",
                          hoverBg:
                            "hover:bg-red-100 dark:hover:bg-red-800/30",
                          text: "text-red-600 dark:text-red-400",
                        },
                        {
                          status: "skipped",
                          label: "Skipped",
                          bg: "bg-slate-100 dark:bg-slate-900/20",
                          hoverBg:
                            "hover:bg-slate-200 dark:hover:bg-slate-800/30",
                          text: "text-slate-600 dark:text-slate-400",
                        },
                      ] as const
                    ).map(({ status, label, bg, hoverBg, text }) => (
                      <div
                        key={status}
                        onClick={() => handleGroupClick(group.id, status)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            handleGroupClick(group.id, status);
                        }}
                        className={`${bg} rounded p-2 cursor-pointer ${hoverBg} transition-colors focus-ring`}
                        data-testid={`status-${status}`}
                      >
                        <div className={`text-lg font-bold ${text}`}>
                          {
                            group[
                              `processing_${status}` as keyof Group
                            ] as number
                          }
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Progress bar */}
                  {group.screenshot_count > 0 && (
                    <div className="mt-3">
                      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                        <div className="h-2 flex">
                          <div
                            className="bg-green-500 transition-all"
                            style={{
                              width: `${(group.processing_completed / group.screenshot_count) * 100}%`,
                            }}
                          ></div>
                          <div
                            className="bg-slate-400 transition-all"
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
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-right">
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
                      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 font-medium">
                          Verification Status
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          {(
                            [
                              {
                                key: "single_verified",
                                label: "Once",
                                bg: "bg-yellow-50 dark:bg-yellow-900/20",
                                hoverBg:
                                  "hover:bg-yellow-100 dark:hover:bg-yellow-800/30",
                                text: "text-yellow-600 dark:text-yellow-400",
                              },
                              {
                                key: "agreed",
                                label: "Multiple",
                                bg: "bg-green-50 dark:bg-green-900/20",
                                hoverBg:
                                  "hover:bg-green-100 dark:hover:bg-green-800/30",
                                text: "text-green-600 dark:text-green-400",
                              },
                              {
                                key: "disputed",
                                label: "Disputed",
                                bg: "bg-red-50 dark:bg-red-900/20",
                                hoverBg:
                                  "hover:bg-red-100 dark:hover:bg-red-800/30",
                                text: "text-red-600 dark:text-red-400",
                              },
                            ] as const
                          ).map(({ key, label, bg, hoverBg, text }) => (
                            <div
                              key={key}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleVerificationTierClick(group.id, key);
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ")
                                  handleVerificationTierClick(group.id, key);
                              }}
                              className={`${bg} rounded p-2 cursor-pointer ${hoverBg} transition-colors focus-ring`}
                              data-testid={`tier-${key === "single_verified" ? "verified-once" : key === "agreed" ? "verified-multiple" : "disputed"}`}
                            >
                              <div className={`text-lg font-bold ${text}`}>
                                {tier[key]}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {label}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Login prompt for unauthenticated users */}
        {!isAuthenticated && (
          <div className="text-center">
            <p className="text-slate-600 dark:text-slate-400 mb-4">
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
      {(config.isLocalMode || (features.admin && isAdmin)) && (
        <Modal
          open={!!deleteConfirm}
          onOpenChange={(open) => {
            if (!open) setDeleteConfirm(null);
          }}
          title="Delete Group"
        >
          {deleteConfirm && (
            <>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Are you sure you want to delete{" "}
                <span className="font-semibold">
                  &quot;{deleteConfirm.name}&quot;
                </span>
                ?
              </p>
              <p className="text-sm text-red-600 mb-4">
                This will permanently delete {deleteConfirm.screenshot_count}{" "}
                screenshots and all associated annotations. This action cannot
                be undone.
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  variant="ghost"
                  onClick={() => setDeleteConfirm(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => handleDeleteGroup(deleteConfirm)}
                  loading={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete Group"}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </Layout>
  );
};
