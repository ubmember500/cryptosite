import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { ROUTES } from '../utils/constants';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { Mail, Lock, User, TrendingUp } from 'lucide-react';

const Register = () => {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((state) => state.register);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      await register(formData.username, formData.email, formData.password);
      navigate(ROUTES.ACCOUNT);
    } catch (err) {
      // Network/connection errors (e.g. backend not running)
      if (!err.response) {
        setError('Cannot connect to server. Please ensure the backend is running (e.g. npm run dev in project root).');
        return;
      }
      // Handle validation errors with details
      const errorData = err.response?.data;
      if (errorData?.details && Array.isArray(errorData.details) && errorData.details.length > 0) {
        setError(errorData.details[0].message || errorData.error || 'Registration failed. Please try again.');
      } else {
        setError(errorData?.error || 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="bg-surface border border-border rounded-xl shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-textPrimary mb-2">Create Account</h1>
            <p className="text-textSecondary inline-flex items-center gap-2">
              <span>Sign up for</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="bg-accent/10 p-1 rounded-md border border-accent/20">
                  <TrendingUp className="h-3.5 w-3.5 text-accent" />
                </span>
                <span className="font-semibold bg-gradient-to-r from-sky-400 via-cyan-300 to-teal-400 bg-clip-text text-transparent">
                  CryptoAlerts
                </span>
              </span>
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Username"
              type="text"
              icon={User}
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              placeholder="johndoe"
              required
            />

            <Input
              label="Email"
              type="email"
              icon={Mail}
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="your@email.com"
              required
            />

            <Input
              label="Password"
              type="password"
              icon={Lock}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="••••••••"
              required
              minLength={8}
            />

            <Input
              label="Confirm Password"
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
              Create Account
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-400 text-sm">
              Already have an account?{' '}
              <Link to={ROUTES.LOGIN} className="text-blue-400 hover:text-blue-300">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
