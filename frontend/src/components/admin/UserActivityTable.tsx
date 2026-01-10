import { useState } from "react";
import type { components } from "@/types/api-schema";

// Use type from OpenAPI schema (Pydantic is the single source of truth)
type UserActivity = components["schemas"]["UserStatsRead"];

interface UserActivityTableProps {
  users: UserActivity[];
  loading: boolean;
  onUpdateUser: (
    userId: number,
    updates: { is_active?: boolean; role?: string },
  ) => Promise<void>;
}

export const UserActivityTable = ({
  users,
  loading,
  onUpdateUser,
}: UserActivityTableProps) => {
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);

  const handleToggleActive = async (user: UserActivity) => {
    setUpdatingUserId(user.id);
    try {
      await onUpdateUser(user.id, { is_active: !user.is_active });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleToggleRole = async (user: UserActivity) => {
    setUpdatingUserId(user.id);
    try {
      const newRole = user.role === "admin" ? "annotator" : "admin";
      await onUpdateUser(user.id, { role: newRole });
    } finally {
      setUpdatingUserId(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">User Activity</h3>
      </div>

      <div className="overflow-x-auto">
        <table
          className="min-w-full divide-y divide-gray-200"
          data-testid="user-table"
        >
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Annotations
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Avg Time
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {user.username}
                  </div>
                  <div className="text-sm text-gray-500">{user.email ?? "-"}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      user.role === "admin"
                        ? "bg-purple-100 text-purple-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {user.annotations_count}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {Math.round(user.avg_time_spent_seconds)}s
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      user.is_active
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {user.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                  <button
                    onClick={() => handleToggleActive(user)}
                    disabled={updatingUserId === user.id}
                    className="text-indigo-600 hover:text-indigo-900 disabled:opacity-50"
                  >
                    {updatingUserId === user.id
                      ? "Updating..."
                      : user.is_active
                        ? "Deactivate"
                        : "Activate"}
                  </button>
                  <button
                    onClick={() => handleToggleRole(user)}
                    disabled={updatingUserId === user.id}
                    className="text-purple-600 hover:text-purple-900 disabled:opacity-50"
                  >
                    {user.role === "admin" ? "Demote" : "Promote"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {users.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No users found</p>
        </div>
      )}
    </div>
  );
};
