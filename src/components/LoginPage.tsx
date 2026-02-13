'use client';

import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  // Check for error in URL params
  const urlError =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('error')
      : null;

  const displayError =
    urlError === 'unauthorized_domain'
      ? 'Access restricted to @hyperverge.co accounts only.'
      : urlError === 'auth_callback_error'
        ? 'Authentication failed. Please try again.'
        : urlError === 'oauth_failed'
          ? 'Could not start Google sign-in. Please try again.'
          : '';

  const handleGoogleSignIn = () => {
    setLoading(true);
    // Redirect to server-side login route — no keys in the browser
    window.location.href = '/api/auth/login';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 bg-amber-500/10 rounded-xl sm:rounded-2xl mb-3 sm:mb-4">
            <span className="text-2xl sm:text-3xl font-bold text-amber-500">HV</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-white">HyperVerge Dashboard</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Sign in with your HyperVerge account</p>
        </div>

        {/* Login Card */}
        <div className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-xl sm:rounded-2xl p-5 sm:p-8 shadow-2xl">
          <div className="space-y-4 sm:space-y-5">
            {/* Error Message */}
            {displayError && (
              <div className="flex items-center gap-2 text-red-400 text-xs sm:text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 sm:p-3">
                <AlertCircle size={14} className="sm:w-4 sm:h-4 shrink-0" />
                <span>{displayError}</span>
              </div>
            )}

            {/* Google Sign-In Button */}
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-2.5 sm:py-3 bg-white hover:bg-slate-100 disabled:bg-white/50 text-slate-800 font-semibold rounded-lg transition-all flex items-center justify-center gap-3 cursor-pointer text-sm sm:text-base"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Redirecting...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Sign in with Google
                </>
              )}
            </button>

            <p className="text-center text-slate-500 text-xs">
              Only @hyperverge.co accounts are allowed
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-6">
          Protected by HyperVerge Security
        </p>
      </div>
    </div>
  );
}
