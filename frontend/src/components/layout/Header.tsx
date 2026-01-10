import { Link, useSearchParams, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { PROCESSING_STATUS_LABELS, type ProcessingStatus } from "@/constants/processingStatus";

export const Header = () => {
  const { username, isAuthenticated, isAdmin, logout } = useAuth();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  // Get current filter context from URL
  const groupId = searchParams.get("group");
  const participantId = searchParams.get("participant_id");
  const processingStatus = searchParams.get("processing_status");
  const isAnnotatePage = location.pathname === "/annotate";

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="px-4">
        <div className="flex justify-between items-center h-16">
          {/* Left: Logo and Nav */}
          <div className="flex items-center space-x-8">
            <Link to="/" className="text-xl font-bold text-primary-600">
              iOS Screen Time
            </Link>

            {/* Navigation */}
            {isAuthenticated && (
              <nav className="hidden md:flex space-x-4">
                <Link
                  to="/"
                  className="text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Groups
                </Link>
                <Link
                  to="/consensus"
                  className="text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Consensus
                </Link>
                {isAdmin && (
                  <Link
                    to="/admin"
                    className="text-gray-700 hover:text-primary-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    Admin
                  </Link>
                )}
              </nav>
            )}
          </div>

          {/* Center: Queue Context Indicator */}
          {isAnnotatePage && (groupId || participantId || processingStatus) && (
            <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-md text-sm">
              <span className="text-gray-500">Queue:</span>
              {groupId && (
                <span className="font-medium text-gray-700">{groupId}</span>
              )}
              {groupId && (participantId || processingStatus) && (
                <span className="text-gray-400">/</span>
              )}
              {participantId && (
                <span className="font-medium text-purple-600">
                  {participantId}
                </span>
              )}
              {participantId && processingStatus && (
                <span className="text-gray-400">/</span>
              )}
              {processingStatus && (
                <>
                  <span className="text-gray-500">Status:</span>
                  <span
                    className={"font-medium " + (
                      processingStatus === "completed"
                        ? "text-green-600"
                        : processingStatus === "failed"
                          ? "text-red-600"
                          : processingStatus === "pending"
                            ? "text-blue-600"
                            : "text-gray-600"
                    )}
                  >
                    {PROCESSING_STATUS_LABELS[processingStatus as ProcessingStatus] || processingStatus}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Right: User info */}
          <div className="flex items-center space-x-4">
            {isAuthenticated && username ? (
              <>
                <span className="text-sm text-gray-700">
                  Welcome, <span className="font-medium">{username}</span>
                </span>
                <button
                  onClick={logout}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
