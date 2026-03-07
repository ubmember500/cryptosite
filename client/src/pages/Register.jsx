import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { useAuthStore } from '../store/authStore';
import { ROUTES } from '../utils/constants';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { Mail, Lock, User, TrendingUp } from 'lucide-react';
import usePageTitle from '../hooks/usePageTitle';

const Register = () => {
  usePageTitle('Sign Up');
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((state) => state.register);
  const googleLogin = useAuthStore((state) => state.googleLogin);
  const navigate = useNavigate();

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setLoading(true);
    try {
      await googleLogin(credentialResponse.credential);
      navigate(ROUTES.ACCOUNT);
    } catch (err) {
      const errorData = err.response?.data;
      setError(errorData?.error || 'Google sign-up failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Decorative gradient orbs */}
      <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-accent/[0.07] blur-[100px] animate-float" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[400px] h-[400px] rounded-full bg-sky-500/[0.05] blur-[100px] animate-float" style={{ animationDelay: '-3s' }} />

      <div className="w-full max-w-md relative z-10">
        <div className="bg-surface/80 border border-border/40 rounded-2xl shadow-2xl shadow-black/20 p-8 backdrop-blur-xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-textPrimary mb-2">Create Account</h1>
            <p className="text-textSecondary text-sm inline-flex items-center gap-2">
              <span>Sign up for</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="bg-accent/10 p-1 rounded-lg border border-accent/20">
                  <TrendingUp className="h-3.5 w-3.5 text-accent" />
                </span>
                <span className="font-semibold text-gradient-brand">
                  CryptoAlerts
                </span>
              </span>
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
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
              className="w-full h-11"
              loading={loading}
            >
              Create Account
            </Button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/40" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-surface/80 px-3 text-textSecondary">or sign up with</span>
              </div>
            </div>
            <div className="mt-4 flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Google sign-up failed. Please try again.')}
                theme="filled_black"
                shape="rectangular"
                text="signup_with"
                locale="en"
                width="100%"
              />
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="text-textSecondary text-sm">
              Already have an account?{' '}
              <Link to={ROUTES.LOGIN} className="text-accent hover:text-accent/80 font-medium transition-colors">
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
