import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import VoiceScrumMaster from './VoiceScrumMaster';
import AuthButton from './components/AuthButton';
import AuthCallback from './pages/AuthCallback';
import ZoomAuth from './pages/ZoomAuth';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-gray-100">
          <Routes>
            <Route path="/auth/zoom" element={<ZoomAuth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/" element={
              <div className="container mx-auto px-4 py-8">
                <div className="max-w-4xl mx-auto">
                  <div className="mb-8">
                    <AuthButton />
                  </div>
                  <VoiceScrumMaster />
                </div>
              </div>
            } />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;