import { useCallback } from "react";
import { usePreprocessingStore } from "@/hooks/usePreprocessingWithDI";
import type { UploadFileItem } from "@/store/preprocessingStore";
import { UploadDropZone } from "./UploadDropZone";
import { UploadTagTable } from "./UploadTagTable";
import { UploadProgressBar } from "./UploadProgressBar";

export const BrowserUpload = () => {
  const uploadFiles = usePreprocessingStore((s) => s.uploadFiles);
  const setUploadFiles = usePreprocessingStore((s) => s.setUploadFiles);
  const uploadGroupId = usePreprocessingStore((s) => s.uploadGroupId);
  const setUploadGroupId = usePreprocessingStore((s) => s.setUploadGroupId);
  const uploadImageType = usePreprocessingStore((s) => s.uploadImageType);
  const setUploadImageType = usePreprocessingStore((s) => s.setUploadImageType);
  const isUploading = usePreprocessingStore((s) => s.isUploading);
  const uploadProgress = usePreprocessingStore((s) => s.uploadProgress);
  const uploadErrors = usePreprocessingStore((s) => s.uploadErrors);
  const startBrowserUpload = usePreprocessingStore((s) => s.startBrowserUpload);

  const canUpload = uploadFiles.length > 0 && uploadGroupId.trim().length > 0 && !isUploading;

  // Append new files to existing list (dedup by original_filepath)
  const appendFiles = useCallback(
    (newFiles: UploadFileItem[]) => {
      const existingPaths = new Set(uploadFiles.map((f) => f.original_filepath));
      const unique = newFiles.filter((f) => !existingPaths.has(f.original_filepath));
      setUploadFiles([...uploadFiles, ...unique]);
    },
    [uploadFiles, setUploadFiles],
  );

  // Step 1: Drop zone (no files yet)
  if (uploadFiles.length === 0 && !isUploading) {
    return (
      <div className="space-y-4">
        <UploadDropZone onFilesSelected={setUploadFiles} />
      </div>
    );
  }

  // Step 3: Uploading
  if (isUploading && uploadProgress) {
    return (
      <div className="space-y-4">
        <UploadProgressBar
          completed={uploadProgress.completed}
          total={uploadProgress.total}
          errors={uploadErrors}
        />
      </div>
    );
  }

  // Upload done with errors
  if (!isUploading && uploadErrors.length > 0 && uploadFiles.length === 0) {
    return (
      <div className="space-y-4">
        <UploadProgressBar
          completed={uploadProgress?.completed ?? 0}
          total={uploadProgress?.total ?? 0}
          errors={uploadErrors}
        />
        <button
          onClick={() => setUploadFiles([])}
          className="px-4 py-2 text-sm bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 dark:text-slate-200"
        >
          Upload More
        </button>
      </div>
    );
  }

  // Step 2: Tag table with ability to add more folders
  return (
    <div className="space-y-4">
      <UploadTagTable
        files={uploadFiles}
        groupId={uploadGroupId}
        imageType={uploadImageType}
        onFilesChange={setUploadFiles}
        onGroupIdChange={setUploadGroupId}
        onImageTypeChange={setUploadImageType}
      />
      {/* Compact drop zone for adding more folders */}
      <UploadDropZone onFilesSelected={appendFiles} compact />
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            if (uploadFiles.length > 0 && window.confirm(`Clear all ${uploadFiles.length} selected files?`)) {
              setUploadFiles([]);
            }
          }}
          className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 focus-ring"
        >
          Clear
        </button>
        <button
          onClick={startBrowserUpload}
          disabled={!canUpload}
          className="px-6 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
        >
          Upload {uploadFiles.length} File{uploadFiles.length !== 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
};
