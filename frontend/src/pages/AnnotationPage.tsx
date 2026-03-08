import { useSearchParams, useParams } from "react-router";
import { Layout } from "@/components/layout/Layout";
import { AnnotationWorkspace } from "@/components/annotation/AnnotationWorkspace";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useRequireAuth } from "@/hooks/useAuth";

export const AnnotationPage = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const groupId = searchParams.get("group") || undefined;
  const processingStatus = searchParams.get("processing_status") || undefined;

  // Parse screenshot ID from URL params
  const initialScreenshotId = id ? parseInt(id, 10) : undefined;

  // Auth check
  useRequireAuth();

  return (
    <Layout noScroll>
      <ErrorBoundary>
        <AnnotationWorkspace
          groupId={groupId}
          processingStatus={processingStatus}
          initialScreenshotId={initialScreenshotId}
        />
      </ErrorBoundary>
    </Layout>
  );
};
