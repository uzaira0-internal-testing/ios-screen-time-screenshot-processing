import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Layout } from "@/components/layout/Layout";
import { api, GroupVerificationSummary, ScreenshotTierItem } from "@/services/apiClient";
import toast from "react-hot-toast";

type VerificationTier = "single_verified" | "agreed" | "disputed";

const TIER_CONFIG: Record<VerificationTier, { label: string; color: string; bgColor: string; description: string }> = {
  single_verified: {
    label: "Once",
    color: "text-yellow-700",
    bgColor: "bg-yellow-50 hover:bg-yellow-100",
    description: "Verified by 1 user",
  },
  agreed: {
    label: "Multiple",
    color: "text-green-700",
    bgColor: "bg-green-50 hover:bg-green-100",
    description: "2+ users, all match",
  },
  disputed: {
    label: "Disputed",
    color: "text-red-700",
    bgColor: "bg-red-50 hover:bg-red-100",
    description: "2+ users, differences found",
  },
};

export const ConsensusPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [groups, setGroups] = useState<GroupVerificationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<VerificationTier | null>(null);
  const [tierScreenshots, setTierScreenshots] = useState<ScreenshotTierItem[]>([]);
  const [loadingScreenshots, setLoadingScreenshots] = useState(false);

  // Load groups on mount
  useEffect(() => {
    loadGroups();
  }, []);

  // Handle URL params for deep linking
  useEffect(() => {
    const groupId = searchParams.get("group");
    const tier = searchParams.get("tier") as VerificationTier | null;
    if (groupId && tier && TIER_CONFIG[tier]) {
      setSelectedGroup(groupId);
      setSelectedTier(tier);
    }
  }, [searchParams]);

  // Load tier screenshots when selection changes
  useEffect(() => {
    if (selectedGroup && selectedTier) {
      loadTierScreenshots(selectedGroup, selectedTier);
    } else {
      setTierScreenshots([]);
    }
  }, [selectedGroup, selectedTier]);

  const loadGroups = async () => {
    try {
      setLoading(true);
      const data = await api.consensus.getGroupsWithTiers();
      setGroups(data);
    } catch (error) {
      console.error("Failed to load groups:", error);
      toast.error("Failed to load verification data");
    } finally {
      setLoading(false);
    }
  };

  const loadTierScreenshots = async (groupId: string, tier: VerificationTier) => {
    try {
      setLoadingScreenshots(true);
      const data = await api.consensus.getScreenshotsByTier(groupId, tier);
      setTierScreenshots(data);
    } catch (error) {
      console.error("Failed to load screenshots:", error);
      toast.error("Failed to load screenshots");
    } finally {
      setLoadingScreenshots(false);
    }
  };

  const handleTierClick = (groupId: string, tier: VerificationTier, count: number) => {
    if (count === 0) return;

    // Update URL for deep linking
    const params = new URLSearchParams();
    params.set("group", groupId);
    params.set("tier", tier);
    navigate(`/consensus?${params.toString()}`);

    setSelectedGroup(groupId);
    setSelectedTier(tier);
  };

  const handleScreenshotClick = (screenshotId: number) => {
    navigate(`/consensus/compare/${screenshotId}`);
  };

  const handleBackToGroups = () => {
    setSelectedGroup(null);
    setSelectedTier(null);
    setTierScreenshots([]);
    navigate("/consensus");
  };

  // Calculate totals
  const totals = groups.reduce(
    (acc, g) => ({
      single: acc.single + g.single_verified,
      agreed: acc.agreed + g.agreed,
      disputed: acc.disputed + g.disputed,
      verified: acc.verified + g.total_verified,
      total: acc.total + g.total_screenshots,
    }),
    { single: 0, agreed: 0, disputed: 0, verified: 0, total: 0 }
  );

  return (
    <Layout>
      <div className="space-y-6 py-6 px-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Cross-Rater Consensus</h1>
            <p className="text-slate-600 mt-1">
              Compare verified screenshots across different annotators
            </p>
          </div>
          {selectedGroup && selectedTier && (
            <button
              onClick={handleBackToGroups}
              className="px-4 py-2 text-slate-600 hover:text-slate-800 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Groups
            </button>
          )}
        </div>

        {/* Summary Stats */}
        {!selectedGroup && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-slate-900">{totals.total}</div>
              <div className="text-sm text-slate-500">Total Screenshots</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{totals.verified}</div>
              <div className="text-sm text-slate-500">Verified</div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-yellow-700">{totals.single}</div>
              <div className="text-sm text-slate-500">Verified Once</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-700">{totals.agreed}</div>
              <div className="text-sm text-slate-500">Verified Multiple</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-700">{totals.disputed}</div>
              <div className="text-sm text-slate-500">Disputed</div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-slate-500 mt-2">Loading verification data...</p>
          </div>
        ) : selectedGroup && selectedTier ? (
          /* Screenshot List View */
          <div className="bg-white border border-slate-200 rounded-lg">
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  {groups.find(g => g.id === selectedGroup)?.name || selectedGroup}
                </h2>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${TIER_CONFIG[selectedTier].bgColor} ${TIER_CONFIG[selectedTier].color}`}>
                  {TIER_CONFIG[selectedTier].label} ({tierScreenshots.length})
                </span>
              </div>
              <p className="text-sm text-slate-500 mt-1">{TIER_CONFIG[selectedTier].description}</p>
            </div>

            {loadingScreenshots ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
              </div>
            ) : tierScreenshots.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                No screenshots in this category
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {tierScreenshots.map((screenshot) => (
                  <div
                    key={screenshot.id}
                    onClick={() => handleScreenshotClick(screenshot.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleScreenshotClick(screenshot.id); }}
                    className="p-4 hover:bg-slate-50 cursor-pointer flex items-center justify-between focus-ring"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-slate-900">
                          #{screenshot.id}
                        </span>
                        {screenshot.participant_id && (
                          <span className="text-sm text-purple-600">
                            {screenshot.participant_id}
                          </span>
                        )}
                        {screenshot.screenshot_date && (
                          <span className="text-sm text-slate-500">
                            {new Date(screenshot.screenshot_date).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {screenshot.extracted_title && (
                        <p className="text-sm text-slate-500 mt-1 truncate max-w-md">
                          {screenshot.extracted_title}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-slate-500">
                        {screenshot.verifier_count} verifier{screenshot.verifier_count !== 1 ? "s" : ""}
                      </span>
                      {screenshot.has_differences && (
                        <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full">
                          Has Differences
                        </span>
                      )}
                      <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : groups.length === 0 ? (
          /* Empty State */
          <div className="text-center py-12 bg-white border border-slate-200 rounded-lg">
            <div className="text-4xl mb-4">-</div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Verified Screenshots</h3>
            <p className="text-slate-600 max-w-md mx-auto">
              Screenshots will appear here once they have been verified by at least one annotator.
              Go to the Annotate tab to start verifying screenshots.
            </p>
          </div>
        ) : (
          /* Group Cards with Verification Tiers */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((group) => (
              <div
                key={group.id}
                className="bg-white border border-slate-200 rounded-lg p-5 hover:shadow-md transition-all"
              >
                {/* Group Header */}
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-slate-900 truncate">
                      {group.name}
                    </h3>
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        group.image_type === "battery"
                          ? "bg-green-100 text-green-700"
                          : "bg-purple-100 text-purple-700"
                      }`}
                    >
                      {group.image_type === "battery" ? "Battery" : "Screen Time"}
                    </span>
                  </div>
                </div>

                {/* Total Verified */}
                <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-100">
                  <span className="text-sm text-slate-600">Verified Screenshots</span>
                  <span className="text-lg font-bold text-blue-600">
                    {group.total_verified} / {group.total_screenshots}
                  </span>
                </div>

                {/* Verification Tiers */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  {(["single_verified", "agreed", "disputed"] as const).map((tier) => {
                    const config = TIER_CONFIG[tier];
                    const count = group[tier];
                    return (
                      <div
                        key={tier}
                        onClick={() => handleTierClick(group.id, tier, count)}
                        role="button"
                        tabIndex={count > 0 ? 0 : -1}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleTierClick(group.id, tier, count); }}
                        className={`rounded p-2 transition-colors focus-ring ${
                          count > 0 ? `cursor-pointer ${config.bgColor}` : "bg-slate-50 opacity-50"
                        }`}
                      >
                        <div className={`text-lg font-bold ${count > 0 ? config.color : "text-slate-400"}`}>
                          {count}
                        </div>
                        <div className="text-xs text-slate-500">{config.label}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Progress indicator */}
                {group.total_verified > 0 && (
                  <div className="mt-3">
                    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                      <div className="h-2 flex">
                        <div
                          className="bg-yellow-400 transition-all"
                          style={{ width: `${(group.single_verified / group.total_verified) * 100}%` }}
                        ></div>
                        <div
                          className="bg-green-500 transition-all"
                          style={{ width: `${(group.agreed / group.total_verified) * 100}%` }}
                        ></div>
                        <div
                          className="bg-red-500 transition-all"
                          style={{ width: `${(group.disputed / group.total_verified) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};
