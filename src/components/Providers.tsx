'use client';

import FeedbackWrapper from './FeedbackWrapper';

export default function Providers({ children }: { children: React.ReactNode }) {
  // Get user info from session storage (set during login)
  const userName = typeof window !== 'undefined'
    ? sessionStorage.getItem('hv_user') || 'Anonymous'
    : 'Anonymous';

  return (
    <FeedbackWrapper userName={userName}>
      {children}
    </FeedbackWrapper>
  );
}
