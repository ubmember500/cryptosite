import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { useAuthStore } from '../store/authStore';
import { ROUTES } from '../utils/constants';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { Mail, Lock, TrendingUp } from 'lucide-react';
import usePageTitle from '../hooks/usePageTitle';

const Login = () => {
  usePageTitle('Log In');
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
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Decorative gradient orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-accent/[0.07] blur-[100px] animate-float" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-sky-500/[0.05] blur-[100px] animate-float" style={{ animationDelay: '-3s' }} />

      <div className="w-full max-w-md relative z-10">
        <div className="bg-surface/80 border border-border/40 rounded-2xl shadow-2xl shadow-black/20 p-8 backdrop-blur-xl">
          <div className="text-center mb-8">
            <div className="mb-3 flex items-center justify-center gap-2.5">
              <div className="bg-accent/10 p-2.5 rounded-xl border border-accent/20 shadow-accent-glow">
                <TrendingUp className="h-6 w-6 text-accent" />
              </div>
              <h1 className="text-3xl font-bold text-gradient-brand">
                CryptoAlerts
              </h1>
            </div>
            <p className="text-textSecondary text-sm">Sign in to your account</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
              {error}
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
              <Link to={ROUTES.FORGOT_PASSWORD} className="text-sm text-accent hover:text-accent/80 transition-colors">
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full h-11"
              loading={loading}
            >
              Sign In
            </Button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/40" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-surface/80 px-3 text-textSecondary">or continue with</span>
              </div>
            </div>
            <div className="mt-4 flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Google sign-in failed. Please try again.')}
                theme="filled_black"
                shape="rectangular"
                text="signin_with"
                locale="en"
                width="100%"
              />
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="text-textSecondary text-sm">
              Don't have an account?{' '}
              <Link to={ROUTES.REGISTER} className="text-accent hover:text-accent/80 font-medium transition-colors">
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
