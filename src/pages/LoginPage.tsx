// Sign-in screen, same look as the legacy #authOverlay. Plantation Operation
// opens only from MJM Intranet, so there is no User ID / password here: just
// the notice and a link back to the Intranet.
import { PalmCorners } from '../components/PalmCorners';
import { useI18n } from '../i18n';
import type { Session } from '../lib/types';

const logoUrl = `${import.meta.env.BASE_URL}palm-logo.png`;
const INTRANET_URL = 'https://mjm.opispro.com/';

interface Props {
  /** Kept for App.tsx; nobody signs in on this screen any more. */
  onSignedIn: (s: Session) => void;
  /** Message to show on arrival (e.g. after a forced sign-out). */
  initialError?: string;
}

export function LoginPage({ initialError }: Props) {
  const { t } = useI18n();
  return (
    <div
      id="authOverlay"
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto"
      style={{ background: 'linear-gradient(160deg,#F0FDF4 0%,#F8FAFC 45%,#EFF6FF 75%,#F8FAFC 100%)' }}
    >
      <PalmCorners />
      <div className="login-glow login-glow-1" />
      <div className="login-glow login-glow-2" />
      <div className="w-full flex items-center justify-center p-4 box-border min-h-screen">
        <div id="loginCard">
          <div className="text-center">
            <div className="login-logo-ring">
              <img src={logoUrl} width={54} height={54} alt="Oil palm tree" className="block object-contain" />
            </div>
          </div>
          <div className="login-brand-name"><span className="login-palm">PSMS</span></div>
          <p className="login-brand-sub">{t('login_brand_sub')}</p>
          <p className="login-welcome-sub" style={{ marginTop: 16 }}>{t('login_intranet_only')}</p>

          {initialError && <p id="loginError" role="alert">{initialError}</p>}

          <a id="loginBtn" href={INTRANET_URL} className="flex items-center justify-center no-underline">
            <span id="loginBtnText">{t('login_go_intranet')}</span>
          </a>

          <div className="login-footer"><span className="login-copyright">{t('login_copyright')}</span></div>
        </div>
      </div>
    </div>
  );
}
