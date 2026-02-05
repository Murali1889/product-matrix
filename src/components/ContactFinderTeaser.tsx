'use client';

/**
 * Contact Finder Teaser
 * 60-30-10: Slate base, neutral text, amber accents
 */

import { useState } from 'react';

export function ContactFinderTeaser() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (email.trim()) {
      const waitlist = JSON.parse(localStorage.getItem('contact_finder_waitlist') || '[]');
      waitlist.push({ email, timestamp: new Date().toISOString() });
      localStorage.setItem('contact_finder_waitlist', JSON.stringify(waitlist));
      setSubmitted(true);
    }
  };

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">@</span>
          <h3 className="font-medium text-sm text-slate-200">Contact Finder</h3>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 flex flex-col justify-center">
        {submitted ? (
          <div className="text-center">
            <div className="text-amber-400 mb-2">Added to waitlist</div>
            <p className="text-xs text-slate-500">We will notify you when ready</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500 text-center mb-3">
              Find decision-makers at any company
            </p>
            <div className="inline-block px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-400 text-center mb-4">
              Coming Soon
            </div>
            <div className="space-y-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700/50 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/30 cursor-text"
              />
              <button
                onClick={handleSubmit}
                disabled={!email.trim()}
                className="w-full px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 disabled:bg-slate-800 disabled:border-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed rounded text-xs font-medium cursor-pointer transition-colors"
              >
                Notify Me
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
