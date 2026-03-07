import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services/authService';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { Mail, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { ROUTES } from '../utils/constants';
import usePageTitle from '../hooks/usePageTitle';

const RESEND_COOLDOWN_SECONDS = 60;

const ForgotPassword = () => {
  usePageTitle('Forgot Password');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resetLink, setResetLink] = useState(null);

  // Resend cooldown
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendError, setResendError] = useState('');
  const cooldownRef = useRef(null);

  // Start cooldown timer
  const startCooldown = useCallback(() => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setResetLink(null);
    setLoading(true);

    try {
      const data = await authService.forgotPassword(email);
      setSuccess(true);
      startCooldown();
      if (data?.resetLink) setResetLink(data.resetLink);
    } catch (err) {
      if (!err.response) {
        setError('Cannot connect to server. Please ensure the backend is running (e.g. npm run dev in project root).');
        return;
      }
      const errorData = err.response?.data;
      if (errorData?.details && Array.isArray(errorData.details) && errorData.details.length > 0) {
        setError(errorData.details[0].message || errorData.error || 'Something went wrong. Please try again.');
      } else {
        setError(errorData?.error || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResendError('');
    setResendSuccess(false);
    setResending(true);

    try {
      const data = await authService.forgotPassword(email);
      setResendSuccess(true);
      startCooldown();
      if (data?.resetLink) setResetLink(data.resetLink);
      // Auto-hide success message after 5 seconds
      setTimeout(() => setResendSuccess(false), 5000);
    } catch (err) {
      const errorData = err.response?.data;
      setResendError(errorData?.error || 'Failed to resend email. Please try again.');
      // Auto-hide error after 5 seconds
      setTimeout(() => setResendError(''), 5000);
    } finally {
      setResending(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 relative overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-accent/[0.07] blur-[100px]" />
        <div className="w-full max-w-md relative z-10">
          <div className="bg-surface/80 border border-border/40 rounded-2xl shadow-2xl shadow-black/20 p-8 text-center backdrop-blur-xl">
            <div className="w-14 h-14 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-green-500/20">
              <Mail size={28} className="text-green-400" />
            </div>
            <h1 className="text-3xl font-bold text-textPrimary mb-2">Check your email</h1>
            <p className="text-textSecondary/80 text-sm mb-6">
              {resetLink
                ? 'Use the link below to reset your password (dev mode).'
                : 'If an account exists with this email, you will receive a password reset link.'}
            </p>
            {resetLink && (
              <a
                href={resetLink}
                className="block mb-6 px-4 py-3 bg-accent hover:brightness-110 text-white rounded-xl font-medium break-all transition-all"
              >
                Open reset link
              </a>
            )}

            {/* Resend email section */}
            <div className="mb-6 pt-4 border-t border-border/40">
              <p className="text-sm text-textSecondary/80 mb-3">
                Didn't receive the email? Check your spam folder or resend it.
              </p>

              {resendSuccess && (
                <div className="mb-3 p-2 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm flex items-center justify-center">
                  <CheckCircle size={14} className="mr-2" />
                  <span>Email sent successfully!</span>
                </div>
              )}

              {resendError && (
                <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center justify-center">
                  <AlertCircle size={14} className="mr-2" />
                  <span>{resendError}</span>
                </div>
              )}

              <button
                onClick={handleResend}
                disabled={cooldown > 0 || resending}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  cooldown > 0 || resending
                    ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300'
                }`}
              >
                <RefreshCw size={14} className={resending ? 'animate-spin' : ''} />
                {resending
                  ? 'Sending...'
                  : cooldown > 0
                    ? `Resend in ${cooldown}s`
                    : 'Resend email'}
              </button>
            </div>

            <Link
              to={ROUTES.LOGIN}
              className="text-accent hover:text-accent/80 font-medium transition-colors"
            >
              Back to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative overflow-hidden">
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-sky-500/[0.05] blur-[100px]" />
      <div className="w-full max-w-md relative z-10">
        <div className="bg-surface/80 border border-border/40 rounded-2xl shadow-2xl shadow-black/20 p-8 backdrop-blur-xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-textPrimary mb-2">Restore account</h1>
            <p className="text-textSecondary/80 text-sm">Enter your email address</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm flex items-center">
              <AlertCircle size={16} className="mr-2 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label="Email"
              type="email"
              icon={Mail}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />

            <Button
              type="submit"
              variant="primary"
              className="w-full h-11"
              loading={loading}
            >
              Send reset link
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link to={ROUTES.LOGIN} className="text-sm text-accent hover:text-accent/80 transition-colors">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
