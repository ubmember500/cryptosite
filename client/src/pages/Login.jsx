import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { useAuthStore } from '../store/authStore';
import { ROUTES } from '../utils/constants';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { Mail, Lock, TrendingUp } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((state) => state.login);
  const googleLogin = useAuthStore((state) => state.googleLogin);
  const navigate = useNavigate();

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setLoading(true);
    try {
      await googleLogin(credentialResponse.credential);
      setTimeout(() => navigate(ROUTES.ACCOUNT, { replace: true }), 0);
    } catch (err) {
      const errorData = err.response?.data;
      setError(errorData?.error || 'Google sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    console.log('[Login] Form submitted', { email: email ? '(set)' : '(empty)' });

    try {
      console.log('[Login] Calling login()...');
      const response = await login(email, password);
      console.log('[Login] login() succeeded', { hasUser: !!response?.user, hasToken: !!response?.accessToken });

      // Defer navigation so React re-renders with new auth state before we navigate.
      // Otherwise ProtectedRoute can still see isAuthenticated false and redirect back to /login.
      console.log('[Login] Navigating to', ROUTES.ACCOUNT);
      setTimeout(() => {
        navigate(ROUTES.ACCOUNT, { replace: true });
      }, 0);
    } catch (err) {
      // Network/connection errors (e.g. backend not running)
      if (!err.response) {
        console.error('[Login] Network/connection error', err);
        setError('Cannot connect to server. Please ensure the backend is running (e.g. npm run dev in project root).');
        return;
      }
      // API error (4xx/5xx)
      const errorData = err.response?.data;
      const status = err.response?.status;
      console.error('[Login] API error', { status, errorData });

      if (errorData?.details && Array.isArray(errorData.details) && errorData.details.length > 0) {
        setError(errorData.details[0].message || errorData.error || 'Login failed. Please check your credentials.');
      } else {
        setError(errorData?.error || 'Login failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
      console.log('[Login] handleSubmit finished (loading set to false)');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="bg-surface border border-border rounded-xl shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="mb-2 flex items-center justify-center gap-2.5">
              <div className="bg-accent/10 p-1.5 rounded-lg border border-accent/20">
                <TrendingUp className="h-6 w-6 text-accent" />
              </div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-cyan-300 to-teal-400 bg-clip-text text-transparent">
                CryptoAlerts
              </h1>
            </div>
            <p className="text-textSecondary">Sign in to your account</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
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

            <Input
              label="Password"
              type="password"
              icon={Lock}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />

            <div className="text-right">
              <Link to={ROUTES.FORGOT_PASSWORD} className="text-sm text-blue-400 hover:text-blue-300">
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={loading}
            >
              Sign In
            </Button>
          </form>

          <div className="mt-5">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-surface px-3 text-textSecondary">or continue with</span>
              </div>
            </div>
            <div className="mt-4 flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Google sign-in failed. Please try again.')}
                theme="filled_black"
                shape="rectangular"
                text="signin_with"
                width="100%"
              />
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="text-textSecondary text-sm">
              Don't have an account?{' '}
              <Link to={ROUTES.REGISTER} className="text-blue-400 hover:text-blue-300">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
