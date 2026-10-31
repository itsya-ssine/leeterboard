import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App.tsx';
import Gate from './Gate.tsx';
import { AuthProvider } from './AuthContext.tsx';
import { ThemeProvider } from './theme.tsx';
import { ToastProvider } from './Toast.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Gate>
              <App />
            </Gate>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
);
