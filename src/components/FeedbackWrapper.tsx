'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect } from 'react';

// Dynamic import to prevent SSR issues
const FeedbackProvider = dynamic(
  () => import('react-visual-feedback').then((mod) => mod.FeedbackProvider),
  { ssr: false, loading: () => null }
);

const FeedbackButtonDynamic = dynamic(
  () => import('./FeedbackButton'),
  { ssr: false, loading: () => null }
);

interface ProductFeedback {
  id?: string;
  feedback: string;
  type?: string;
  status?: string;
  user_name?: string;
  user_email?: string | null;
  url?: string;
  user_agent?: string;
  viewport_width?: number;
  viewport_height?: number;
  screenshot?: string;
  video_url?: string;
  event_logs?: any[];
  element_info?: any;
  created_at?: string;
}

interface FeedbackWrapperProps {
  children: React.ReactNode;
  userName?: string;
  userEmail?: string;
}

export default function FeedbackWrapper({
  children,
  userName = 'Anonymous',
  userEmail
}: FeedbackWrapperProps) {
  const [feedbackData, setFeedbackData] = useState<ProductFeedback[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load existing feedback on mount
  useEffect(() => {
    loadFeedback();
  }, []);

  const loadFeedback = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/feedback');
      const json = await res.json();
      setFeedbackData(json.data || []);
    } catch (error) {
      console.error('Failed to load feedback:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedbackSubmit = useCallback(async (data: any) => {
    console.log('Feedback received:', data);

    try {
      let videoUrl: string | null = null;

      // Upload video if present (comes as base64 data URL)
      if (data.video) {
        try {
          console.log('Uploading video...');

          // Convert base64 data URL to Blob
          const response = await fetch(data.video);
          const blob = await response.blob();

          // Create FormData for upload
          const formData = new FormData();
          formData.append('file', blob, `recording-${Date.now()}.webm`);
          formData.append('type', 'video');

          const uploadRes = await fetch('/api/feedback/upload', {
            method: 'POST',
            body: formData,
          });

          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            videoUrl = uploadData.url;
            console.log('Video uploaded:', videoUrl);
          } else {
            const err = await uploadRes.json();
            console.warn('Video upload failed:', err.error);
          }
        } catch (videoError) {
          console.warn('Failed to upload video:', videoError);
        }
      }

      const payload = {
        feedback: data.feedback,
        type: data.type || 'bug',
        user_name: data.userName || userName,
        user_email: data.userEmail || userEmail,
        url: data.url,
        user_agent: data.userAgent,
        viewport_width: data.viewport?.width,
        viewport_height: data.viewport?.height,
        screenshot: data.screenshot,
        video_url: videoUrl,
        event_logs: data.eventLogs,
        element_info: data.elementInfo,
      };

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit feedback');
      }

      console.log('Feedback saved successfully');
      await loadFeedback();
    } catch (error) {
      console.error('Error saving feedback:', error);
      throw error;
    }
  }, [userName, userEmail]);

  const handleStatusChange = useCallback(async ({
    id,
    status,
    comment
  }: {
    id: string;
    status: string;
    comment?: string;
  }) => {
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, comment, changed_by: userName }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update status');
      }

      console.log('Status updated successfully');
      await loadFeedback();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  }, [userName]);

  // Transform data for the dashboard
  const dashboardData = feedbackData.map(item => ({
    ...item,
    timestamp: item.created_at,
    viewport: item.viewport_width && item.viewport_height
      ? { width: item.viewport_width, height: item.viewport_height }
      : undefined,
    video: item.video_url,
  }));

  return (
    <FeedbackProvider
      onSubmit={handleFeedbackSubmit}
      onStatusChange={handleStatusChange}
      dashboard={true}
      dashboardData={dashboardData as any}
      isDeveloper={true}
      userName={userName}
      userEmail={userEmail}
      mode="light"
      defaultOpen={false}
    >
      {children}
      <FeedbackButtonDynamic />
    </FeedbackProvider>
  );
}
