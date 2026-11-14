import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App.tsx';
import Gate from './Gate.tsx';
import LegalGate from './LegalGate.tsx';
import SessionGate from './SessionGate.tsx';
import { AuthProvider } from './AuthContext.tsx';
import { ThemeProvider } from './theme.tsx';
import { I18nProvider } from './i18n.tsx';
import { ToastProvider } from './Toast.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <I18nProvider>
          <LegalGate>
            <AuthProvider>
              <ToastProvider>
                <Gate>
                  <SessionGate>
                    <App />
                  </SessionGate>
                </Gate>
              </ToastProvider>
            </AuthProvider>
          </LegalGate>
        </I18nProvider>
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
);
