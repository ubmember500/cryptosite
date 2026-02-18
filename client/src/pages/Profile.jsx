import React, { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import Card from '../components/common/Card';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { User, Mail, Lock } from 'lucide-react';

const Profile = () => {
  const user = useAuthStore((state) => state.user);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    // TODO: Implement password change API call
    // For now, just show success message
    setPasswordSuccess('Password change functionality will be implemented soon');
    setPasswordData({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-200">Profile</h1>

      <Card header="Account Information">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Username
            </label>
            <div className="flex items-center gap-3">
              <User className="h-5 w-5 text-gray-400" />
              <span className="text-gray-200">{user?.username || 'N/A'}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Email
            </label>
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-gray-400" />
              <span className="text-gray-200">{user?.email || 'N/A'}</span>
            </div>
          </div>
        </div>
      </Card>

      <Card header="Change Password">
        <form onSubmit={handlePasswordChange} className="space-y-4">
          {passwordError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {passwordError}
            </div>
          )}

          {passwordSuccess && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
              {passwordSuccess}
            </div>
          )}

          <Input
            label="Current Password"
            type="password"
            icon={Lock}
            value={passwordData.currentPassword}
            onChange={(e) =>
              setPasswordData({ ...passwordData, currentPassword: e.target.value })
            }
            placeholder="Enter current password"
            required
          />

          <Input
            label="New Password"
            type="password"
            icon={Lock}
            value={passwordData.newPassword}
            onChange={(e) =>
              setPasswordData({ ...passwordData, newPassword: e.target.value })
            }
            placeholder="Enter new password"
            required
          />

          <Input
            label="Confirm New Password"
            type="password"
            icon={Lock}
            value={passwordData.confirmPassword}
            onChange={(e) =>
              setPasswordData({ ...passwordData, confirmPassword: e.target.value })
            }
            placeholder="Confirm new password"
            required
          />

          <Button type="submit" variant="primary">
            Change Password
          </Button>
        </form>
      </Card>

      <Card header="Notification Preferences">
        <p className="text-gray-400 text-sm">
          Alert notification preferences will be available soon.
        </p>
      </Card>
    </div>
  );
};

export default Profile;
