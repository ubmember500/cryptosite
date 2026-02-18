import React, { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { authService } from '../services/authService';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import Card from '../components/common/Card';
import { Lock, AlertCircle } from 'lucide-react';
import { ROUTES } from '../utils/constants';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.newPassword !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      await authService.resetPassword(token, formData.newPassword);
      setSuccess(true);
    } catch (err) {
      // Network/connection errors (e.g. backend not running)
      if (!err.response) {
        setError('Cannot connect to server. Please ensure the backend is running (e.g. npm run dev in project root).');
        return;
      }
      // Handle validation errors with details
      const errorData = err.response?.data;
      if (errorData?.details && Array.isArray(errorData.details) && errorData.details.length > 0) {
        setError(errorData.details[0].message || errorData.error || 'Failed to reset password. The link may be invalid or expired.');
      } else {
        setError(errorData?.error || 'Failed to reset password. The link may be invalid or expired.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="text-3xl font-bold text-textPrimary mb-2">Invalid reset link</h1>
          <p className="text-textSecondary mb-6">
            This password reset link is missing or invalid. Please request a new one from the forgot password page.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              to={ROUTES.FORGOT_PASSWORD}
              className="text-accent hover:text-accent/80 font-medium"
            >
              Request new link
            </Link>
            <Link
              to={ROUTES.LOGIN}
              className="text-accent hover:text-accent/80 font-medium"
            >
              Back to login
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="text-3xl font-bold text-textPrimary mb-2">Password reset</h1>
          <p className="text-textSecondary mb-6">
            Your password has been updated. You can now sign in with your new password.
          </p>
          <Link
            to={ROUTES.LOGIN}
            className="inline-block px-6 py-2 bg-accent hover:bg-accent/80 text-white font-medium rounded-lg transition-colors"
          >
            Go to login
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-textPrimary mb-2">Set new password</h1>
          <p className="text-textSecondary">Enter your new password below</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm flex items-center">
            <AlertCircle size={16} className="mr-2" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="New password"
            type="password"
            icon={Lock}
            value={formData.newPassword}
            onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
            placeholder="••••••••"
            required
            minLength={8}
          />

          <Input
            label="Confirm new password"
            type="password"
            icon={Lock}
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            placeholder="••••••••"
            required
            minLength={8}
          />

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={loading}
          >
            Reset password
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Link to={ROUTES.LOGIN} className="text-accent hover:text-accent/80 text-sm">
            Back to login
          </Link>
        </div>
      </Card>
    </div>
  );
};

export default ResetPassword;
