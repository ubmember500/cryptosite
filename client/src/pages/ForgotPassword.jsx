import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services/authService';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { Mail, AlertCircle } from 'lucide-react';
import { ROUTES } from '../utils/constants';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resetLink, setResetLink] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setResetLink(null);
    setLoading(true);

    try {
      const data = await authService.forgotPassword(email);
      setSuccess(true);
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

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
        <div className="w-full max-w-md">
          <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-8 text-center">
            <h1 className="text-3xl font-bold text-gray-200 mb-2">Check your email</h1>
            <p className="text-gray-400 mb-6">
              {resetLink
                ? 'Use the link below to reset your password (dev mode).'
                : 'If an account exists with this email, you will receive a password reset link.'}
            </p>
            {resetLink && (
              <a
                href={resetLink}
                className="block mb-6 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium break-all"
              >
                Open reset link
              </a>
            )}
            <Link
              to={ROUTES.LOGIN}
              className="text-blue-400 hover:text-blue-300 font-medium"
            >
              Back to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-md">
        <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-200 mb-2">Restore account</h1>
            <p className="text-gray-400">Enter your email address</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center">
              <AlertCircle size={16} className="mr-2" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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
              className="w-full"
              loading={loading}
            >
              Send reset link
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link to={ROUTES.LOGIN} className="text-sm text-blue-400 hover:text-blue-300">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
