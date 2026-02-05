'use client';

import { useFeedback } from 'react-visual-feedback';
import { MessageSquarePlus } from 'lucide-react';

export default function FeedbackButton() {
  const { isActive, setIsActive } = useFeedback();

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <button
        onClick={() => setIsActive(!isActive)}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg transition-colors cursor-pointer ${
          isActive
            ? 'bg-amber-500 text-white hover:bg-amber-600'
            : 'bg-slate-800 text-white hover:bg-slate-900'
        }`}
      >
        <MessageSquarePlus size={18} />
        <span className="text-sm font-medium">
          {isActive ? 'Cancel' : 'Feedback'}
        </span>
      </button>
    </div>
  );
}
