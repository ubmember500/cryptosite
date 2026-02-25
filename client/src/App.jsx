import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useAlertStore } from './store/alertStore';
import { useThemeStore } from './store/themeStore';
import { useToastStore } from './store/toastStore';
import { useSocket } from './hooks/useSocket';
import { playAlertSound } from './utils/alertSound';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/common/ProtectedRoute';
import Toast from './components/common/Toast';
import AlertTriggeredModal from './components/alerts/AlertTriggeredModal';

function ThemeSync() {
  const theme = useThemeStore((state) => state.theme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  return null;
}

// Pages
import Account from './pages/Account';
import Charts from './pages/Charts';
import Alerts from './pages/Alerts';
import Market from './pages/Market';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Profile from './pages/Profile';
import TelegramBots from './pages/TelegramBots';
import Subscription from './pages/Subscription';
import Listings from './pages/Listings';
import WallScanner from './pages/WallScanner';
import MarketMap from './pages/MarketMap';

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const initialize = useAuthStore((state) => state.initialize);
  const applyTriggeredEvent = useAlertStore((state) => state.applyTriggeredEvent);
  const pendingTriggerAlert = useAlertStore((state) => state.pendingTriggerAlert);
  const clearPendingTriggerAlert = useAlertStore((state) => state.clearPendingTriggerAlert);
  const checkForTriggers = useAlertStore((state) => state.checkForTriggers);
  const addToast = useToastStore((state) => state.addToast);
  const [triggeredAlert, setTriggeredAlert] = useState(null);

  // Initialize auth check on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Global sweep: runs every 60 s regardless of which page the user is on.
  // • Keeps the Render free-tier server awake (HTTP requests prevent the 15-min sleep).
  // • Runs sweepUserPriceAlerts on the server — live price check + historical klines
  //   check — so missed triggers (e.g. price spike during server sleep) are detected
  //   even when the user is on the Charts or any other non-Alerts page.
  // Uses checkForTriggers (silent) so it does NOT touch the alerts list or loading state.
  useEffect(() => {
    if (!isAuthenticated) return;
    // Immediate check on login / page load
    checkForTriggers();
    const id = setInterval(() => checkForTriggers(), 60_000);
    return () => clearInterval(id);
  }, [isAuthenticated, checkForTriggers]);

  // Re-fetch immediately when the user switches back to this browser tab
  useEffect(() => {
    if (!isAuthenticated) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkForTriggers();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isAuthenticated, checkForTriggers]);

  // Show modal when a sweep-detected trigger arrives via HTTP response
  // (handles the race condition where socket hadn't joined the room yet when sweep fired)
  useEffect(() => {
    if (!pendingTriggerAlert) return;
    playAlertSound().catch(() => {});
    const symbol = pendingTriggerAlert?.symbol || pendingTriggerAlert?.coinSymbol || 'token';
    const target = Number(pendingTriggerAlert?.targetValue);
    const hasTarget = Number.isFinite(target);
    addToast(
      `Price alert hit: ${symbol}${hasTarget ? ` @ ${target}` : ''}`,
      'warning',
      8000
    );
    setTriggeredAlert(pendingTriggerAlert);
    clearPendingTriggerAlert();
  }, [pendingTriggerAlert, addToast, clearPendingTriggerAlert]);

  // Handle real-time alert triggers via Socket.IO
  useSocket({
    onAlertTriggered: (alertData) => {
      const applied = applyTriggeredEvent(alertData);
      if (!applied) return;

      playAlertSound().catch(() => {}); // Play loud alert sound immediately when alert triggers

      const symbol = alertData?.symbol || alertData?.coinSymbol || 'token';
      const target = Number(alertData?.targetValue);
      const hasTarget = Number.isFinite(target);
      const toastMessage = alertData?.alertType === 'price'
        ? `Price alert hit: ${symbol}${hasTarget ? ` @ ${target}` : ''}`
        : `Complex alert triggered: ${symbol}`;
      addToast(toastMessage, 'warning', 8000);
      
      // Show the alert modal with full details
      setTriggeredAlert(alertData);
    },
  });

  return (
    <BrowserRouter>
      <ThemeSync />
      <div className="min-h-screen bg-background text-textPrimary">
        <Routes>
          {/* Public routes */}
          <Route
            path="/login"
            element={
              isAuthenticated ? <Navigate to="/account" replace /> : <Login />
            }
          />
          <Route
            path="/register"
            element={
              isAuthenticated ? <Navigate to="/account" replace /> : <Register />
            }
          />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Public Market route */}
          <Route path="/market" element={<Market />} />
          <Route path="/market-map" element={<MarketMap />} />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/account" replace />} />
            <Route path="account" element={<Account />} />
            <Route path="dashboard" element={<Account />} />
            <Route path="charts" element={<Charts />} />
            <Route path="charts/:coinId" element={<Charts />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="telegram-bots" element={<TelegramBots />} />
            <Route path="subscription" element={<Subscription />} />
            <Route path="listings" element={<Listings />} />
            <Route path="wall-scanner" element={<WallScanner />} />
            <Route path="profile" element={<Profile />} />
          </Route>

          {/* Catch all - redirect to account or login */}
          <Route
            path="*"
            element={
              <Navigate to={isAuthenticated ? '/account' : '/login'} replace />
            }
          />
        </Routes>
        <Toast />
        <AlertTriggeredModal
          isOpen={triggeredAlert !== null}
          onClose={() => setTriggeredAlert(null)}
          alert={triggeredAlert}
        />
      </div>
    </BrowserRouter>
  );
}

export default App;
