import { useState, useEffect, useCallback } from "react";
import { api } from "@/services/apiClient";
import type { Screenshot, Group } from "@/types";
import {
  PreprocessingTabBar,
  type PreprocessingTab,
} from "@/components/preprocessing/PreprocessingTabBar";
import { PreprocessingOptions } from "@/components/preprocessing/PreprocessingOptions";
import { DeviceDetectionTab } from "@/components/preprocessing/DeviceDetectionTab";
import { CroppingTab } from "@/components/preprocessing/CroppingTab";
import { PHIDetectionTab } from "@/components/preprocessing/PHIDetectionTab";
import { PHIRedactionTab } from "@/components/preprocessing/PHIRedactionTab";
import toast from "react-hot-toast";
import { config } from "@/config";

const IMAGE_URL_PREFIX = config.apiBaseUrl + "/screenshots";

export const PreprocessingPage = () => {
  // State
  const [activeTab, setActiveTab] = useState<PreprocessingTab>("device_detection");
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());

  // Preprocessing options
  const [preset, setPreset] = useState("hipaa_compliant");
  const [method, setMethod] = useState("redbox");
  const [phiEnabled, setPhiEnabled] = useState(true);
  const [runOcrAfter, setRunOcrAfter] = useState(false);

  // Load groups on mount
  useEffect(() => {
    const loadGroups = async () => {
      try {
        const data = await api.groups.list();
        if (data && data.length > 0) {
          setGroups(data);
          setSelectedGroupId((prev) => prev || data[0]!.id);
        }
      } catch (err) {
        console.error("Failed to load groups:", err);
      }
    };
    loadGroups();
  }, []);

  // Load screenshots when group changes
  const loadScreenshots = useCallback(async () => {
    if (!selectedGroupId) {
      setScreenshots([]);
      return;
    }

    setIsLoading(true);
    try {
      const data = await api.screenshots.list({
        group_id: selectedGroupId,
        page_size: 500,
        sort_by: "id",
        sort_order: "asc",
      });
      if (data) {
        setScreenshots(data.items);
      }
    } catch (err) {
      console.error("Failed to load screenshots:", err);
      toast.error("Failed to load screenshots");
    } finally {
      setIsLoading(false);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    loadScreenshots();
  }, [loadScreenshots]);

  // Run preprocessing on a single screenshot
  const handleRunOne = async (screenshotId: number) => {
    setRunningIds((prev) => new Set(prev).add(screenshotId));
    try {
      await api.preprocessing.preprocess(screenshotId, {
        phi_pipeline_preset: preset,
        phi_redaction_method: method,
        phi_detection_enabled: phiEnabled,
        run_ocr_after: runOcrAfter,
      });
      toast.success(`Preprocessing queued for screenshot ${screenshotId}`);
      // Refresh after a short delay to allow task to start
      setTimeout(() => loadScreenshots(), 2000);
    } catch (err) {
      console.error("Failed to queue preprocessing:", err);
      toast.error("Failed to queue preprocessing");
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(screenshotId);
        return next;
      });
    }
  };

  // Run preprocessing on all screenshots in group
  const handleRunAll = async () => {
    if (!selectedGroupId) return;

    setIsRunningAll(true);
    try {
      const result = await api.preprocessing.preprocessBatch({
        group_id: selectedGroupId,
        phi_pipeline_preset: preset,
        phi_redaction_method: method,
        phi_detection_enabled: phiEnabled,
        run_ocr_after: runOcrAfter,
      });
      if (result) {
        toast.success(result.message);
      }
      // Refresh after a delay
      setTimeout(() => loadScreenshots(), 3000);
    } catch (err) {
      console.error("Failed to queue batch preprocessing:", err);
      toast.error("Failed to queue batch preprocessing");
    } finally {
      setIsRunningAll(false);
    }
  };

  // Compute tab counts based on preprocessing data
  const tabCounts: Partial<Record<PreprocessingTab, number>> = {};
  let withDevice = 0;
  let withCrop = 0;
  let withPhi = 0;
  let withRedact = 0;
  for (const s of screenshots) {
    const pp = (s.processing_metadata as any)?.preprocessing;
    if (pp?.device_detection) withDevice++;
    if (pp?.cropping) withCrop++;
    if (pp?.phi_detection) withPhi++;
    if (pp?.phi_redaction) withRedact++;
  }
  tabCounts.device_detection = withDevice;
  tabCounts.cropping = withCrop;
  tabCounts.phi_detection = withPhi;
  tabCounts.phi_redaction = withRedact;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Preprocessing Pipeline
        </h1>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Group:</label>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.screenshot_count})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab Bar */}
      <PreprocessingTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        counts={tabCounts}
      />

      {/* Options Bar */}
      <div className="mt-4">
        <PreprocessingOptions
          preset={preset}
          onPresetChange={setPreset}
          method={method}
          onMethodChange={setMethod}
          phiEnabled={phiEnabled}
          onPhiEnabledChange={setPhiEnabled}
          runOcrAfter={runOcrAfter}
          onRunOcrAfterChange={setRunOcrAfter}
          onRunAll={handleRunAll}
          isRunningAll={isRunningAll}
          disabled={!selectedGroupId || screenshots.length === 0}
        />
      </div>

      {/* Tab Content */}
      <div className="mt-4 bg-white rounded-lg border border-gray-200">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="inline-block w-6 h-6 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin" />
            <span className="ml-2 text-gray-500">Loading screenshots...</span>
          </div>
        ) : (
          <>
            {activeTab === "device_detection" && (
              <DeviceDetectionTab
                screenshots={screenshots}
                imageUrlPrefix={IMAGE_URL_PREFIX}
                onRunOne={handleRunOne}
                runningIds={runningIds}
              />
            )}
            {activeTab === "cropping" && (
              <CroppingTab
                screenshots={screenshots}
                imageUrlPrefix={IMAGE_URL_PREFIX}
                onRunOne={handleRunOne}
                runningIds={runningIds}
              />
            )}
            {activeTab === "phi_detection" && (
              <PHIDetectionTab
                screenshots={screenshots}
                imageUrlPrefix={IMAGE_URL_PREFIX}
                onRunOne={handleRunOne}
                runningIds={runningIds}
              />
            )}
            {activeTab === "phi_redaction" && (
              <PHIRedactionTab
                screenshots={screenshots}
                imageUrlPrefix={IMAGE_URL_PREFIX}
                onRunOne={handleRunOne}
                runningIds={runningIds}
              />
            )}
          </>
        )}
      </div>

      {/* Footer info */}
      <div className="mt-4 text-xs text-gray-400">
        {screenshots.length} screenshot{screenshots.length !== 1 ? "s" : ""} in
        group
        {selectedGroupId && ` "${selectedGroupId}"`}
      </div>
    </div>
  );
};
